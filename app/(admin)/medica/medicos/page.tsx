'use client'
// Visita médica → Médicos: quién es cada médico, su especialidad, dónde y qué días atiende, cada cuánto
// se lo visita, cuándo fue la última vez y el historial de visitas (resultado, productos, observaciones).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Aviso, Boton, Entrada, Selector, Tarjeta, Vacio } from '@/components/ui'
import { descargarCsv } from '@/lib/csv'
import { fmtFecha, fmtSoloHora, hoyIso } from '@/lib/fechas'
import { DIAS_SEMANA, claveEspecialidad, diasDeHorario, diasSinVisita, tocaVisitar } from '@/lib/medicos'
import { useParamUrl } from '@/lib/useParamUrl'
import { cn } from '@/lib/utils'
import { ChipsDias } from '@/components/admin/medica/ChipsDias'
import { agruparEspecialidades, leerVisitasDeMedico, textoProductos, useMedicos, useVisitadoras, type VisitaMedica } from '@/components/admin/medica/datos'
import type { Medico } from '@/lib/database.types'

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const diasDeMedico = (m: Medico) => new Set(m.lugares.flatMap((l) => diasDeHorario(l.horario)))

export default function Medicos() {
  const { medicos, error } = useMedicos()
  const visitadoras = useVisitadoras()
  const [q, setQUrl] = useParamUrl('q', '')
  const [buscar, setBuscar] = useState(q)
  const [esp, setEsp] = useParamUrl('esp', '')
  const [lugar, setLugar] = useParamUrl('lugar', '')
  const [dia, setDia] = useParamUrl('dia', '')
  const [toca, setToca] = useParamUrl('toca', '')
  const [quien, setQuien] = useParamUrl('visitadora', '')
  const [abierto, setAbierto] = useState<string | null>(null)

  const todos = useMemo(() => medicos ?? [], [medicos])
  const especialidades = useMemo(() => agruparEspecialidades(todos), [todos])
  const lugares = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of todos) for (const l of x.lugares) m.set(l.lugar_id, l.nombre)
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [todos])
  const nombreVisitadora = (id: string | null) => visitadoras.find((v) => v.id === id)?.nombre ?? '—'

  const lista = useMemo(() => {
    const t = normal(buscar.trim())
    return todos
      .filter((m) => !quien || m.visitadora_id === quien)
      .filter((m) => !esp || (claveEspecialidad(m.especialidad) || 'sin') === esp)
      .filter((m) => !lugar || m.lugares.some((l) => l.lugar_id === lugar))
      .filter((m) => !dia || diasDeMedico(m).has(Number(dia)))
      .filter((m) => !toca || tocaVisitar(m))
      .filter((m) => !t || normal([m.nombre, m.especialidad, ...m.lugares.map((l) => l.nombre)].filter(Boolean).join(' ')).includes(t))
  }, [todos, quien, esp, lugar, dia, toca, buscar])
  const hayFiltro = !!(buscar || esp || lugar || dia || toca || quien)

  function excel() {
    descargarCsv(`medicos_${hoyIso()}`, [
      { titulo: 'Médico', valor: (m: Medico) => m.nombre },
      { titulo: 'Especialidad', valor: (m: Medico) => m.especialidad ?? '' },
      { titulo: 'Lugar', valor: (m: Medico) => m.lugares.map((l) => l.nombre).join(' / ') },
      { titulo: 'Horario', valor: (m: Medico) => m.lugares.map((l) => `${l.nombre}: ${l.horario ?? 'sin horario'}`).join(' / ') },
      { titulo: 'Días', valor: (m: Medico) => [...diasDeMedico(m)].sort().map((d) => DIAS_SEMANA[d - 1]!.corto).join(' ') },
      { titulo: 'Teléfono', valor: (m: Medico) => m.telefono ?? '' },
      { titulo: 'Visitadora', valor: (m: Medico) => nombreVisitadora(m.visitadora_id) },
      { titulo: 'Cada (días)', valor: (m: Medico) => m.frecuencia_dias },
      { titulo: 'Última visita', valor: (m: Medico) => fmtFecha(m.ultima_visita) },
      { titulo: 'Le toca visita', valor: (m: Medico) => (tocaVisitar(m) ? 'Sí' : 'No') },
      { titulo: 'Notas', valor: (m: Medico) => m.notas ?? '' },
    ], lista)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Médicos</h1>
        <p className="text-sm text-tenue">Los médicos que carga la visitadora: especialidad, dónde y qué días atienden, y cuándo se los visitó. Tocá un médico para ver sus visitas.</p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <Tarjeta className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Entrada aria-label="Buscar médico" placeholder="Buscar médico, especialidad o lugar…" value={buscar} onChange={(e) => { setBuscar(e.target.value); setQUrl(e.target.value) }} />
          <Selector aria-label="Especialidad" value={esp} onChange={(e) => setEsp(e.target.value)}>
            <option value="">Todas las especialidades</option>
            {especialidades.map((g) => <option key={g.clave} value={g.clave}>{g.nombre} ({g.medicos.length})</option>)}
          </Selector>
          <Selector aria-label="Consultorio o lugar" value={lugar} onChange={(e) => setLugar(e.target.value)}>
            <option value="">Todos los lugares</option>
            {lugares.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </Selector>
          {visitadoras.length > 1 ? (
            <Selector aria-label="Visitadora" value={quien} onChange={(e) => setQuien(e.target.value)}>
              <option value="">Todas las visitadoras</option>
              {visitadoras.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Selector>
          ) : <span className="hidden lg:block" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-tenue">Atiende el</span>
          <div role="group" aria-label="Día que atiende" className="flex flex-wrap gap-1">
            {DIAS_SEMANA.slice(0, 6).map((d) => (
              <button key={d.n} type="button" aria-pressed={dia === String(d.n)} onClick={() => setDia(dia === String(d.n) ? '' : String(d.n))}
                className={cn('rounded-lg border px-3 py-1.5 text-sm font-medium', dia === String(d.n) ? 'border-marca bg-marca text-sobre-marca' : 'border-borde hover:border-marca')}>
                {d.largo}
              </button>
            ))}
          </div>
          <label className="ml-2 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--c-marca)]" checked={!!toca} onChange={(e) => setToca(e.target.checked ? '1' : '')} /> Solo a los que les toca visita</label>
          {hayFiltro && <Boton variante="fantasma" onClick={() => { setBuscar(''); setQUrl(''); setEsp(''); setLugar(''); setDia(''); setToca(''); setQuien('') }}>Limpiar filtros</Boton>}
          <Boton variante="secundario" className="ml-auto" disabled={!lista.length} onClick={excel}>Excel</Boton>
        </div>
      </Tarjeta>

      <div className="grid grid-cols-3 gap-3">
        <Tarjeta><p className="text-xs uppercase tracking-wide text-tenue">Médicos</p><p className="text-2xl font-semibold tabular">{medicos ? lista.length : '–'}</p></Tarjeta>
        <Tarjeta><p className="text-xs uppercase tracking-wide text-tenue">Visitados alguna vez</p><p className="text-2xl font-semibold tabular">{medicos ? lista.filter((m) => m.ultima_visita).length : '–'}</p></Tarjeta>
        <Tarjeta><p className="text-xs uppercase tracking-wide text-tenue">Les toca visita</p><p className="text-2xl font-semibold tabular">{medicos ? lista.filter((m) => tocaVisitar(m)).length : '–'}</p></Tarjeta>
      </div>

      <Tarjeta className="overflow-x-auto p-0">
        {medicos === null ? <div className="m-4 h-40 animate-pulse rounded-xl bg-borde/40" /> : lista.length === 0 ? (
          <div className="p-4"><Vacio titulo={hayFiltro ? 'Ningún médico con estos filtros' : 'Todavía no hay médicos'}>{hayFiltro ? 'Probá sacando algún filtro.' : 'Los carga la visitadora desde su app (Médicos → «Médico»).'}</Vacio></div>
        ) : (
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="w-8" /><th className="px-2 py-2 font-medium">Médico</th><th className="px-2 py-2 font-medium">Dónde y cuándo atiende</th>
              <th className="px-2 py-2 font-medium">Frecuencia</th><th className="px-2 py-2 font-medium">Última visita</th>
              {visitadoras.length > 1 && <th className="px-2 py-2 font-medium">Visitadora</th>}
            </tr></thead>
            <tbody>
              {lista.map((m) => {
                const d = diasSinVisita(m)
                const abiertoEste = abierto === m.id
                return (
                  <Fragment key={m.id}>
                    <tr className={cn('border-b border-borde align-top', abiertoEste && 'bg-fondo/60')}>
                      <td className="py-2 pl-2">
                        <button type="button" aria-expanded={abiertoEste} aria-label={`${abiertoEste ? 'Ocultar' : 'Ver'} visitas de ${m.nombre}`} onClick={() => setAbierto(abiertoEste ? null : m.id)}
                          className="grid size-8 place-items-center rounded-lg hover:bg-fondo">{abiertoEste ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}</button>
                      </td>
                      <td className="px-2 py-2">
                        <button type="button" className="text-left font-medium hover:text-marca" onClick={() => setAbierto(abiertoEste ? null : m.id)}>{m.nombre}</button>
                        <p className="text-xs text-tenue">{m.especialidad ?? 'Sin especialidad'}{m.telefono && ` · ${m.telefono}`}</p>
                      </td>
                      <td className="px-2 py-2">
                        <ul className="flex flex-col gap-1.5">
                          {m.lugares.map((l) => (
                            <li key={l.lugar_id}>
                              <p className="font-medium">{l.nombre}</p>
                              <div className="flex flex-wrap items-center gap-2">
                                <ChipsDias dias={diasDeHorario(l.horario)} />
                                <span className="text-xs text-tenue">{l.horario ?? 'Sin horario cargado'}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">cada {m.frecuencia_dias} días</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {m.ultima_visita ? <>{fmtFecha(m.ultima_visita)}<p className="text-xs text-tenue">hace {d} día{d === 1 ? '' : 's'}</p></> : <span className="text-tenue">Nunca</span>}
                        {tocaVisitar(m) && <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">le toca visita</span>}
                      </td>
                      {visitadoras.length > 1 && <td className="px-2 py-2">{nombreVisitadora(m.visitadora_id)}</td>}
                    </tr>
                    {abiertoEste && (
                      <tr className="border-b border-borde bg-fondo/60"><td /><td colSpan={visitadoras.length > 1 ? 5 : 4} className="px-2 pb-3"><Historial medico={m} /></td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </Tarjeta>
    </div>
  )
}

function Historial({ medico }: { medico: Medico }) {
  const [visitas, setVisitas] = useState<VisitaMedica[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    leerVisitasDeMedico(medico.id).then((v) => { if (vivo) setVisitas(v) }).catch((e: Error) => { if (vivo) setError(e.message) })
    return () => { vivo = false }
  }, [medico.id])
  if (error) return <Aviso tipo="error">{error}</Aviso>
  if (!visitas) return <div className="h-16 animate-pulse rounded-lg bg-borde/40" />
  return (
    <div className="flex flex-col gap-2">
      {medico.notas && <p className="text-sm"><span className="text-tenue">Notas de la visitadora:</span> {medico.notas}</p>}
      {visitas.length === 0 ? <p className="text-sm text-tenue">Todavía no tiene visitas registradas.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-tenue">
            <th className="py-1 pr-2 font-medium">Fecha</th><th className="py-1 pr-2 font-medium">Lugar</th><th className="py-1 pr-2 font-medium">Resultado</th>
            <th className="py-1 pr-2 font-medium">Productos (muestras)</th><th className="py-1 font-medium">Observaciones</th>
          </tr></thead>
          <tbody>
            {visitas.map((v) => (
              <tr key={v.id} className="border-t border-borde align-top">
                <td className="whitespace-nowrap py-1.5 pr-2 tabular">{fmtFecha(v.fecha_hora)} {fmtSoloHora(v.fecha_hora)}</td>
                <td className="py-1.5 pr-2">{v.lugar?.razon_social ?? '—'}</td>
                <td className="py-1.5 pr-2">{v.resultado?.nombre ?? '—'}{v.proxima_visita && <p className="text-xs text-tenue">próxima: {fmtFecha(v.proxima_visita)}</p>}</td>
                <td className="py-1.5 pr-2">{textoProductos(v) || <span className="text-tenue">—</span>}</td>
                <td className="max-w-80 break-words py-1.5">{v.observaciones ?? <span className="text-tenue">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
