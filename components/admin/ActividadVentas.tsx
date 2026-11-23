'use client'
// Tablero de Ventas (Vitalica): qué hizo cada vendedor en el día o en la semana, hora por hora (jornada, visitas con resultado,
// pedido, cobranza, observaciones y próxima visita, y los clientes que marcó «No pude visitarlo»), y los
// últimos 7 días. Igual que la Actividad de visita médica.
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleMinus, LogIn, LogOut, Store } from 'lucide-react'
import { Aviso, Boton, Entrada, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { descargarCsv } from '@/lib/csv'
import { fechaIso, fmtDia, fmtFecha, fmtGuaranies, fmtSoloHora, sumarDias } from '@/lib/fechas'
import { textoMotivo } from '@/lib/medicos'
import { useParamUrl } from '@/lib/useParamUrl'
import { useSemanaDia } from '@/lib/useSemanaDia'
import { cn, mensajeError } from '@/lib/utils'

type VisitaVenta = {
  id: string; vendedor_id: string; cliente_id: string; fecha_hora: string; hizo_pedido: boolean; hizo_cobranza: boolean
  monto_cobrado_gs: number | null; observaciones: string | null; proxima_visita: string | null; ruta_parada_id: string | null
  resultado: { nombre: string } | null; cliente: { razon_social: string; ciudad: string | null } | null
}
type NoConcretada = { id: string; vendedor_id: string; lugar_id: string; fecha_hora: string; motivo: string; observaciones: string | null; cliente: { razon_social: string } | null }
type Jornada = { vendedor_id: string; inicio: string; fin: string | null }
type Evento =
  | { tipo: 'inicio' | 'fin'; hora: string; vendedor_id: string }
  | { tipo: 'no_concretada'; hora: string; vendedor_id: string; n: NoConcretada }
  | { tipo: 'visita'; hora: string; vendedor_id: string; v: VisitaVenta }

const CAMPOS = 'id, vendedor_id, cliente_id, fecha_hora, hizo_pedido, hizo_cobranza, monto_cobrado_gs, observaciones, proxima_visita, ruta_parada_id, '
  + 'resultado:vis_resultados!vis_visitas_resultado_id_fkey(nombre), cliente:vis_clientes!vis_visitas_cliente_id_fkey(razon_social, ciudad)'
const ini = (d: string) => new Date(`${d}T00:00:00-03:00`).toISOString()
const finde = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())

async function leer(ids: string[], desde: string, hasta: string) {
  const sb = supabaseNavegador()
  const [v, n, j] = await Promise.all([
    sb.from('vis_visitas').select(CAMPOS).in('vendedor_id', ids).eq('origen', 'app')
      .gte('fecha_hora', ini(desde)).lt('fecha_hora', ini(sumarDias(hasta, 1))).order('fecha_hora').limit(5000),
    sb.from('vis_no_visitados').select('id, vendedor_id, lugar_id, fecha_hora, motivo, observaciones, cliente:vis_clientes!vis_no_visitados_lugar_id_fkey(razon_social)')
      .in('vendedor_id', ids).gte('fecha_hora', ini(desde)).lt('fecha_hora', ini(sumarDias(hasta, 1))).order('fecha_hora').limit(5000),
    sb.from('vis_jornadas').select('vendedor_id, inicio, fin').in('vendedor_id', ids).gte('inicio', ini(desde)).lt('inicio', ini(sumarDias(hasta, 1))),
  ])
  const e = v.error ?? n.error ?? j.error
  if (e) throw new Error(mensajeError(e))
  return { visitas: (v.data ?? []) as unknown as VisitaVenta[], noConcretadas: (n.data ?? []) as unknown as NoConcretada[], jornadas: (j.data ?? []) as Jornada[] }
}

export function ActividadVentas({ vendedores }: { vendedores: { id: string; nombre: string }[] }) {
  const { semana, setSemana, dia, setDia, vista, setVista, hoy } = useSemanaDia()
  const [quien, setQuien] = useParamUrl('vendedor', '')
  const [desde, hasta] = vista === 'semana' ? [semana, sumarDias(semana, 6)] : [dia, dia]
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof leer>> | null>(null)
  const [ultimos, setUltimos] = useState<Awaited<ReturnType<typeof leer>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const clave = vendedores.map((v) => v.id).join(',')
  const ids = useMemo(() => vendedores.filter((v) => !quien || v.id === quien).map((v) => v.id), [clave, quien]) // eslint-disable-line react-hooks/exhaustive-deps
  const nombre = (id: string) => vendedores.find((v) => v.id === id)?.nombre ?? '—'

  useEffect(() => {
    if (!ids.length) { setDatos({ visitas: [], noConcretadas: [], jornadas: [] }); return }
    let vivo = true
    setDatos(null)
    leer(ids, desde, hasta).then((d) => { if (vivo) { setError(null); setDatos(d) } })
      .catch((e: Error) => { if (vivo) { setError(e.message); setDatos({ visitas: [], noConcretadas: [], jornadas: [] }) } })
    return () => { vivo = false }
  }, [ids, desde, hasta])

  // Vista día: los últimos 7 días hasta el día elegido.
  useEffect(() => {
    if (!ids.length || vista !== 'dia') return
    let vivo = true
    leer(ids, sumarDias(dia, -6), dia).then((d) => { if (vivo) setUltimos(d) }).catch(() => {})
    return () => { vivo = false }
  }, [ids, dia, vista])

  const eventos = useMemo<Evento[]>(() => {
    if (!datos) return []
    return [
      ...datos.jornadas.flatMap((j) => [
        { tipo: 'inicio' as const, hora: j.inicio, vendedor_id: j.vendedor_id },
        ...(j.fin ? [{ tipo: 'fin' as const, hora: j.fin, vendedor_id: j.vendedor_id }] : []),
      ]),
      ...datos.noConcretadas.map((n) => ({ tipo: 'no_concretada' as const, hora: n.fecha_hora, vendedor_id: n.vendedor_id, n })),
      ...datos.visitas.map((v) => ({ tipo: 'visita' as const, hora: v.fecha_hora, vendedor_id: v.vendedor_id, v })),
    ].sort((a, b) => a.hora.localeCompare(b.hora))
  }, [datos])
  // Vendedores con actividad en el período, y días a mostrar (en la semana, lunes a viernes y el finde si hubo algo).
  const conAlgo = useMemo(() => [...new Set(eventos.map((e) => e.vendedor_id))].sort((x, y) => nombre(x).localeCompare(nombre(y), 'es')), [eventos]) // eslint-disable-line react-hooks/exhaustive-deps
  const dias = vista === 'dia' ? [dia] : Array.from({ length: 7 }, (_, i) => sumarDias(semana, i)).filter((d) => !finde(d) || eventos.some((e) => fechaIso(e.hora) === d))

  const resumen = datos && {
    clientes: new Set(datos.visitas.map((v) => v.cliente_id)).size,
    visitas: datos.visitas.length,
    pedidos: datos.visitas.filter((v) => v.hizo_pedido).length,
    fuera: datos.visitas.filter((v) => !v.ruta_parada_id).length,
    noConcretadas: datos.noConcretadas.length,
  }
  const dias7 = Array.from({ length: 7 }, (_, i) => sumarDias(dia, i - 6)).filter((d) => d === dia || !finde(d)
    || !ultimos || ultimos.visitas.some((x) => fechaIso(x.fecha_hora) === d) || ultimos.noConcretadas.some((x) => fechaIso(x.fecha_hora) === d))
  // Tabla de la derecha: en la vista día, los últimos 7 días; en la semana, cada día de la semana.
  const fuenteTabla = vista === 'dia' ? ultimos : datos
  const filasTabla = vista === 'dia' ? dias7 : dias
  const verDia = (d: string) => { setVista('dia'); setDia(d) }
  const boton = 'grid size-10 place-items-center rounded-lg border border-borde hover:bg-fondo disabled:opacity-40'

  function excel() {
    descargarCsv(vista === 'dia' ? `actividad_ventas_${dia}` : `actividad_ventas_semana_${semana}`, [
      { titulo: 'Vendedor', valor: (e: Evento) => nombre(e.vendedor_id) },
      { titulo: 'Día', valor: (e: Evento) => fmtFecha(fechaIso(e.hora)) },
      { titulo: 'Hora', valor: (e: Evento) => fmtSoloHora(e.hora) },
      { titulo: 'Qué', valor: (e: Evento) => (e.tipo === 'inicio' ? 'Inició la jornada' : e.tipo === 'fin' ? 'Terminó la jornada' : e.tipo === 'no_concretada' ? 'No concretada' : 'Visita') },
      { titulo: 'Cliente', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.cliente?.razon_social : e.tipo === 'no_concretada' ? e.n.cliente?.razon_social : '') ?? '' },
      { titulo: 'Ciudad', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.cliente?.ciudad ?? '' : '') },
      { titulo: 'Resultado', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.resultado?.nombre ?? '' : e.tipo === 'no_concretada' ? textoMotivo(e.n.motivo) : '') },
      { titulo: 'Pedido', valor: (e: Evento) => (e.tipo === 'visita' ? (e.v.hizo_pedido ? 'Sí' : 'No') : '') },
      { titulo: 'Cobrado (Gs.)', valor: (e: Evento) => (e.tipo === 'visita' && e.v.hizo_cobranza ? Math.round(Number(e.v.monto_cobrado_gs ?? 0)) : '') },
      { titulo: 'Fuera de ruta', valor: (e: Evento) => (e.tipo === 'visita' ? (e.v.ruta_parada_id ? 'No' : 'Sí') : '') },
      { titulo: 'Observaciones', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.observaciones ?? '' : e.tipo === 'no_concretada' ? e.n.observaciones ?? '' : '') },
      { titulo: 'Próxima visita', valor: (e: Evento) => (e.tipo === 'visita' && e.v.proxima_visita ? fmtFecha(e.v.proxima_visita) : '') },
    ], eventos)
  }

  return (
    <section id="actividad" className="flex scroll-mt-4 flex-col gap-4" aria-labelledby="actividad-ventas">
      <div>
        <h2 id="actividad-ventas" className="text-lg font-semibold">{vista === 'dia' ? 'Actividad del día' : 'Actividad de la semana'}</h2>
        <p className="text-sm text-tenue">Qué hizo cada vendedor, hora por hora: a qué clientes visitó, qué pasó en cada visita y cuáles no pudo visitar.</p>
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
        {vendedores.length > 1 && (
          <Selector aria-label="Vendedor" value={quien} onChange={(e) => setQuien(e.target.value)} className="w-auto">
            <option value="">Todos los vendedores</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
        )}
        <Boton variante="secundario" className="ml-auto" disabled={!eventos.length} onClick={excel}>{vista === 'dia' ? 'Excel del día' : 'Excel de la semana'}</Boton>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Clientes', resumen?.clientes], ['Visitas', resumen?.visitas], ['Con pedido', resumen?.pedidos], ['Fuera de ruta', resumen?.fuera], ['No concretadas', resumen?.noConcretadas]].map(([t, n]) => (
          <Tarjeta key={t as string}><p className="text-xs uppercase tracking-wide text-tenue">{t}</p><p className="text-2xl font-semibold tabular">{n ?? '–'}</p></Tarjeta>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          {datos === null && <div className="h-40 animate-pulse rounded-xl bg-borde/40" />}
          {datos && conAlgo.length === 0 && (
            <Vacio titulo={vista === 'dia' ? `Sin actividad el ${fmtFecha(dia)}` : 'Sin actividad esta semana'}>No inició jornada ni registró visitas.</Vacio>
          )}
          {conAlgo.map((id) => (
            <Tarjeta key={id} className="flex flex-col gap-1">
              <h3 className="mb-2 font-semibold">{nombre(id)}</h3>
              {dias.map((d) => {
                const lista = eventos.filter((e) => e.vendedor_id === id && fechaIso(e.hora) === d)
                if (vista === 'semana' && !lista.length) return null
                return (
                  <div key={d} className={cn(vista === 'semana' && 'border-t border-borde pt-3 first-of-type:border-0 first-of-type:pt-0')}>
                    {vista === 'semana' && (
                      <button type="button" onClick={() => verDia(d)} className="mb-2 text-sm font-semibold capitalize text-marca underline-offset-2 hover:underline">{fmtDia(d)}</button>
                    )}
                    <ol className="relative mb-2 flex flex-col gap-3 border-l-2 border-borde pl-5">
                      {lista.map((e, i) => <EventoFila key={i} e={e} />)}
                    </ol>
                  </div>
                )
              })}
            </Tarjeta>
          ))}
        </div>

        <Tarjeta className="flex h-fit flex-col gap-2">
          <h3 className="font-semibold">{vista === 'dia' ? 'Últimos 7 días' : 'Día por día'}</h3>
          <table className="w-full text-sm tabular">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="py-1.5 font-medium">Día</th><th className="py-1.5 pl-2 text-right font-medium">Clientes</th><th className="py-1.5 pl-2 text-right font-medium">Pedidos</th><th className="py-1.5 pl-2 text-right font-medium">No concr.</th>
            </tr></thead>
            <tbody>
              {filasTabla.map((d) => {
                const v = fuenteTabla ? fuenteTabla.visitas.filter((x) => fechaIso(x.fecha_hora) === d) : []
                const n = fuenteTabla ? fuenteTabla.noConcretadas.filter((x) => fechaIso(x.fecha_hora) === d) : []
                return (
                  <tr key={d} className={cn('border-b border-borde last:border-0', vista === 'dia' && d === dia && 'font-semibold')}>
                    <td className="py-1.5"><button type="button" className="whitespace-nowrap capitalize underline-offset-2 hover:underline" onClick={() => verDia(d)}>{fmtDia(d)}</button></td>
                    <td className="py-1.5 text-right">{fuenteTabla ? new Set(v.map((x) => x.cliente_id)).size : '–'}</td>
                    <td className="py-1.5 text-right">{fuenteTabla ? v.filter((x) => x.hizo_pedido).length : '–'}</td>
                    <td className="py-1.5 text-right">{fuenteTabla ? n.length : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-xs text-tenue">Tocá un día para ver su detalle. El recorrido en el mapa está en En vivo.</p>
        </Tarjeta>
      </div>
    </section>
  )
}

function EventoFila({ e }: { e: Evento }) {
  const punto = (Icono: typeof Store, clase: string) => (
    <span className={cn('absolute -left-[33px] -top-0.5 grid size-6 place-items-center rounded-full border-2 border-superficie', clase)}><Icono className="size-3.5" aria-hidden /></span>
  )
  const hora = <span className="mr-2 font-semibold tabular">{fmtSoloHora(e.hora)}</span>
  if (e.tipo === 'inicio' || e.tipo === 'fin') return (
    <li className="relative text-sm text-tenue">{punto(e.tipo === 'inicio' ? LogIn : LogOut, 'bg-fondo text-tenue')}{hora}{e.tipo === 'inicio' ? 'Inició la jornada' : 'Terminó la jornada'}</li>
  )
  if (e.tipo === 'no_concretada') return (
    <li className="relative text-sm">
      {punto(CircleMinus, 'bg-amber-600 text-white')}
      <p>{hora}<b>No pudo visitar</b> {e.n.cliente?.razon_social ?? 'al cliente'}<span className="text-tenue"> · {textoMotivo(e.n.motivo)}</span></p>
      {e.n.observaciones && <p className="mt-1 rounded-lg bg-fondo px-3 py-2 break-words"><span className="text-tenue">Observación:</span> {e.n.observaciones}</p>}
    </li>
  )
  if (e.tipo !== 'visita') return null
  const v = e.v
  return (
    <li className="relative text-sm">
      {punto(Store, v.hizo_pedido ? 'bg-green-700 text-white' : 'bg-marca text-sobre-marca')}
      <p>{hora}<b>{v.cliente?.razon_social ?? 'Visita'}</b>{v.cliente?.ciudad && <span className="text-tenue"> · {v.cliente.ciudad}</span>}{!v.ruta_parada_id && <span className="text-tenue"> · fuera de ruta</span>}</p>
      <div className="mt-1 flex flex-col gap-0.5 rounded-lg bg-fondo px-3 py-2">
        {v.resultado && <p><span className="text-tenue">Resultado:</span> {v.resultado.nombre}{v.hizo_pedido && <b className="text-green-800 dark:text-green-300"> · con pedido</b>}</p>}
        {v.hizo_cobranza && <p><span className="text-tenue">Cobranza:</span> {fmtGuaranies(v.monto_cobrado_gs)}</p>}
        {v.observaciones && <p className="break-words"><span className="text-tenue">Observaciones:</span> {v.observaciones}</p>}
        {v.proxima_visita && <p><span className="text-tenue">Próxima visita:</span> {fmtFecha(v.proxima_visita)}</p>}
      </div>
    </li>
  )
}
