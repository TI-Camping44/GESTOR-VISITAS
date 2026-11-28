'use client'
// Ruteo de visita médica (Sergio): la semana de la visitadora como su planilla —lugar, médico o especialidad,
// día, hora aproximada— con lo que pasó en cada visita; y la carga de la planilla pegada desde Google Sheets.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { AreaTexto, Aviso, Boton, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { descargarCsv } from '@/lib/csv'
import { fmtDia, fmtFecha, fmtSoloHora, hoyIso, lunesDe, semanaIso, sumarDias } from '@/lib/fechas'
import { fmtMin, horasEstimadas, leerPlanilla, minDeHora } from '@/lib/ruteo'
import { cn, mensajeError } from '@/lib/utils'
import { textoMotivo } from '@/lib/medicos'
import type { FilaRuteoSemana } from '@/lib/database.types'

type Estado = 'Pendiente' | 'Llegó' | 'Visitado' | 'Reprogramado' | 'Sin acceso' | 'No atendió' | 'No visitado' | 'No pudo visitar' | 'Ya no atiende acá' | 'No efectiva'
const COLOR: Record<Estado, string> = {
  Pendiente: 'bg-fondo text-tenue', 'Llegó': 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200', 'No visitado': 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  Visitado: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200', Reprogramado: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  'Sin acceso': 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200', 'No atendió': 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  'No pudo visitar': 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  'Ya no atiende acá': 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  'No efectiva': 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
}
// «No pude visitar este lugar» del día (motivo y observación), si lo marcó.
const textoNoVisitado = (f: FilaRuteoSemana) => (f.no_visitado ?? []).map((n) => `${fmtSoloHora(n.hora)} · ${textoMotivo(n.motivo)}${n.observaciones ? ` («${n.observaciones}»)` : ''}`).join(' / ')
// Horas reales de llegada del día (vuelve al mismo lugar: «09:10 · 15:30»).
const horasReales = (f: FilaRuteoSemana) => (f.llegadas?.length ? f.llegadas : f.llegada ? [f.llegada] : []).map((h) => fmtSoloHora(h)).join(' · ')

function estado(f: FilaRuteoSemana, hoy: string): Estado {
  if (!f.visita_id) return f.no_visitado?.length ? 'No pudo visitar' : f.llegada ? 'Llegó' : f.dia < hoy ? 'No visitado' : 'Pendiente'
  if (f.resultado === 'Pidió volver otro día') return 'Reprogramado'
  if (f.resultado === 'Sin acceso') return 'Sin acceso'
  if (f.resultado === 'Ya no atiende acá') return 'Ya no atiende acá'
  if (f.resultado === 'No estaba / no atendió') return 'No atendió'
  // «Visita no efectiva: <motivo>» (Vitalica, 0045).
  const r = f.resultado ?? ''
  if (/^visita no efectiva/i.test(r)) return /ya no atiende/i.test(r) ? 'Ya no atiende acá' : /reprogram/i.test(r) ? 'Reprogramado' : 'No efectiva'
  return 'Visitado'
}

export function RuteoMedico({ visitadoras }: { visitadoras: { id: string; nombre: string }[] }) {
  const sb = supabaseNavegador()
  const hoy = hoyIso()
  const [vis, setVis] = useState('')
  const [lunes, setLunes] = useState(lunesDe(hoy))
  const [inicio, setInicio] = useState('08:00')
  const [filas, setFilas] = useState<FilaRuteoSemana[] | null>(null)
  const [base, setBase] = useState<{ lat: number | null; lng: number | null } | null>(null)
  // Hora pactada de cada parada (la carga Sergio acá; la visitadora la ve en Hoy en vez de la aproximada).
  const [pactadas, setPactadas] = useState<Map<string, string>>(new Map())
  const [pactadasMed, setPactadasMed] = useState<Map<string, string>>(new Map()) // por médico (objetivo)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const visitadora = vis || visitadoras[0]?.id || ''

  const cargar = useCallback(async () => {
    if (!visitadora) return
    const [r, b, c] = await Promise.all([
      sb.rpc('vis_ruteo_semana', { p_vendedor: visitadora, p_semana: lunes }),
      sb.from('vis_vendedores').select('base_lat, base_lng').eq('id', visitadora).maybeSingle(),
      sb.from('vis_config').select('base_lat, base_lng').maybeSingle(),
    ])
    if (r.error) return setError(mensajeError(r.error))
    setFilas(r.data ?? [])
    const pids = [...new Set((r.data ?? []).map((f: FilaRuteoSemana) => f.parada_id))]
    const hp = pids.length ? await sb.from('vis_ruta_paradas').select('id, hora_pactada').in('id', pids) : { data: [] }
    setPactadas(new Map(((hp.data ?? []) as { id: string; hora_pactada: string | null }[]).filter((x) => x.hora_pactada).map((x) => [x.id, x.hora_pactada!.slice(0, 5)])))
    const oids = [...new Set((r.data ?? []).map((f: FilaRuteoSemana) => f.objetivo_id).filter(Boolean) as string[])]
    const ho = oids.length ? await sb.from('vis_parada_objetivos').select('id, hora_pactada').in('id', oids) : { data: [] }
    setPactadasMed(new Map(((ho.data ?? []) as { id: string; hora_pactada: string | null }[]).filter((x) => x.hora_pactada).map((x) => [x.id, x.hora_pactada!.slice(0, 5)])))
    setBase(b.data?.base_lat != null ? { lat: b.data.base_lat, lng: b.data.base_lng } : c.data ? { lat: c.data.base_lat, lng: c.data.base_lng } : null)
  }, [sb, visitadora, lunes])
  useEffect(() => { void cargar() }, [cargar])

  // Hora aproximada por parada, día por día, desde la oficina.
  const horas = useMemo(() => {
    const m = new Map<string, string>()
    const ini = minDeHora(inicio) ?? 8 * 60
    const porDia = new Map<string, FilaRuteoSemana[]>()
    for (const f of filas ?? []) if (!(porDia.get(f.dia) ?? []).some((x) => x.parada_id === f.parada_id)) porDia.set(f.dia, [...(porDia.get(f.dia) ?? []), f])
    for (const paradas of porDia.values()) {
      const h = horasEstimadas(base, paradas, { inicioMin: ini })
      paradas.forEach((p, i) => m.set(p.parada_id, fmtMin(h[i]!.llegada)))
    }
    return m
  }, [filas, base, inicio])
  const dias = useMemo(() => [...new Set((filas ?? []).map((f) => f.dia))], [filas])

  async function guardarPactadaMedico(objetivoId: string, hora: string) {
    if ((pactadasMed.get(objetivoId) ?? '') === hora) return
    setGuardando(objetivoId); setError(null)
    const { error: e } = await sb.from('vis_parada_objetivos').update({ hora_pactada: hora || null }).eq('id', objetivoId)
    setGuardando(null)
    if (e) return setError(mensajeError(e))
    setPactadasMed((m) => { const n = new Map(m); if (hora) n.set(objetivoId, hora); else n.delete(objetivoId); return n })
  }

  async function guardarPactada(paradaId: string, hora: string) {
    if ((pactadas.get(paradaId) ?? '') === hora) return
    setGuardando(paradaId); setError(null)
    const { error: e } = await sb.from('vis_ruta_paradas').update({ hora_pactada: hora || null }).eq('id', paradaId)
    setGuardando(null)
    if (e) return setError(mensajeError(e))
    setPactadas((m) => { const n = new Map(m); if (hora) n.set(paradaId, hora); else n.delete(paradaId); return n })
  }
  const nombre = visitadoras.find((v) => v.id === visitadora)?.nombre ?? ''

  function excel() {
    descargarCsv(`Ruteo ${nombre} semana ${fmtFecha(lunes).replace(/\//g, '-')}`, [
      { titulo: 'Día', valor: (f: FilaRuteoSemana) => fmtDia(f.dia) },
      { titulo: 'Fecha', valor: (f: FilaRuteoSemana) => fmtFecha(f.dia) },
      { titulo: 'Orden', valor: (f: FilaRuteoSemana) => f.orden },
      { titulo: 'Hora pactada', valor: (f: FilaRuteoSemana) => pactadas.get(f.parada_id) ?? '' },
      { titulo: 'Llegada est.', valor: (f: FilaRuteoSemana) => horas.get(f.parada_id) ?? '' },
      { titulo: 'Llegó (real)', valor: (f: FilaRuteoSemana) => horasReales(f) },
      { titulo: 'Centro médico / Consultorio', valor: (f: FilaRuteoSemana) => f.lugar },
      { titulo: 'Dirección', valor: (f: FilaRuteoSemana) => f.direccion ?? '' },
      { titulo: 'Especialidad', valor: (f: FilaRuteoSemana) => f.especialidad ?? '' },
      { titulo: 'Dr', valor: (f: FilaRuteoSemana) => f.medico ?? '' },
      { titulo: 'Hora pactada con el Dr', valor: (f: FilaRuteoSemana) => (f.objetivo_id ? pactadasMed.get(f.objetivo_id) ?? '' : '') },
      { titulo: 'Médico visitado', valor: (f: FilaRuteoSemana) => f.medico_visitado ?? '' },
      { titulo: 'Hora de la visita', valor: (f: FilaRuteoSemana) => (f.fecha_hora ? new Date(f.fecha_hora).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Asuncion' }) : '') },
      { titulo: 'Resultado', valor: (f: FilaRuteoSemana) => f.resultado ?? '' },
      { titulo: 'No pudo visitar', valor: (f: FilaRuteoSemana) => textoNoVisitado(f) },
      { titulo: 'Productos / muestras', valor: (f: FilaRuteoSemana) => (f.productos ?? []).map((p) => `${p.producto}${p.muestras ? ` (${p.muestras})` : ''}`).join(', ') },
      { titulo: 'Observaciones', valor: (f: FilaRuteoSemana) => f.observaciones ?? '' },
      { titulo: 'Próxima visita', valor: (f: FilaRuteoSemana) => (f.proxima_visita ? fmtFecha(f.proxima_visita) : '') },
      { titulo: 'Estado', valor: (f: FilaRuteoSemana) => estado(f, hoy) },
    ], filas ?? [])
  }

  // ── Cargar la planilla ──
  const [texto, setTexto] = useState('')
  const [semCarga, setSemCarga] = useState(lunesDe(hoy))
  const [reemplazar, setReemplazar] = useState(true)
  const [cargando, setCargando] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const leida = useMemo(() => leerPlanilla(texto, semCarga), [texto, semCarga])
  async function subir() {
    setError(null); setOk(null)
    if (!visitadora) return setError('No hay visitadoras: dale acceso en Usuarios con el rol «Visitadora médica».')
    if (leida.filas.length === 0) return setError('Pegá la planilla: no se leyó ningún renglón.')
    setCargando(true)
    const { data, error: e } = await sb.rpc('vis_cargar_ruteo', { p: {
      visitadora_id: visitadora, semana: semCarga, reemplazar, publicar: true,
      filas: leida.filas.map((f) => ({ dia: f.dia, lugar: f.lugar, especialidad: f.especialidad, medico: f.medico, direccion: f.direccion, lat: f.lat, lng: f.lng })),
    } })
    setCargando(false)
    if (e) return setError(mensajeError(e))
    const r = data as { paradas: number; objetivos: number; lugares_nuevos: number; medicos_nuevos: number }
    setOk(`Listo: ${r.paradas} paradas y ${r.objetivos} médicos o especialidades a visitar${r.lugares_nuevos ? `, ${r.lugares_nuevos} lugares nuevos` : ''}${r.medicos_nuevos ? `, ${r.medicos_nuevos} médicos nuevos` : ''}. La ruta quedó publicada: ${nombre} la ve en Hoy.`)
    setTexto('')
    setLunes(semCarga)
    void cargar()
  }

  return (
    <>
      <Tarjeta className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-semibold">Ruteo de la semana</h2>
            <p className="text-sm text-tenue">Centro médico / Consultorio · Especialidad · Dr · Día de visita, con lo que pasó en cada visita. Hora: la <b>pactada</b> se escribe en cada lugar (la visitadora la ve en su app); abajo, en verde, la hora real en que marcó «Llegué acá», o con ≈ la aproximada desde la oficina.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {visitadoras.length > 1 && (
              <Selector aria-label="Visitadora del ruteo" value={visitadora} onChange={(e) => setVis(e.target.value)} className="w-auto">
                {visitadoras.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </Selector>
            )}
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Semana anterior" onClick={() => setLunes(sumarDias(lunes, -7))} className="grid size-9 place-items-center rounded-lg border border-borde"><ChevronLeft className="size-4" aria-hidden /></button>
              <span className="min-w-36 text-center text-sm font-medium">Sem {semanaIso(lunes)} · {fmtFecha(lunes)} al {fmtFecha(sumarDias(lunes, 5))}</span>
              <button type="button" aria-label="Semana siguiente" onClick={() => setLunes(sumarDias(lunes, 7))} className="grid size-9 place-items-center rounded-lg border border-borde"><ChevronRight className="size-4" aria-hidden /></button>
            </div>
            <label className="flex items-center gap-1 text-sm">Sale
              <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} aria-label="Hora de salida" className="min-h-9 rounded-lg border border-borde bg-superficie px-2" />
            </label>
            <Boton variante="secundario" onClick={excel} disabled={!filas?.length}>Excel</Boton>
          </div>
        </div>
        {filas && filas.length === 0 && <Vacio titulo="Sin ruta esa semana">Cargala abajo pegando la planilla, o desde Rutas.</Vacio>}
        {dias.map((d) => {
          const delDia = (filas ?? []).filter((f) => f.dia === d)
          const hechas = delDia.filter((f) => f.visita_id).length
          return (
            <div key={d} className="overflow-x-auto">
              <h3 className="mb-1 text-sm font-semibold"><span className="capitalize">{fmtDia(d)}</span> <span className="font-normal text-tenue">· {new Set(delDia.map((f) => f.parada_id)).size} lugares · {hechas} de {delDia.length} visitados</span></h3>
              <table className="w-full min-w-[860px] text-sm">
                <thead className="text-left text-xs text-tenue">
                  <tr className="border-b border-borde [&>th]:px-2 [&>th]:py-1.5"><th className="w-10">#</th><th className="w-28">Pactada / llegó</th><th>Centro médico / Consultorio</th><th>Especialidad</th><th>Dr</th><th className="w-24">Hora Dr</th><th>Resultado</th><th>Próxima</th><th className="w-28">Estado</th></tr>
                </thead>
                <tbody>
                  {delDia.map((f, i) => {
                    const primera = i === 0 || delDia[i - 1]!.parada_id !== f.parada_id
                    const e = estado(f, hoy)
                    return (
                      <tr key={`${f.parada_id}-${f.objetivo_id ?? i}`} className={cn('align-top [&>td]:px-2 [&>td]:py-1.5', primera && 'border-t border-borde')}>
                        <td className="tabular text-tenue">{primera ? f.orden : ''}</td>
                        <td className="tabular">{primera && <>
                          <input type="time" aria-label={`Hora pactada en ${f.lugar}`} title="Hora pactada (la ve la visitadora en Hoy). Vacío: sin hora pactada."
                            defaultValue={pactadas.get(f.parada_id) ?? ''} key={`${f.parada_id}-${pactadas.get(f.parada_id) ?? ''}`}
                            onBlur={(e) => void guardarPactada(f.parada_id, e.target.value)}
                            className={cn('min-h-8 w-24 rounded-md border border-borde bg-superficie px-1.5 text-sm', guardando === f.parada_id && 'opacity-50')} />
                          <p className="mt-0.5 text-xs">{f.llegada
                            ? <span title="Hora real en que marcó «Llegué acá» (si volvió en el día, cada llegada)" className="font-semibold text-green-700 dark:text-green-400">llegó {horasReales(f)}</span>
                            : <span title="Hora aproximada desde la oficina" className="text-tenue">≈ {horas.get(f.parada_id)}</span>}</p>
                        </>}</td>
                        <td>{primera && <><p className="font-medium">{f.lugar}</p>{f.direccion && <p className="text-xs text-tenue">{f.direccion}</p>}</>}</td>
                        <td>{f.especialidad ?? <span className="text-tenue">—</span>}</td>
                        <td>{f.medico ?? (f.medico_visitado ? <span className="text-tenue">visitó a {f.medico_visitado}</span> : <span className="text-tenue">{f.objetivo_id ? 'a buscar' : '—'}</span>)}</td>
                        <td>{f.objetivo_id && (
                          <input type="time" aria-label={`Hora pactada con ${f.medico ?? f.especialidad ?? 'el médico'}`} title="Hora pactada con este médico (la ve la visitadora en el lugar)"
                            defaultValue={pactadasMed.get(f.objetivo_id) ?? ''} key={`${f.objetivo_id}-${pactadasMed.get(f.objetivo_id) ?? ''}`}
                            onBlur={(e) => void guardarPactadaMedico(f.objetivo_id!, e.target.value)}
                            className={cn('min-h-8 w-24 rounded-md border border-borde bg-superficie px-1.5 text-sm', guardando === f.objetivo_id && 'opacity-50')} />
                        )}</td>
                        <td>{!f.visita_id && primera && f.no_visitado?.length ? <span className="text-orange-800 dark:text-orange-300">No pudo visitar: {textoNoVisitado(f)}</span> : null}{f.fecha_hora && <span className="tabular text-tenue">{fmtSoloHora(f.fecha_hora)} · </span>}{f.resultado ?? ''}{f.observaciones && <p className="text-xs text-tenue">{f.observaciones}</p>}</td>
                        <td className="tabular">{f.proxima_visita ? fmtFecha(f.proxima_visita) : ''}</td>
                        <td><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', COLOR[e])}>{e}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </Tarjeta>

      <Tarjeta className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">Cargar ruteo</h2>
          <p className="text-sm text-tenue">Copiá la planilla de Google Sheets (con los títulos) y pegala acá. Columnas: <b>Centro médico / Consultorio</b>, <b>Especialidad</b>, <b>Dr</b> y <b>Día de visita</b> (Lunes, Martes… o la fecha). Si tiene Orden, Dirección, Latitud y Longitud, también se usan. Sin Dr, queda «buscar médico de esa especialidad». Varios médicos en una celda: separados por coma o punto y coma.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {visitadoras.length > 1 && (
            <Selector aria-label="Visitadora de la carga" value={visitadora} onChange={(e) => setVis(e.target.value)} className="w-auto">
              {visitadoras.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Selector>
          )}
          <Selector aria-label="Semana de la carga" value={semCarga} onChange={(e) => setSemCarga(e.target.value)} className="w-auto">
            {[0, 1, 2, 3].map((n) => { const l = sumarDias(lunesDe(hoy), 7 * n); return <option key={l} value={l}>Semana {semanaIso(l)} · del {fmtFecha(l)}</option> })}
          </Selector>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--c-marca)]" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} /> Reemplazar lo cargado esos días</label>
        </div>
        <AreaTexto aria-label="Planilla de ruteo" value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} placeholder={'Centro médico / Consultorio\tEspecialidad\tDr\tDía de visita\nSanatorio Migone\tTraumatología\tDr. Pérez\tJueves'} className="font-mono text-xs" />
        {leida.errores.length > 0 && <Aviso tipo="alerta"><ul className="list-disc pl-4">{leida.errores.slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul></Aviso>}
        {leida.filas.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-lg border border-borde">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-superficie text-left text-xs text-tenue"><tr className="[&>th]:px-2 [&>th]:py-1.5"><th>Día</th><th>Centro médico / Consultorio</th><th>Especialidad</th><th>Dr</th></tr></thead>
              <tbody>{leida.filas.map((f, i) => (
                <tr key={i} className="border-t border-borde [&>td]:px-2 [&>td]:py-1"><td className="capitalize">{fmtDia(f.dia)}</td><td>{f.lugar}</td><td>{f.especialidad ?? '—'}</td><td>{f.medico ?? <span className="text-tenue">a buscar</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        {ok && <Aviso tipo="ok">{ok}</Aviso>}
        <Boton onClick={() => void subir()} disabled={cargando || leida.filas.length === 0} className="self-start">
          {cargando ? 'Cargando…' : `Cargar ${leida.filas.length || ''} renglones para ${nombre}`}
        </Boton>
      </Tarjeta>
    </>
  )
}
