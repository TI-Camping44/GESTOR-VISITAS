'use client'
// Visita médica (pantalla de entrada): arriba el tablero semanal de las visitadoras (igual que el de Ventas)
// y abajo la Actividad, por día o por semana: qué hizo cada visitadora hora por hora (jornada, llegadas a
// lugares y visitas a médicos con resultado, productos, muestras y observaciones) contra el plan del día.
// Semana, día, vista y visitadora van en la dirección y están de acuerdo entre el tablero y la Actividad.
import Tablero from '../tablero/page'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, CircleSlash, LogIn, LogOut, MapPin, Stethoscope, XCircle } from 'lucide-react'
import { Aviso, Boton, Entrada, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { descargarCsv } from '@/lib/csv'
import { fechaIso, fmtDia, fmtFecha, fmtSoloHora, hoyIso, minutosDelDia, sumarDias } from '@/lib/fechas'
import { useParamUrl } from '@/lib/useParamUrl'
import { useSemanaDia } from '@/lib/useSemanaDia'
import { cn } from '@/lib/utils'
import { leerLlegadas, leerNoVisitados, leerVisitas, textoProductos, totalMuestras, useVisitadoras, type Llegada, type NoVisitado, type VisitaMedica } from '@/components/admin/medica/datos'
import { claveEspecialidad, mismoMedico, noLoVio, textoMotivo } from '@/lib/medicos'
import { minDeHora } from '@/lib/ruteo'

type Jornada = { vendedor_id: string; inicio: string; fin: string | null }
// Plan del día (lo arma el supervisor en «Armar el día»): lugares en orden y, en cada uno, a quién ver.
type ParadaPlan = { id: string; dia: string; orden: number; cliente_id: string; vendedor_id: string; lugar: string; hora_pactada: string | null
  objetivos: { orden: number; medico_id: string | null; especialidad: string | null; hora_pactada: string | null; medico: { nombre: string; especialidad: string | null } | null }[] }
type Datos = { visitas: VisitaMedica[]; llegadas: Llegada[]; noVisitados: NoVisitado[]; jornadas: Jornada[]; plan: ParadaPlan[] }

async function leerPlan(ids: string[], desde: string, hasta: string): Promise<ParadaPlan[]> {
  if (!ids.length) return []
  const sb = supabaseNavegador()
  const { data: ps, error } = await sb.from('vis_ruta_paradas')
    .select('id, dia, orden, cliente_id, hora_pactada, ruta:vis_rutas!vis_ruta_paradas_ruta_id_fkey!inner(vendedor_id, estado), lugar:vis_clientes!vis_ruta_paradas_cliente_id_fkey(razon_social)')
    .gte('dia', desde).lte('dia', hasta).in('ruta.vendedor_id', ids).in('ruta.estado', ['publicada', 'cerrada']).order('dia').order('orden')
  if (error) throw new Error(error.message)
  const filas = ((ps ?? []) as unknown as { id: string; dia: string; orden: number; cliente_id: string; hora_pactada: string | null; ruta: { vendedor_id: string } | null; lugar: { razon_social: string } | null }[])
    .filter((p) => p.ruta && ids.includes(p.ruta.vendedor_id))
  const pids = filas.map((p) => p.id)
  const { data: os } = pids.length
    ? await sb.from('vis_parada_objetivos').select('parada_id, orden, medico_id, especialidad, hora_pactada, medico:vis_medicos!vis_parada_objetivos_medico_id_fkey(nombre, especialidad)').in('parada_id', pids).order('orden')
    : { data: [] }
  const objetivos = (os ?? []) as unknown as (ParadaPlan['objetivos'][number] & { parada_id: string })[]
  return filas.map((p) => ({ id: p.id, dia: p.dia, orden: p.orden, cliente_id: p.cliente_id, hora_pactada: p.hora_pactada, vendedor_id: p.ruta!.vendedor_id, lugar: p.lugar?.razon_social ?? 'Lugar',
    objetivos: objetivos.filter((o) => o.parada_id === p.id) }))
}
type Evento =
  | { tipo: 'inicio' | 'fin'; hora: string; vendedor_id: string }
  | { tipo: 'llegada'; hora: string; vendedor_id: string; l: Llegada }
  | { tipo: 'no_visitado'; hora: string; vendedor_id: string; n: NoVisitado }
  | { tipo: 'visita'; hora: string; vendedor_id: string; v: VisitaMedica }

const finde = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())
const delDia = <T extends { fecha_hora: string }>(d: string, x: T[]) => x.filter((y) => fechaIso(y.fecha_hora) === d)

export default function Actividad() {
  const visitadoras = useVisitadoras()
  const { semana, setSemana, dia, setDia, vista, setVista, hoy } = useSemanaDia()
  const [quien, setQuien] = useParamUrl('visitadora', '')
  const [datos, setDatos] = useState<Datos | null>(null)
  const [ultimos, setUltimos] = useState<{ visitas: VisitaMedica[]; llegadas: Llegada[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ids = useMemo(() => visitadoras.filter((v) => !quien || v.id === quien).map((v) => v.id), [visitadoras, quien])
  const nombre = (id: string) => visitadoras.find((v) => v.id === id)?.nombre ?? '—'
  const [desde, hasta] = vista === 'semana' ? [semana, sumarDias(semana, 6)] : [dia, dia]

  useEffect(() => {
    if (!visitadoras.length) return
    let vivo = true
    setDatos(null)
    const ini = new Date(`${desde}T00:00:00-03:00`).toISOString()
    const fin = new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 86_400_000).toISOString()
    Promise.all([
      leerVisitas(ids, desde, hasta), leerLlegadas(ids, desde, hasta), leerNoVisitados(ids, desde, hasta),
      supabaseNavegador().from('vis_jornadas').select('vendedor_id, inicio, fin').in('vendedor_id', ids).gte('inicio', ini).lt('inicio', fin),
      leerPlan(ids, desde, hasta).catch(() => [] as ParadaPlan[]),
    ]).then(([visitas, llegadas, noVisitados, j, plan]) => {
      if (!vivo) return
      setError(null)
      setDatos({ visitas, llegadas, noVisitados, jornadas: (j.data ?? []) as Jornada[], plan })
    }).catch((e: Error) => { if (vivo) { setError(e.message); setDatos({ visitas: [], llegadas: [], noVisitados: [], jornadas: [], plan: [] }) } })
    return () => { vivo = false }
  }, [ids, desde, hasta, visitadoras.length])

  // Vista día: los últimos 7 días hasta el día elegido (para ver de un vistazo cómo viene la semana).
  useEffect(() => {
    if (!visitadoras.length || vista !== 'dia') return
    let vivo = true
    Promise.all([leerVisitas(ids, sumarDias(dia, -6), dia), leerLlegadas(ids, sumarDias(dia, -6), dia)])
      .then(([visitas, llegadas]) => { if (vivo) setUltimos({ visitas, llegadas }) }).catch(() => {})
    return () => { vivo = false }
  }, [ids, dia, vista, visitadoras.length])

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
  // Visitadoras con algo para mostrar (actividad o plan) en el período.
  const conAlgo = useMemo(() => {
    const s = new Set<string>()
    for (const p of datos?.plan ?? []) s.add(p.vendedor_id)
    for (const e of eventos) s.add(e.vendedor_id)
    return [...s].sort((a, b) => nombre(a).localeCompare(nombre(b), 'es'))
  }, [eventos, datos]) // eslint-disable-line react-hooks/exhaustive-deps
  // Días a mostrar: en la vista semana, lunes a viernes (y el fin de semana si hubo algo o había plan).
  const dias = vista === 'dia' ? [dia] : Array.from({ length: 7 }, (_, i) => sumarDias(semana, i)).filter((d) => !finde(d)
    || eventos.some((e) => fechaIso(e.hora) === d) || (datos?.plan ?? []).some((p) => p.dia === d))

  // Las mismas cuentas que el tablero: lugares visitados (con visita o «Llegué acá», por día) de los del plan,
  // médicos atendidos (visitas en que lo vio), médicos distintos, «no lo vio» (no estaba, sin acceso…) y muestras.
  const resumen = datos && {
    lugares: new Set([...datos.llegadas.map((l) => `${fechaIso(l.fecha_hora)}${l.lugar_id}`), ...datos.visitas.map((v) => `${fechaIso(v.fecha_hora)}${v.cliente_id}`)]).size,
    lugaresPlan: datos.plan.length,
    noVisitados: datos.noVisitados.length,
    atendidos: datos.visitas.filter((v) => !noLoVio(v.resultado?.nombre)).length,
    distintos: new Set(datos.visitas.filter((v) => !noLoVio(v.resultado?.nombre)).map((v) => v.medico_id).filter(Boolean)).size,
    noVio: datos.visitas.filter((v) => noLoVio(v.resultado?.nombre)).length,
    muestras: datos.visitas.reduce((s, v) => s + totalMuestras(v), 0),
  }
  const dias7 = Array.from({ length: 7 }, (_, i) => sumarDias(dia, i - 6)).filter((d) => d === dia || !finde(d)
    || !ultimos || ultimos.visitas.some((x) => fechaIso(x.fecha_hora) === d) || ultimos.llegadas.some((x) => fechaIso(x.fecha_hora) === d))
  // Tabla de la derecha: en la vista día, los últimos 7 días; en la semana, cada día de la semana.
  const filasTabla = vista === 'dia'
    ? dias7.map((d) => ({ d, v: ultimos ? delDia(d, ultimos.visitas) : null, l: ultimos ? delDia(d, ultimos.llegadas) : null }))
    : dias.map((d) => ({ d, v: datos ? delDia(d, datos.visitas) : null, l: datos ? delDia(d, datos.llegadas) : null }))

  function excel() {
    if (!datos) return
    descargarCsv(vista === 'dia' ? `actividad_medica_${dia}` : `actividad_medica_semana_${semana}`, [
      { titulo: 'Visitadora', valor: (e: Evento) => nombre(e.vendedor_id) },
      { titulo: 'Día', valor: (e: Evento) => fmtFecha(fechaIso(e.hora)) },
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

  const verDia = (d: string) => { setVista('dia'); setDia(d) }
  const boton = 'grid size-10 place-items-center rounded-lg border border-borde hover:bg-fondo disabled:opacity-40'
  return (
    <div className="flex flex-col gap-8">
    <Tablero />
    <section id="actividad" className="flex scroll-mt-4 flex-col gap-4" aria-labelledby="actividad-medica">
      <div>
        <h2 id="actividad-medica" className="text-lg font-semibold">{vista === 'dia' ? 'Actividad del día' : 'Actividad de la semana'}</h2>
        <p className="text-sm text-tenue">Qué hizo cada visitadora: a qué hora llegó a cada lugar, a qué médicos vio y qué dejó, contra lo que tenía planeado.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-borde p-0.5" role="group" aria-label="Ver por">
          {(['dia', 'semana'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={vista === v} onClick={() => setVista(v)}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium', vista === v ? 'bg-marca text-sobre-marca' : 'text-tinta hover:bg-fondo')}>
              {v === 'dia' ? 'Día' : 'Semana'}
            </button>
          ))}
        </div>
        {vista === 'dia' ? (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Día anterior" className={boton} onClick={() => setDia(sumarDias(dia, -1))}><ChevronLeft className="size-4" aria-hidden /></button>
            <Entrada type="date" aria-label="Día" value={dia} max={hoy} onChange={(e) => e.target.value && setDia(e.target.value)} className="w-44" />
            <button type="button" aria-label="Día siguiente" disabled={dia >= hoy} className={boton} onClick={() => setDia(sumarDias(dia, 1))}><ChevronRight className="size-4" aria-hidden /></button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Semana anterior" className={boton} onClick={() => setSemana(sumarDias(semana, -7))}><ChevronLeft className="size-4" aria-hidden /></button>
            <span className="px-2 text-sm font-medium tabular">{fmtFecha(semana)} al {fmtFecha(sumarDias(semana, 5))}</span>
            <button type="button" aria-label="Semana siguiente" disabled={sumarDias(semana, 7) > hoy} className={boton} onClick={() => setSemana(sumarDias(semana, 7))}><ChevronRight className="size-4" aria-hidden /></button>
          </div>
        )}
        {vista === 'dia' && dia !== hoy && <Boton variante="fantasma" onClick={() => setDia(hoy)}>Hoy</Boton>}
        {visitadoras.length > 1 && (
          <Selector aria-label="Visitadora" value={quien} onChange={(e) => setQuien(e.target.value)} className="w-auto">
            <option value="">Todas las visitadoras</option>
            {visitadoras.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
        )}
        <Boton variante="secundario" className="ml-auto" disabled={!eventos.length} onClick={excel}>{vista === 'dia' ? 'Excel del día' : 'Excel de la semana'}</Boton>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {([
          ['Lugares visitados', resumen && (resumen.lugaresPlan ? `${resumen.lugares} de ${resumen.lugaresPlan}` : resumen.lugares), resumen?.lugaresPlan ? 'del plan' : 'sin plan cargado'],
          ['Médicos atendidos', resumen?.atendidos, resumen ? `${resumen.distintos} médicos distintos` : ''],
          ['No lo vio', resumen?.noVio, 'no estaba, sin acceso, pidió volver…'],
          ['Muestras entregadas', resumen?.muestras, ''],
          ['No pudo visitar', resumen?.noVisitados, 'lugares, con motivo'],
        ] as [string, string | number | null | undefined, string][]).map(([t, n, sub]) => (
          <Tarjeta key={t}>
            <p className="text-xs uppercase tracking-wide text-tenue">{t}</p>
            <p className="text-2xl font-semibold tabular">{n ?? '–'}</p>
            {sub && <p className="text-xs text-tenue">{sub}</p>}
          </Tarjeta>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          {datos === null && <div className="h-40 animate-pulse rounded-xl bg-borde/40" />}
          {datos && conAlgo.length === 0 && (
            <Vacio titulo={vista === 'dia' ? `Sin actividad el ${fmtFecha(dia)}` : 'Sin actividad esta semana'}>No marcó llegadas ni registró visitas, y no tenía plan.</Vacio>
          )}
          {datos && conAlgo.map((id) => (
            <Tarjeta key={id} className="flex flex-col gap-1">
              <h3 className="mb-2 font-semibold">{nombre(id)}</h3>
              {dias.map((d) => {
                const lista = eventos.filter((e) => e.vendedor_id === id && fechaIso(e.hora) === d)
                const plan = datos.plan.filter((p) => p.vendedor_id === id && p.dia === d)
                const delD = { visitas: delDia(d, datos.visitas), llegadas: delDia(d, datos.llegadas), noVisitados: delDia(d, datos.noVisitados) }
                return (
                  <div key={d} className={cn(vista === 'semana' && 'border-t border-borde pt-3 first-of-type:border-0 first-of-type:pt-0')}>
                    {vista === 'semana' && (
                      <button type="button" onClick={() => verDia(d)} className="mb-2 text-sm font-semibold capitalize text-marca underline-offset-2 hover:underline">{fmtDia(d)}</button>
                    )}
                    <PlanDelDia plan={plan} datos={delD} vendedorId={id} dia={d} />
                    {lista.length > 0 ? (
                      <ol className="relative mb-2 flex flex-col gap-3 border-l-2 border-borde pl-5">
                        {lista.map((e, i) => <EventoFila key={i} e={e} />)}
                      </ol>
                    ) : <p className="mb-2 text-sm text-tenue">{d > hoy ? 'Todavía no llegó este día.' : 'No marcó llegadas ni registró visitas.'}</p>}
                  </div>
                )
              })}
            </Tarjeta>
          ))}
        </div>

        <Tarjeta className="flex h-fit flex-col gap-2">
          <h2 className="font-semibold">{vista === 'dia' ? 'Últimos 7 días' : 'Día por día'}</h2>
          <table className="w-full text-sm tabular">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="py-1.5 font-medium">Día</th><th className="py-1.5 pl-2 text-right font-medium">Lugares</th><th className="py-1.5 pl-2 text-right font-medium" title="Médicos atendidos">Atendidos</th><th className="py-1.5 pl-2 text-right font-medium">Muestras</th>
            </tr></thead>
            <tbody>
              {filasTabla.map(({ d, v, l }) => (
                <tr key={d} className={cn('border-b border-borde last:border-0', vista === 'dia' && d === dia && 'font-semibold')}>
                  <td className="py-1.5"><button type="button" className="whitespace-nowrap capitalize underline-offset-2 hover:underline" onClick={() => verDia(d)}>{fmtDia(d)}</button></td>
                  <td className="py-1.5 text-right">{v && l ? new Set([...l.map((x) => x.lugar_id), ...v.map((x) => x.cliente_id)]).size : '–'}</td>
                  <td className="py-1.5 text-right">{v ? v.filter((x) => !noLoVio(x.resultado?.nombre)).length : '–'}</td>
                  <td className="py-1.5 text-right">{v ? v.reduce((s, x) => s + totalMuestras(x), 0) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-tenue">Tocá un día para ver su detalle. El recorrido en el mapa está en <Link href="/medica/en-vivo" className="underline">En vivo</Link>.</p>
        </Tarjeta>
      </div>
    </section>
    </div>
  )
}

// Plan del día contra lo que hizo, lado a lado. A la izquierda lo que le armó el supervisor (lugar en orden,
// hora pactada y médicos a ver); a la derecha lo que pasó (a qué hora llegó y en qué orden, y con cada médico:
// visitado, no estaba / sin acceso con el motivo, no lo vio o pendiente). Abajo, los lugares que visitó sin
// estar en el plan. Un médico cargado dos veces cuenta como el mismo (por el nombre).
function PlanDelDia({ plan, datos, vendedorId, dia }: {
  plan: ParadaPlan[]; vendedorId: string; dia: string
  datos: { visitas: VisitaMedica[]; llegadas: Llegada[]; noVisitados: NoVisitado[] }
}) {
  if (!plan.length) return null
  const pasado = dia < hoyIso()
  const visitas = datos.visitas.filter((v) => v.vendedor_id === vendedorId)
  const llegadas = datos.llegadas.filter((l) => l.vendedor_id === vendedorId)
  const noVisitados = datos.noVisitados.filter((n) => n.vendedor_id === vendedorId)
  // Orden real: la primera vez que pasó por cada lugar (llegada, visita o «no pude visitar»).
  const primeraVez = new Map<string, string>()
  for (const x of [...llegadas.map((l) => [l.lugar_id, l.fecha_hora]), ...visitas.map((v) => [v.cliente_id, v.fecha_hora]), ...noVisitados.map((n) => [n.lugar_id, n.fecha_hora])] as [string, string][]) {
    if (!primeraVez.has(x[0]) || x[1] < primeraVez.get(x[0])!) primeraVez.set(x[0], x[1])
  }
  const ordenReal = [...primeraVez].sort((a, b) => a[1].localeCompare(b[1])).map(([id]) => id)
  const enPlan = new Set(plan.map((p) => p.cliente_id))
  const fueraDelPlan = ordenReal.filter((id) => !enPlan.has(id))
  const vistos = plan.reduce((s, p) => s + p.objetivos.filter((o) => visitas.some((v) => v.cliente_id === p.cliente_id && cumple(o, v) && !noLoVio(v.resultado?.nombre))).length, 0)
  const total = plan.reduce((s, p) => s + p.objetivos.length, 0)
  const lugaresHechos = plan.filter((p) => primeraVez.has(p.cliente_id)).length

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-borde">
      <p className="border-b border-borde bg-fondo px-3 py-2 text-sm">
        <b>Plan del día y lo que hizo</b>
        <span className="text-tenue"> · fue a {lugaresHechos} de {plan.length} lugares{total > 0 && ` · vio ${vistos} de ${total} médicos del plan`}{fueraDelPlan.length > 0 && ` · ${fueraDelPlan.length} lugar${fueraDelPlan.length === 1 ? '' : 'es'} fuera del plan`}</span>
      </p>
      <div className="hidden grid-cols-2 border-b border-borde text-xs font-medium uppercase tracking-wide text-tenue md:grid">
        <p className="px-3 py-1.5">Plan y si lo cumplió</p><p className="border-l border-borde px-3 py-1.5">Llegada y fuera del plan</p>
      </div>
      <ol>
        {plan.map((p, i) => {
          const vs = visitas.filter((v) => v.cliente_id === p.cliente_id)
          const ll = llegadas.filter((l) => l.lugar_id === p.cliente_id)
          const noPudo = noVisitados.find((n) => n.lugar_id === p.cliente_id)
          const fuera = vs.filter((v) => !p.objetivos.some((o) => cumple(o, v)))
          const estuvo = primeraVez.has(p.cliente_id)
          const pactada = p.hora_pactada?.slice(0, 5) ?? null
          const llegoMin = ll[0] ? minutosDelDia(ll[0].fecha_hora) : null
          const atraso = pactada && llegoMin != null ? llegoMin - (minDeHora(pactada) ?? llegoMin) : null
          const posicion = ordenReal.indexOf(p.cliente_id)
          return (
            <li key={p.id} className="grid border-b border-borde text-sm last:border-0 md:grid-cols-2">
              {/* Plan, médico por médico con lo que pasó al lado (✓ lo vio, naranja con motivo, ✗ no lo vio, pendiente). */}
              <div className="px-3 py-2">
                <p><span className="font-semibold tabular">{i + 1}.</span> <b>{p.lugar}</b>{pactada && <span className="tabular text-tenue"> · pactado {pactada}</span>}</p>
                {p.objetivos.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-1 pl-4">
                    {p.objetivos.map((o, j) => {
                      const v = vs.find((x) => cumple(o, x) && !noLoVio(x.resultado?.nombre))
                      const noEstaba = v ? undefined : vs.find((x) => cumple(o, x))
                      const nota = (v ?? noEstaba)?.observaciones
                      const hMed = o.hora_pactada?.slice(0, 5) ?? null
                      const dif = hMed && v ? minutosDelDia(v.fecha_hora) - (minDeHora(hMed) ?? minutosDelDia(v.fecha_hora)) : null
                      return (
                        <li key={j} className="flex items-start gap-1.5">
                          {v ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-700 dark:text-green-400" aria-label="Lo vio" />
                            : noEstaba || noPudo ? <CircleSlash className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-label="No lo vio, con motivo" />
                            : estuvo || pasado ? <XCircle className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-400" aria-label="No lo vio" />
                            : <CircleDashed className="mt-0.5 size-4 shrink-0 text-tenue" aria-label="Pendiente" />}
                          <span>
                            {hMed && <span className="tabular text-tenue">{hMed} · </span>}
                            {o.medico?.nombre ?? `Buscar ${o.especialidad ?? 'médico'}`}
                            {(o.medico?.especialidad ?? (o.medico ? null : o.especialidad)) && <span className="text-tenue"> · {o.medico?.especialidad ?? o.especialidad}</span>}
                            {' '}<span className={cn('text-xs font-medium', v ? 'text-green-800 dark:text-green-300' : noEstaba || noPudo ? 'text-amber-800 dark:text-amber-300' : estuvo || pasado ? 'text-red-800 dark:text-red-300' : 'text-tenue')}>
                              {v ? `visitado ${fmtSoloHora(v.fecha_hora)} · ${v.resultado?.nombre ?? 'Visitado'}${!o.medico_id && v.medico ? ` (${v.medico.nombre})` : ''}`
                                : noEstaba ? `no lo vio · ${noEstaba.resultado?.nombre ?? 'sin motivo'} (${fmtSoloHora(noEstaba.fecha_hora)})`
                                : noPudo ? 'no pudo visitar el lugar'
                                : estuvo || pasado ? 'no lo vio (sin motivo cargado)' : 'pendiente'}
                            </span>
                            {dif != null && Math.abs(dif) >= 5 && <span className={cn('text-xs', dif > 15 ? 'text-red-800 dark:text-red-300' : 'text-tenue')}> · {dif > 0 ? `${dif} min tarde` : `${-dif} min antes`}</span>}
                            {nota && <span className="block text-xs text-tenue">«{nota}»</span>}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : <p className="mt-1 pl-4 text-xs text-tenue">Sin médicos asignados.</p>}
              </div>
              {/* Llegada y lo que hizo fuera del plan en ese lugar. */}
              <div className="border-t border-borde bg-fondo/40 px-3 py-2 md:border-l md:border-t-0">
                <p className={cn('font-medium', estuvo ? 'text-tinta' : pasado ? 'text-red-800 dark:text-red-300' : 'text-tenue')}>
                  {ll.length ? <>Llegó {ll.map((l) => fmtSoloHora(l.fecha_hora)).join(' y ')}</>
                    : vs.length ? 'Visitó sin marcar «Llegué acá»'
                    : noPudo ? <span className="text-amber-800 dark:text-amber-300">No pudo visitar: {textoMotivo(noPudo.motivo)}</span>
                    : pasado ? 'No fue' : 'Todavía no llegó'}
                  {atraso != null && atraso !== 0 && <span className={cn('text-xs', atraso > 15 ? 'text-red-800 dark:text-red-300' : 'text-tenue')}> · {atraso > 0 ? `${atraso} min tarde` : `${-atraso} min antes`}</span>}
                  {posicion >= 0 && posicion !== i && <span className="text-xs text-tenue"> · fue el {posicion + 1}.º lugar del día</span>}
                </p>
                {noPudo?.observaciones && <p className="text-xs text-tenue">«{noPudo.observaciones}»</p>}
                {fuera.length > 0 ? (
                  <>
                    <p className="mt-1.5 text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">Fuera del plan</p>
                    <ul className="mt-0.5 flex flex-col gap-1">
                      {fuera.map((v) => (
                        <li key={v.id} className="flex items-start gap-1.5">
                          <Stethoscope className="mt-0.5 size-4 shrink-0 text-marca" aria-hidden />
                          <span><span className="tabular text-tenue">{fmtSoloHora(v.fecha_hora)}</span> {v.medico?.nombre ?? 'Visita'}{v.medico?.especialidad && <span className="text-tenue"> · {v.medico.especialidad}</span>}
                            {v.resultado && <span className="text-xs font-medium text-tenue"> · {v.resultado.nombre}</span>}
                            {v.observaciones && <span className="block text-xs text-tenue">«{v.observaciones}»</span>}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : estuvo && <p className="mt-1 text-xs text-tenue">Nada fuera del plan.</p>}
              </div>
            </li>
          )
        })}
        {fueraDelPlan.map((id) => {
          const vs = visitas.filter((v) => v.cliente_id === id)
          const ll = llegadas.filter((l) => l.lugar_id === id)
          const noPudo = noVisitados.find((n) => n.lugar_id === id)
          const lugar = ll[0]?.lugar?.razon_social ?? vs[0]?.lugar?.razon_social ?? noPudo?.lugar?.razon_social ?? 'Lugar'
          return (
            <li key={id} className="grid border-b border-borde text-sm last:border-0 md:grid-cols-2">
              <div className="px-3 py-2 text-tenue">— No estaba en el plan</div>
              <div className="border-t border-borde bg-fondo/40 px-3 py-2 md:border-l md:border-t-0">
                <p><b>{lugar}</b> <span className="text-amber-800 dark:text-amber-300">· fuera del plan</span>
                  <span className="text-tenue"> · {ll.length ? `llegó ${ll.map((l) => fmtSoloHora(l.fecha_hora)).join(' y ')}` : noPudo ? `no pudo visitar (${textoMotivo(noPudo.motivo)})` : 'sin «Llegué acá»'}</span></p>
                {vs.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {vs.map((v) => (
                      <li key={v.id} className="flex items-start gap-1.5">
                        <Stethoscope className="mt-0.5 size-4 shrink-0 text-marca" aria-hidden />
                        <span><span className="font-medium">{fmtSoloHora(v.fecha_hora)} {v.medico?.nombre ?? 'Visita'}</span>{v.resultado && <span className="text-tenue"> · {v.resultado.nombre}</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Una visita cumple un objetivo si es a ese médico (o al mismo cargado dos veces), o (objetivo por especialidad) a un médico de esa especialidad. */
function cumple(o: ParadaPlan['objetivos'][number], v: VisitaMedica) {
  if (o.medico_id) return mismoMedico({ id: o.medico_id, nombre: o.medico?.nombre }, { id: v.medico_id, nombre: v.medico?.nombre })
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
