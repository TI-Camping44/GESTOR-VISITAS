'use client'
// Visita médica → Consultorios y lugares: cada hospital, sanatorio o consultorio con sus médicos
// (especialidad, días y horario), cuándo llegó la visitadora por última vez y cuándo visitó.
// Abajo, «Cargar lugares» para armar la lista antes de que pase la visitadora.
import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Navigation } from 'lucide-react'
import { AreaTexto, Aviso, Boton, Entrada, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { descargarCsv } from '@/lib/csv'
import { fmtFecha, fmtSoloHora, hace, hoyIso, sumarDias } from '@/lib/fechas'
import { diasDeHorario, tocaVisitar } from '@/lib/medicos'
import { cn, linkComoLlegar, mensajeError } from '@/lib/utils'
import { useParamUrl } from '@/lib/useParamUrl'
import { ChipsDias } from '@/components/admin/medica/ChipsDias'
import { leerLlegadas, useLugares, useMedicos, useVisitadoras, type LugarMedico } from '@/components/admin/medica/datos'
import type { Medico } from '@/lib/database.types'

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Tipo de lugar por el nombre ("Sanat. Americano" → Sanatorio). Si no se reconoce, queda sin tipo.
function tipoPorNombre(n: string): string | null {
  const t = normal(n)
  if (/\bsanat/.test(t)) return 'Sanatorio'
  if (/\bhosp|\bips\b|ineran|cruz roja|emergencias/.test(t)) return 'Hospital'
  if (/clinica/.test(t)) return 'Clínica'
  if (/consultorio/.test(t)) return 'Consultorio'
  if (/farmacia/.test(t)) return 'Farmacia'
  if (/centro de salud|\busf\b/.test(t)) return 'Centro de salud'
  return null
}
// Un lugar por renglón; la dirección, opcional, después de " - ". Sin repetir.
function leerLugaresTexto(texto: string) {
  const vistos = new Set<string>()
  return texto.split('\n').map((l) => l.replace(/^\s*\d+[.)-]?\s+/, '').trim()).filter(Boolean).flatMap((l) => {
    const [nombre, ...resto] = l.split(/\s+-\s+/)
    const n = (nombre ?? '').replace(/^Sanat\.\s*/i, 'Sanatorio ').replace(/^Hosp\.\s*/i, 'Hospital ').trim()
    if (!/[\p{L}\d]/u.test(n) || vistos.has(normal(n))) return []
    vistos.add(normal(n))
    return [{ nombre: n, tipo_lugar: tipoPorNombre(n), direccion: resto.join(' - ').trim() || null }]
  })
}

export default function Lugares() {
  const lugares = useLugares()
  const { medicos } = useMedicos()
  const visitadoras = useVisitadoras()
  const [buscar, setBuscar] = useState('')
  const [tipo, setTipo] = useParamUrl('tipo', '')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [ultimaLlegada, setUltimaLlegada] = useState<Map<string, string>>(new Map())

  // Última llegada a cada lugar (últimos 90 días).
  useEffect(() => {
    if (!visitadoras.length) return
    leerLlegadas(visitadoras.map((v) => v.id), sumarDias(hoyIso(), -90), hoyIso())
      .then((ll) => { const m = new Map<string, string>(); for (const l of ll) m.set(l.lugar_id, l.fecha_hora); setUltimaLlegada(m) }).catch(() => {})
  }, [visitadoras])

  const medicosDe = useMemo(() => {
    const m = new Map<string, { medico: Medico; horario: string | null }[]>()
    for (const x of medicos ?? []) for (const l of x.lugares) m.set(l.lugar_id, [...(m.get(l.lugar_id) ?? []), { medico: x, horario: l.horario }])
    return m
  }, [medicos])
  const tipos = useMemo(() => [...new Set((lugares ?? []).map((l) => l.tipo_lugar).filter((x): x is string => !!x))].sort(), [lugares])
  const lista = useMemo(() => {
    const t = normal(buscar.trim())
    return (lugares ?? [])
      .filter((l) => !tipo || l.tipo_lugar === tipo)
      .filter((l) => !t || normal([l.razon_social, l.direccion, l.ciudad].filter(Boolean).join(' ')).includes(t))
      .sort((a, b) => (medicosDe.get(b.id)?.length ?? 0) - (medicosDe.get(a.id)?.length ?? 0) || a.razon_social.localeCompare(b.razon_social, 'es'))
  }, [lugares, tipo, buscar, medicosDe])

  function excel() {
    descargarCsv(`lugares_${hoyIso()}`, [
      { titulo: 'Lugar', valor: (l: LugarMedico) => l.razon_social },
      { titulo: 'Tipo', valor: (l: LugarMedico) => l.tipo_lugar ?? '' },
      { titulo: 'Dirección', valor: (l: LugarMedico) => [l.direccion, l.ciudad].filter(Boolean).join(', ') },
      { titulo: 'Médicos', valor: (l: LugarMedico) => medicosDe.get(l.id)?.length ?? 0 },
      { titulo: 'Especialidades', valor: (l: LugarMedico) => [...new Set((medicosDe.get(l.id) ?? []).map((x) => x.medico.especialidad).filter(Boolean))].join(', ') },
      { titulo: 'Última llegada', valor: (l: LugarMedico) => (ultimaLlegada.get(l.id) ? `${fmtFecha(ultimaLlegada.get(l.id)!)} ${fmtSoloHora(ultimaLlegada.get(l.id)!)}` : '') },
      { titulo: 'Última visita', valor: (l: LugarMedico) => fmtFecha(l.ultima_visita) },
      { titulo: 'Ubicación', valor: (l: LugarMedico) => (l.lat == null ? 'sin ubicación' : `${l.lat}, ${l.lng}`) },
    ], lista)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Consultorios y lugares</h1>
        <p className="text-sm text-tenue">Hospitales, sanatorios y consultorios que visita la visitadora, con sus médicos y horarios. Tocá un lugar para ver sus médicos.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Entrada aria-label="Buscar lugar" placeholder="Buscar por nombre, dirección o ciudad…" value={buscar} onChange={(e) => setBuscar(e.target.value)} className="w-72" />
        <Selector aria-label="Tipo de lugar" value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-auto">
          <option value="">Todos los tipos</option>
          {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
        </Selector>
        <span className="text-sm text-tenue tabular">{lugares ? `${lista.length} lugares` : ''}</span>
        <Boton variante="secundario" className="ml-auto" disabled={!lista.length} onClick={excel}>Excel</Boton>
      </div>

      <Tarjeta className="overflow-x-auto p-0">
        {lugares === null ? <div className="m-4 h-40 animate-pulse rounded-xl bg-borde/40" /> : lista.length === 0 ? (
          <div className="p-4"><Vacio titulo="No hay lugares">La visitadora los carga desde su app (Lugares → «Nuevo lugar»), o cargalos abajo.</Vacio></div>
        ) : (
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="w-8" /><th className="px-2 py-2 font-medium">Lugar</th><th className="px-2 py-2 text-right font-medium">Médicos</th>
              <th className="px-2 py-2 font-medium">Especialidades</th><th className="px-2 py-2 font-medium">Última llegada</th><th className="px-2 py-2 font-medium">Última visita</th>
            </tr></thead>
            <tbody>
              {lista.map((l) => {
                const meds = medicosDe.get(l.id) ?? []
                const esps = [...new Set(meds.map((x) => x.medico.especialidad?.trim()).filter((x): x is string => !!x))]
                const abiertoEste = abierto === l.id
                const llegada = ultimaLlegada.get(l.id)
                const comoLlegar = linkComoLlegar(l)
                return (
                  <Fragment key={l.id}>
                    <tr className={cn('border-b border-borde align-top', abiertoEste && 'bg-fondo/60')}>
                      <td className="py-2 pl-2">
                        <button type="button" aria-expanded={abiertoEste} aria-label={`${abiertoEste ? 'Ocultar' : 'Ver'} médicos de ${l.razon_social}`} onClick={() => setAbierto(abiertoEste ? null : l.id)}
                          className="grid size-8 place-items-center rounded-lg hover:bg-fondo">{abiertoEste ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}</button>
                      </td>
                      <td className="px-2 py-2">
                        <button type="button" className="text-left font-medium hover:text-marca" onClick={() => setAbierto(abiertoEste ? null : l.id)}>{l.razon_social}</button>
                        <p className="text-xs text-tenue">{[l.tipo_lugar, l.direccion, l.ciudad].filter(Boolean).join(' · ') || 'Sin dirección'}</p>
                        {l.lat == null && <p className="text-xs text-amber-700 dark:text-amber-300">Sin ubicación: se toma cuando la visitadora llega</p>}
                      </td>
                      <td className="px-2 py-2 text-right tabular">{meds.length}</td>
                      <td className="px-2 py-2">
                        <div className="flex max-w-80 flex-wrap gap-1">
                          {esps.slice(0, 6).map((e) => <span key={e} className="rounded-full bg-fondo px-2 py-0.5 text-xs">{e}</span>)}
                          {esps.length > 6 && <span className="text-xs text-tenue">+{esps.length - 6}</span>}
                          {!esps.length && <span className="text-tenue">—</span>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">{llegada ? <>{fmtFecha(llegada)} <span className="text-tenue">{fmtSoloHora(llegada)}</span></> : <span className="text-tenue">—</span>}</td>
                      <td className="whitespace-nowrap px-2 py-2">{l.ultima_visita ? hace(l.ultima_visita) : <span className="text-tenue">Nunca</span>}</td>
                    </tr>
                    {abiertoEste && (
                      <tr className="border-b border-borde bg-fondo/60">
                        <td />
                        <td colSpan={5} className="px-2 pb-3">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-2 text-sm">
                              {comoLlegar && <a href={comoLlegar} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 underline"><Navigation className="size-4" aria-hidden /> Ver en Google Maps</a>}
                              <Link href={`/medica/medicos?lugar=${l.id}`} className="underline">Ver estos médicos con sus visitas</Link>
                            </div>
                            {l.notas && <p className="text-sm"><span className="text-tenue">Notas:</span> {l.notas}</p>}
                            {meds.length === 0 ? <p className="text-sm text-tenue">Todavía no hay médicos cargados en este lugar.</p> : (
                              <table className="w-full text-sm">
                                <thead><tr className="text-left text-xs uppercase tracking-wide text-tenue">
                                  <th className="py-1 pr-2 font-medium">Médico</th><th className="py-1 pr-2 font-medium">Especialidad</th><th className="py-1 pr-2 font-medium">Días y horario</th><th className="py-1 font-medium">Última visita</th>
                                </tr></thead>
                                <tbody>
                                  {meds.sort((a, b) => a.medico.nombre.localeCompare(b.medico.nombre, 'es')).map(({ medico: m, horario }) => (
                                    <tr key={m.id} className="border-t border-borde align-top">
                                      <td className="py-1.5 pr-2 font-medium">{m.nombre}</td>
                                      <td className="py-1.5 pr-2">{m.especialidad ?? '—'}</td>
                                      <td className="py-1.5 pr-2"><div className="flex flex-wrap items-center gap-2"><ChipsDias dias={diasDeHorario(horario)} /><span className="text-xs text-tenue">{horario ?? 'Sin horario'}</span></div></td>
                                      <td className="whitespace-nowrap py-1.5">{m.ultima_visita ? fmtFecha(m.ultima_visita) : <span className="text-tenue">Nunca</span>}{tocaVisitar(m) && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">le toca</span>}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </Tarjeta>

      <CargarLugares visitadoras={visitadoras} />
    </div>
  )
}

function CargarLugares({ visitadoras }: { visitadoras: { id: string; nombre: string }[] }) {
  const [carga, setCarga] = useState({ visitadora: '', ciudad: 'Asunción', texto: '' })
  const [cargando, setCargando] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const aCargar = useMemo(() => leerLugaresTexto(carga.texto), [carga.texto])
  async function cargar(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setOk(null)
    const visitadoraId = carga.visitadora || visitadoras[0]?.id
    if (!visitadoraId) return setError('No hay visitadoras: dale acceso en Usuarios con el rol «Visitadora médica».')
    if (!aCargar.length) return setError('Pegá al menos un lugar (uno por renglón).')
    setCargando(true)
    const { data, error: err } = await supabaseNavegador().rpc('vis_cargar_lugares', { p: { visitadora_id: visitadoraId, ciudad: carga.ciudad, lugares: aCargar } })
    setCargando(false)
    if (err) return setError(mensajeError(err))
    const r = data as { cargados: number; ya_estaban: number }
    setOk(`Se cargaron ${r.cargados} lugares${r.ya_estaban ? ` (${r.ya_estaban} ya estaban)` : ''}. Recargá la página para verlos en la lista.`)
    setCarga((c) => ({ ...c, texto: '' }))
  }
  return (
    <Tarjeta className="flex flex-col gap-3">
      <div>
        <h2 className="font-semibold">Cargar lugares</h2>
        <p className="text-sm text-tenue">Para tener la lista antes de que pase la visitadora: pegá los hospitales, sanatorios o consultorios, uno por renglón (si querés, la dirección después de « - »). La ubicación la toma ella cuando llega.</p>
      </div>
      <form onSubmit={cargar} className="grid gap-3 lg:grid-cols-[1fr_280px]">
        <AreaTexto aria-label="Lugares, uno por renglón" className="min-h-36" placeholder={'Centro Médico Bautista\nSanatorio Italiano - Av. Mcal. López 1234\nIPS Central'} value={carga.texto} onChange={(e) => setCarga({ ...carga, texto: e.target.value })} />
        <div className="flex flex-col gap-2">
          {visitadoras.length > 1 && (
            <Selector aria-label="Visitadora" value={carga.visitadora || visitadoras[0]?.id || ''} onChange={(e) => setCarga({ ...carga, visitadora: e.target.value })}>
              {visitadoras.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Selector>
          )}
          <Entrada aria-label="Ciudad" placeholder="Ciudad…" value={carga.ciudad} onChange={(e) => setCarga({ ...carga, ciudad: e.target.value })} />
          {aCargar.length > 0 && (
            <ul className="max-h-40 overflow-auto rounded-lg border border-borde p-2 text-xs">
              {aCargar.map((l) => <li key={l.nombre}>{l.nombre}<span className="text-tenue">{l.tipo_lugar ? ` · ${l.tipo_lugar}` : ''}{l.direccion ? ` · ${l.direccion}` : ''}</span></li>)}
            </ul>
          )}
          <Boton type="submit" disabled={cargando || !aCargar.length}>{cargando ? 'Cargando…' : `Cargar ${aCargar.length || ''} lugares`}</Boton>
        </div>
      </form>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
    </Tarjeta>
  )
}
