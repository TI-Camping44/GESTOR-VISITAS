'use client'
// Tablero de Ventas (Vitalica): qué hizo cada vendedor en el día, hora por hora (jornada, visitas con resultado,
// pedido, cobranza, observaciones y próxima visita, y los clientes que marcó «No pude visitarlo»), y los
// últimos 7 días. Igual que la Actividad de visita médica.
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleSlash, LogIn, LogOut, Store } from 'lucide-react'
import { Aviso, Boton, Entrada, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { descargarCsv } from '@/lib/csv'
import { fechaIso, fmtDia, fmtFecha, fmtGuaranies, fmtSoloHora, hoyIso, sumarDias } from '@/lib/fechas'
import { textoMotivo } from '@/lib/medicos'
import { useParamUrl } from '@/lib/useParamUrl'
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
  const [dia, setDia] = useParamUrl('dia', hoyIso())
  const [quien, setQuien] = useParamUrl('vendedor', '')
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof leer>> | null>(null)
  const [semana, setSemana] = useState<Awaited<ReturnType<typeof leer>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const clave = vendedores.map((v) => v.id).join(',')
  const ids = useMemo(() => vendedores.filter((v) => !quien || v.id === quien).map((v) => v.id), [clave, quien]) // eslint-disable-line react-hooks/exhaustive-deps
  const nombre = (id: string) => vendedores.find((v) => v.id === id)?.nombre ?? '—'

  useEffect(() => {
    if (!ids.length) { setDatos({ visitas: [], noConcretadas: [], jornadas: [] }); return }
    let vivo = true
    setDatos(null)
    leer(ids, dia, dia).then((d) => { if (vivo) { setError(null); setDatos(d) } })
      .catch((e: Error) => { if (vivo) { setError(e.message); setDatos({ visitas: [], noConcretadas: [], jornadas: [] }) } })
    return () => { vivo = false }
  }, [ids, dia])

  // Últimos 7 días hasta el día elegido.
  useEffect(() => {
    if (!ids.length) return
    let vivo = true
    leer(ids, sumarDias(dia, -6), dia).then((d) => { if (vivo) setSemana(d) }).catch(() => {})
    return () => { vivo = false }
  }, [ids, dia])

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
  const porVendedor = useMemo(() => {
    const m = new Map<string, Evento[]>()
    for (const e of eventos) m.set(e.vendedor_id, [...(m.get(e.vendedor_id) ?? []), e])
    return [...m]
  }, [eventos])

  const resumen = datos && {
    clientes: new Set(datos.visitas.map((v) => v.cliente_id)).size,
    visitas: datos.visitas.length,
    pedidos: datos.visitas.filter((v) => v.hizo_pedido).length,
    fuera: datos.visitas.filter((v) => !v.ruta_parada_id).length,
    noConcretadas: datos.noConcretadas.length,
  }
  const dias7 = Array.from({ length: 7 }, (_, i) => sumarDias(dia, i - 6))

  function excel() {
    descargarCsv(`actividad_ventas_${dia}`, [
      { titulo: 'Vendedor', valor: (e: Evento) => nombre(e.vendedor_id) },
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
    <section className="flex flex-col gap-4" aria-labelledby="actividad-ventas">
      <div>
        <h2 id="actividad-ventas" className="text-lg font-semibold">Actividad del día</h2>
        <p className="text-sm text-tenue">Qué hizo cada vendedor, hora por hora: a qué clientes visitó, qué pasó en cada visita y cuáles no pudo visitar.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Día anterior" className="grid size-10 place-items-center rounded-lg border border-borde hover:bg-fondo" onClick={() => setDia(sumarDias(dia, -1))}><ChevronLeft className="size-4" aria-hidden /></button>
          <Entrada type="date" aria-label="Día" value={dia} max={hoyIso()} onChange={(e) => e.target.value && setDia(e.target.value)} className="w-44" />
          <button type="button" aria-label="Día siguiente" disabled={dia >= hoyIso()} className="grid size-10 place-items-center rounded-lg border border-borde hover:bg-fondo disabled:opacity-40" onClick={() => setDia(sumarDias(dia, 1))}><ChevronRight className="size-4" aria-hidden /></button>
        </div>
        {dia !== hoyIso() && <Boton variante="fantasma" onClick={() => setDia(hoyIso())}>Hoy</Boton>}
        {vendedores.length > 1 && (
          <Selector aria-label="Vendedor" value={quien} onChange={(e) => setQuien(e.target.value)} className="w-auto">
            <option value="">Todos los vendedores</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
        )}
        <Boton variante="secundario" className="ml-auto" disabled={!eventos.length} onClick={excel}>Excel del día</Boton>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Clientes', resumen?.clientes], ['Visitas', resumen?.visitas], ['Con pedido', resumen?.pedidos], ['Fuera de ruta', resumen?.fuera], ['No concretadas', resumen?.noConcretadas]].map(([t, n]) => (
          <Tarjeta key={t as string}><p className="text-xs uppercase tracking-wide text-tenue">{t}</p><p className="text-2xl font-semibold tabular">{n ?? '–'}</p></Tarjeta>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          {datos === null && <div className="h-40 animate-pulse rounded-xl bg-borde/40" />}
          {datos && porVendedor.length === 0 && (
            <Vacio titulo={`Sin actividad el ${fmtFecha(dia)}`}>No inició jornada ni registró visitas ese día.</Vacio>
          )}
          {porVendedor.map(([id, lista]) => (
            <Tarjeta key={id} className="flex flex-col gap-1">
              <h3 className="mb-2 font-semibold">{nombre(id)}</h3>
              <ol className="relative flex flex-col gap-3 border-l-2 border-borde pl-5">
                {lista.map((e, i) => <EventoFila key={i} e={e} />)}
              </ol>
            </Tarjeta>
          ))}
        </div>

        <Tarjeta className="flex h-fit flex-col gap-2">
          <h3 className="font-semibold">Últimos 7 días</h3>
          <table className="w-full text-sm tabular">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="py-1.5 font-medium">Día</th><th className="py-1.5 text-right font-medium">Clientes</th><th className="py-1.5 text-right font-medium">Pedidos</th><th className="py-1.5 text-right font-medium">No concr.</th>
            </tr></thead>
            <tbody>
              {dias7.map((d) => {
                const v = semana ? semana.visitas.filter((x) => fechaIso(x.fecha_hora) === d) : []
                const n = semana ? semana.noConcretadas.filter((x) => fechaIso(x.fecha_hora) === d) : []
                return (
                  <tr key={d} className={cn('border-b border-borde last:border-0', d === dia && 'font-semibold')}>
                    <td className="py-1.5"><button type="button" className="capitalize underline-offset-2 hover:underline" onClick={() => setDia(d)}>{fmtDia(d)}</button></td>
                    <td className="py-1.5 text-right">{semana ? new Set(v.map((x) => x.cliente_id)).size : '–'}</td>
                    <td className="py-1.5 text-right">{semana ? v.filter((x) => x.hizo_pedido).length : '–'}</td>
                    <td className="py-1.5 text-right">{semana ? n.length : '–'}</td>
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
      {punto(CircleSlash, 'bg-amber-600 text-white')}
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
