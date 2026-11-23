'use client'
// Visita médica (pantalla de entrada): arriba el tablero semanal de las visitadoras (igual que el de Ventas)
// y abajo la Actividad: qué hizo cada visitadora en el día, hora por hora (jornada, llegadas a lugares y
// visitas a médicos con resultado, productos, muestras y observaciones), y los últimos 7 días.
// Tocar un día del tablero cambia el día de la Actividad (?dia=&visitadora=).
import Tablero from '../tablero/page'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, CircleSlash, LogIn, LogOut, MapPin, Stethoscope, XCircle } from 'lucide-react'
import { Aviso, Boton, Entrada, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { descargarCsv } from '@/lib/csv'
import { fechaIso, fmtDia, fmtFecha, fmtSoloHora, hoyIso, sumarDias } from '@/lib/fechas'
import { useParamUrl } from '@/lib/useParamUrl'
import { cn } from '@/lib/utils'
import { leerLlegadas, leerNoVisitados, leerVisitas, textoProductos, totalMuestras, useVisitadoras, type Llegada, type NoVisitado, type VisitaMedica } from '@/components/admin/medica/datos'
import { claveEspecialidad, textoMotivo } from '@/lib/medicos'

type Jornada = { vendedor_id: string; inicio: string; fin: string | null }
// Plan del día (lo arma el supervisor en «Armar el día»): lugares en orden y, en cada uno, a quién ver.
type ParadaPlan = { id: string; orden: number; cliente_id: string; vendedor_id: string; lugar: string
  objetivos: { orden: number; medico_id: string | null; especialidad: string | null; medico: { nombre: string; especialidad: string | null } | null }[] }

async function leerPlan(ids: string[], dia: string): Promise<ParadaPlan[]> {
  if (!ids.length) return []
  const sb = supabaseNavegador()
  const { data: ps, error } = await sb.from('vis_ruta_paradas')
    .select('id, orden, cliente_id, ruta:vis_rutas!vis_ruta_paradas_ruta_id_fkey!inner(vendedor_id, estado), lugar:vis_clientes!vis_ruta_paradas_cliente_id_fkey(razon_social)')
    .eq('dia', dia).in('ruta.vendedor_id', ids).in('ruta.estado', ['publicada', 'cerrada']).order('orden')
  if (error) throw new Error(error.message)
  const filas = ((ps ?? []) as unknown as { id: string; orden: number; cliente_id: string; ruta: { vendedor_id: string } | null; lugar: { razon_social: string } | null }[])
    .filter((p) => p.ruta && ids.includes(p.ruta.vendedor_id))
  const pids = filas.map((p) => p.id)
  const { data: os } = pids.length
    ? await sb.from('vis_parada_objetivos').select('parada_id, orden, medico_id, especialidad, medico:vis_medicos!vis_parada_objetivos_medico_id_fkey(nombre, especialidad)').in('parada_id', pids).order('orden')
    : { data: [] }
  const objetivos = (os ?? []) as unknown as (ParadaPlan['objetivos'][number] & { parada_id: string })[]
  return filas.map((p) => ({ id: p.id, orden: p.orden, cliente_id: p.cliente_id, vendedor_id: p.ruta!.vendedor_id, lugar: p.lugar?.razon_social ?? 'Lugar',
    objetivos: objetivos.filter((o) => o.parada_id === p.id) }))
}
type Evento =
  | { tipo: 'inicio' | 'fin'; hora: string; vendedor_id: string }
  | { tipo: 'llegada'; hora: string; vendedor_id: string; l: Llegada }
  | { tipo: 'no_visitado'; hora: string; vendedor_id: string; n: NoVisitado }
  | { tipo: 'visita'; hora: string; vendedor_id: string; v: VisitaMedica }

export default function Actividad() {
  const visitadoras = useVisitadoras()
  const [dia, setDia] = useParamUrl('dia', hoyIso())
  const [quien, setQuien] = useParamUrl('visitadora', '')
  const [datos, setDatos] = useState<{ visitas: VisitaMedica[]; llegadas: Llegada[]; noVisitados: NoVisitado[]; jornadas: Jornada[]; plan: ParadaPlan[] } | null>(null)
  const [semana, setSemana] = useState<{ visitas: VisitaMedica[]; llegadas: Llegada[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ids = useMemo(() => visitadoras.filter((v) => !quien || v.id === quien).map((v) => v.id), [visitadoras, quien])
  const nombre = (id: string) => visitadoras.find((v) => v.id === id)?.nombre ?? '—'

  useEffect(() => {
    if (!visitadoras.length) return
    let vivo = true
    setDatos(null)
    const ini = new Date(`${dia}T00:00:00-03:00`).toISOString()
    const fin = new Date(new Date(`${dia}T00:00:00-03:00`).getTime() + 86_400_000).toISOString()
    Promise.all([
      leerVisitas(ids, dia, dia), leerLlegadas(ids, dia, dia), leerNoVisitados(ids, dia, dia),
      supabaseNavegador().from('vis_jornadas').select('vendedor_id, inicio, fin').in('vendedor_id', ids).gte('inicio', ini).lt('inicio', fin),
      leerPlan(ids, dia).catch(() => [] as ParadaPlan[]),
    ]).then(([visitas, llegadas, noVisitados, j, plan]) => {
      if (!vivo) return
      setError(null)
      setDatos({ visitas, llegadas, noVisitados, jornadas: (j.data ?? []) as Jornada[], plan })
    }).catch((e: Error) => { if (vivo) { setError(e.message); setDatos({ visitas: [], llegadas: [], noVisitados: [], jornadas: [], plan: [] }) } })
    return () => { vivo = false }
  }, [ids, dia, visitadoras.length])

  // Últimos 7 días hasta el día elegido (para ver de un vistazo cómo viene la semana).
  useEffect(() => {
    if (!visitadoras.length) return
    let vivo = true
    Promise.all([leerVisitas(ids, sumarDias(dia, -6), dia), leerLlegadas(ids, sumarDias(dia, -6), dia)])
      .then(([visitas, llegadas]) => { if (vivo) setSemana({ visitas, llegadas }) }).catch(() => {})
    return () => { vivo = false }
  }, [ids, dia, visitadoras.length])

  const eventos = useMemo<Evento[]>(() => {
    if (!datos) return []
    const e: Evento[] = [
      ...datos.jornadas.flatMap((j) => [
        { tipo: 'inicio' as const, hora: j.inicio, vendedor_id: j.vendedor_id },
        ...(j.fin ? [{ tipo: 'fin' as const, hora: j.fin, vendedor_id: j.vendedor_id }] : []),
      ]),
      ...datos.llegadas.map((l) => ({ tipo: 'llegada' as const, hora: l.fecha_hora, vendedor_id: l.vendedor_id, l })),
      ...datos.noVisitados.map((n) => ({ tipo: 'no_visitado' as const, hora: n.fecha_hora, vendedor_id: n.vendedor_id, n })),
      ...datos.visitas.map((v) => ({ tipo: 'visita' as const, hora: v.fecha_hora, vendedor_id: v.vendedor_id, v })),
    ]
    return e.sort((a, b) => a.hora.localeCompare(b.hora))
  }, [datos])
  const porVisitadora = useMemo(() => {
    const m = new Map<string, Evento[]>()
    for (const p of datos?.plan ?? []) if (!m.has(p.vendedor_id)) m.set(p.vendedor_id, []) // con plan aunque todavía no haya hecho nada
    for (const e of eventos) m.set(e.vendedor_id, [...(m.get(e.vendedor_id) ?? []), e])
    return [...m]
  }, [eventos, datos])

  const resumen = datos && {
    lugares: new Set([...datos.llegadas.map((l) => l.lugar_id), ...datos.visitas.map((v) => v.cliente_id), ...datos.noVisitados.map((n) => n.lugar_id)]).size,
    noVisitados: datos.noVisitados.length,
    medicos: new Set(datos.visitas.map((v) => v.medico_id).filter(Boolean)).size,
    visitas: datos.visitas.length,
    muestras: datos.visitas.reduce((s, v) => s + totalMuestras(v), 0),
  }
  // Sábados y domingos solo si ese día hubo algo.
  const finde = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())
  const dias7 = Array.from({ length: 7 }, (_, i) => sumarDias(dia, i - 6)).filter((d) => d === dia || !finde(d)
    || !semana || semana.visitas.some((x) => fechaIso(x.fecha_hora) === d) || semana.llegadas.some((x) => fechaIso(x.fecha_hora) === d))
  const delDia = (d: string, x: { fecha_hora: string }[]) => x.filter((y) => fechaIso(y.fecha_hora) === d)

  function excel() {
    if (!datos) return
    descargarCsv(`actividad_medica_${dia}`, [
      { titulo: 'Visitadora', valor: (e: Evento) => nombre(e.vendedor_id) },
      { titulo: 'Hora', valor: (e: Evento) => fmtSoloHora(e.hora) },
      { titulo: 'Qué', valor: (e: Evento) => (e.tipo === 'inicio' ? 'Inició la jornada' : e.tipo === 'fin' ? 'Terminó la jornada' : e.tipo === 'llegada' ? 'Llegó' : e.tipo === 'no_visitado' ? 'No pudo visitar' : 'Visita') },
      { titulo: 'Lugar', valor: (e: Evento) => (e.tipo === 'llegada' ? e.l.lugar?.razon_social : e.tipo === 'no_visitado' ? e.n.lugar?.razon_social : e.tipo === 'visita' ? e.v.lugar?.razon_social : '') ?? '' },
      { titulo: 'Médico', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.medico?.nombre ?? '' : '') },
      { titulo: 'Especialidad', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.medico?.especialidad ?? '' : '') },
      { titulo: 'Resultado', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.resultado?.nombre ?? '' : e.tipo === 'no_visitado' ? textoMotivo(e.n.motivo) : '') },
      { titulo: 'Productos (muestras)', valor: (e: Evento) => (e.tipo === 'visita' ? textoProductos(e.v) : '') },
      { titulo: 'Observaciones', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.observaciones ?? '' : e.tipo === 'no_visitado' ? e.n.observaciones ?? '' : '') },
      { titulo: 'Próxima visita', valor: (e: Evento) => (e.tipo === 'visita' && e.v.proxima_visita ? fmtFecha(e.v.proxima_visita) : '') },
    ], eventos)
  }

  return (
    <div className="flex flex-col gap-8">
    <Tablero />
    <section id="actividad" className="flex scroll-mt-4 flex-col gap-4" aria-labelledby="actividad-medica">
      <div>
        <h2 id="actividad-medica" className="text-lg font-semibold">Actividad del día</h2>
        <p className="text-sm text-tenue">Qué hizo cada visitadora en el día: a qué hora llegó a cada lugar, a qué médicos vio y qué dejó.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Día anterior" className="grid size-10 place-items-center rounded-lg border border-borde hover:bg-fondo" onClick={() => setDia(sumarDias(dia, -1))}><ChevronLeft className="size-4" aria-hidden /></button>
          <Entrada type="date" aria-label="Día" value={dia} max={hoyIso()} onChange={(e) => e.target.value && setDia(e.target.value)} className="w-44" />
          <button type="button" aria-label="Día siguiente" disabled={dia >= hoyIso()} className="grid size-10 place-items-center rounded-lg border border-borde hover:bg-fondo disabled:opacity-40" onClick={() => setDia(sumarDias(dia, 1))}><ChevronRight className="size-4" aria-hidden /></button>
        </div>
        {dia !== hoyIso() && <Boton variante="fantasma" onClick={() => setDia(hoyIso())}>Hoy</Boton>}
        {visitadoras.length > 1 && (
          <Selector aria-label="Visitadora" value={quien} onChange={(e) => setQuien(e.target.value)} className="w-auto">
            <option value="">Todas las visitadoras</option>
            {visitadoras.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
        )}
        <Boton variante="secundario" className="ml-auto" disabled={!eventos.length} onClick={excel}>Excel del día</Boton>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Lugares', resumen?.lugares], ['Médicos visitados', resumen?.medicos], ['Visitas', resumen?.visitas], ['Muestras entregadas', resumen?.muestras], ['No pudo visitar', resumen?.noVisitados]].map(([t, n]) => (
          <Tarjeta key={t as string}><p className="text-xs uppercase tracking-wide text-tenue">{t}</p><p className="text-2xl font-semibold tabular">{n ?? '–'}</p></Tarjeta>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          {datos === null && <div className="h-40 animate-pulse rounded-xl bg-borde/40" />}
          {datos && porVisitadora.length === 0 && (
            <Vacio titulo={`Sin actividad el ${fmtFecha(dia)}`}>No marcó llegadas ni registró visitas ese día.</Vacio>
          )}
          {porVisitadora.map(([id, lista]) => (
            <Tarjeta key={id} className="flex flex-col gap-1">
              <h2 className="mb-2 font-semibold">{nombre(id)}</h2>
              {datos && <PlanDelDia plan={datos.plan.filter((p) => p.vendedor_id === id)} datos={datos} vendedorId={id} dia={dia} />}
              {lista.length > 0 ? (
                <ol className="relative flex flex-col gap-3 border-l-2 border-borde pl-5">
                  {lista.map((e, i) => <EventoFila key={i} e={e} />)}
                </ol>
              ) : <p className="text-sm text-tenue">Todavía no marcó llegadas ni registró visitas.</p>}
            </Tarjeta>
          ))}
        </div>

        <Tarjeta className="flex h-fit flex-col gap-2">
          <h2 className="font-semibold">Últimos 7 días</h2>
          <table className="w-full text-sm tabular">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="py-1.5 font-medium">Día</th><th className="py-1.5 text-right font-medium">Lugares</th><th className="py-1.5 text-right font-medium">Médicos</th><th className="py-1.5 text-right font-medium">Muestras</th>
            </tr></thead>
            <tbody>
              {dias7.map((d) => {
                const v = semana ? delDia(d, semana.visitas) as VisitaMedica[] : []
                const l = semana ? delDia(d, semana.llegadas) as Llegada[] : []
                const lugares = new Set([...l.map((x) => x.lugar_id), ...v.map((x) => x.cliente_id)]).size
                return (
                  <tr key={d} className={cn('border-b border-borde last:border-0', d === dia && 'font-semibold')}>
                    <td className="py-1.5"><button type="button" className="capitalize underline-offset-2 hover:underline" onClick={() => setDia(d)}>{fmtDia(d)}</button></td>
                    <td className="py-1.5 text-right">{semana ? lugares : '–'}</td>
                    <td className="py-1.5 text-right">{semana ? new Set(v.map((x) => x.medico_id).filter(Boolean)).size : '–'}</td>
                    <td className="py-1.5 text-right">{semana ? v.reduce((s, x) => s + totalMuestras(x), 0) : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-xs text-tenue">Tocá un día para ver su detalle. El recorrido en el mapa está en <Link href="/medica/en-vivo" className="underline">En vivo</Link>.</p>
        </Tarjeta>
      </div>
    </section>
    </div>
  )
}

// Plan del día de una visitadora: cada lugar en orden con su llegada y, en cada uno, los médicos que tenía que ver
// (visitado con hora y resultado, no lo vio, o pendiente) y los que vio sin estar en el plan.
function PlanDelDia({ plan, datos, vendedorId, dia }: {
  plan: ParadaPlan[]; vendedorId: string; dia: string
  datos: { visitas: VisitaMedica[]; llegadas: Llegada[]; noVisitados: NoVisitado[] }
}) {
  if (!plan.length) return null
  const pasado = dia < hoyIso()
  const vistos = plan.reduce((s, p) => s + p.objetivos.filter((o) => datos.visitas.some((v) => v.vendedor_id === vendedorId && v.cliente_id === p.cliente_id && cumple(o, v))).length, 0)
  const total = plan.reduce((s, p) => s + p.objetivos.length, 0)
  return (
    <div className="mb-4 rounded-lg border border-borde p-3">
      <p className="text-sm font-semibold">Plan del día{total > 0 && <span className="font-normal text-tenue"> · vio {vistos} de {total} médicos del plan</span>}</p>
      <ol className="mt-2 flex flex-col gap-2.5">
        {plan.map((p, i) => {
          const visitas = datos.visitas.filter((v) => v.vendedor_id === vendedorId && v.cliente_id === p.cliente_id)
          const llegadas = datos.llegadas.filter((l) => l.vendedor_id === vendedorId && l.lugar_id === p.cliente_id)
          const noPudo = datos.noVisitados.find((n) => n.vendedor_id === vendedorId && n.lugar_id === p.cliente_id)
          const fuera = visitas.filter((v) => !p.objetivos.some((o) => cumple(o, v)))
          const estuvo = llegadas.length > 0 || visitas.length > 0 || !!noPudo
          return (
            <li key={p.id} className="text-sm">
              <p><span className="font-semibold tabular">{i + 1}.</span> <b>{p.lugar}</b>
                <span className="text-tenue"> · {llegadas.length ? `llegó ${llegadas.map((l) => fmtSoloHora(l.fecha_hora)).join(' y ')}` : visitas.length ? 'sin «Llegué acá»' : noPudo ? `no pudo visitar (${textoMotivo(noPudo.motivo)})` : pasado ? 'no fue' : 'todavía no llegó'}</span></p>
              {(p.objetivos.length > 0 || fuera.length > 0) && (
                <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                  {p.objetivos.map((o, j) => {
                    const v = visitas.find((x) => cumple(o, x))
                    const quien = o.medico?.nombre ?? `Buscar ${o.especialidad ?? 'médico'}`
                    const esp = o.medico?.especialidad ?? (o.medico ? null : o.especialidad)
                    return (
                      <li key={j} className="flex items-start gap-1.5">
                        {v ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-700 dark:text-green-400" aria-hidden />
                          : estuvo || pasado ? <XCircle className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-400" aria-hidden />
                          : <CircleDashed className="mt-0.5 size-4 shrink-0 text-tenue" aria-hidden />}
                        <span>{quien}{esp && <span className="text-tenue"> · {esp}</span>}
                          {' '}<span className={cn('text-xs font-medium', v ? 'text-green-800 dark:text-green-300' : estuvo || pasado ? 'text-red-800 dark:text-red-300' : 'text-tenue')}>
                            {v ? `visitado ${fmtSoloHora(v.fecha_hora)}${v.resultado ? ` · ${v.resultado.nombre}` : ''}${!o.medico_id && v.medico ? ` (${v.medico.nombre})` : ''}` : estuvo || pasado ? 'no lo vio' : 'pendiente'}
                          </span></span>
                      </li>
                    )
                  })}
                  {fuera.map((v) => (
                    <li key={v.id} className="flex items-start gap-1.5">
                      <Stethoscope className="mt-0.5 size-4 shrink-0 text-marca" aria-hidden />
                      <span>{v.medico?.nombre ?? 'Visita'}{v.medico?.especialidad && <span className="text-tenue"> · {v.medico.especialidad}</span>}
                        {' '}<span className="text-xs font-medium text-amber-800 dark:text-amber-300">fuera del plan · {fmtSoloHora(v.fecha_hora)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Una visita cumple un objetivo si es a ese médico, o (objetivo por especialidad) a un médico de esa especialidad. */
function cumple(o: ParadaPlan['objetivos'][number], v: VisitaMedica) {
  if (o.medico_id) return v.medico_id === o.medico_id
  return !!o.especialidad && !!v.medico?.especialidad && claveEspecialidad(v.medico.especialidad) === claveEspecialidad(o.especialidad)
}

function EventoFila({ e }: { e: Evento }) {
  const punto = (Icono: typeof MapPin, clase: string) => (
    <span className={cn('absolute -left-[33px] -top-0.5 grid size-6 place-items-center rounded-full border-2 border-superficie', clase)}><Icono className="size-3.5" aria-hidden /></span>
  )
  const hora = <span className="mr-2 font-semibold tabular">{fmtSoloHora(e.hora)}</span>
  if (e.tipo === 'inicio' || e.tipo === 'fin') return (
    <li className="relative text-sm text-tenue">{punto(e.tipo === 'inicio' ? LogIn : LogOut, 'bg-fondo text-tenue')}{hora}{e.tipo === 'inicio' ? 'Inició la jornada' : 'Terminó la jornada'}</li>
  )
  if (e.tipo === 'llegada') return (
    <li className="relative text-sm">{punto(MapPin, 'bg-green-700 text-white')}{hora}Llegó a <b>{e.l.lugar?.razon_social ?? 'un lugar'}</b></li>
  )
  if (e.tipo === 'no_visitado') return (
    <li className="relative text-sm">
      {punto(CircleSlash, 'bg-amber-600 text-white')}
      <p>{hora}<b>No pudo visitar</b> {e.n.lugar?.razon_social ?? 'el lugar'}<span className="text-tenue"> · {textoMotivo(e.n.motivo)}</span></p>
      {e.n.observaciones && <p className="mt-1 rounded-lg bg-fondo px-3 py-2 break-words"><span className="text-tenue">Observación:</span> {e.n.observaciones}</p>}
    </li>
  )
  if (e.tipo !== 'visita') return null
  const v = e.v
  return (
    <li className="relative text-sm">
      {punto(Stethoscope, 'bg-marca text-sobre-marca')}
      <p>{hora}<b>{v.medico?.nombre ?? 'Visita'}</b>{v.medico?.especialidad && <span className="text-tenue"> · {v.medico.especialidad}</span>}<span className="text-tenue"> · {v.lugar?.razon_social}</span></p>
      <div className="mt-1 flex flex-col gap-0.5 rounded-lg bg-fondo px-3 py-2">
        {v.resultado && <p><span className="text-tenue">Resultado:</span> {v.resultado.nombre}</p>}
        {(v.productos ?? []).length > 0 && <p><span className="text-tenue">Productos:</span> {textoProductos(v)}</p>}
        {v.observaciones && <p className="break-words"><span className="text-tenue">Observaciones:</span> {v.observaciones}</p>}
        {v.proxima_visita && <p><span className="text-tenue">Próxima visita:</span> {fmtFecha(v.proxima_visita)}</p>}
      </div>
    </li>
  )
}
