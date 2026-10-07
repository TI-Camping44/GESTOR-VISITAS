'use client'
// Reportes: productividad por vendedor (visitas, pedidos, conversión, cobranzas, km, horas),
// motivos de las visitas, cobertura por zona y clientes descuidados. Todo exportable a Excel.
import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Aviso, Boton, Entrada, PuntoEstado, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtFecha, fmtGuaranies, hace, hoyIso, lunesDe, sumarDias } from '@/lib/fechas'
import { descargarCsv } from '@/lib/csv'
import { cn, mensajeError } from '@/lib/utils'
import type { EstadoCliente } from '@/lib/database.types'

type FilaVendedor = {
  vendedor_id: string; vendedor: string; meta_diaria: number; meta_semanal: number
  dias_con_jornada: number; horas_jornada: number; km: number; visitas: number; dias_con_visitas: number
  clientes_distintos: number; con_pedido: number; cobranzas: number; cobrado_gs: number; fuera_de_ruta: number
  planificadas: number; paradas_visitadas: number; prospectos_nuevos: number; inactivos_visitados: number
  primera_visita_prom: string | null; ultima_visita_prom: string | null
}
type FilaResultado = { resultado: string; es_venta: boolean; visitas: number }
type FilaZona = { zona_id: string; zona: string; color: string; responsable: string | null; clientes: number; activos: number; inactivos: number; visitados: number; visitas: number; con_pedido: number; sin_visita_60d: number }
type FilaDescuidado = { id: string; razon_social: string; ciudad: string | null; zona: string | null; vendedor: string | null; estado: EstadoCliente; ultima_visita: string | null; ultima_factura_fecha: string | null; ventas_6m_gs: number }

type Rango = { desde: string; hasta: string }
function rangos(): Record<string, { texto: string; r: Rango }> {
  const hoy = hoyIso()
  const lunes = lunesDe(hoy)
  const primeroMes = `${hoy.slice(0, 8)}01`
  const primeroMesAnt = `${sumarDias(primeroMes, -1).slice(0, 8)}01`
  return {
    semana: { texto: 'Esta semana', r: { desde: lunes, hasta: hoy } },
    semanaAnt: { texto: 'Semana pasada', r: { desde: sumarDias(lunes, -7), hasta: sumarDias(lunes, -1) } },
    mes: { texto: 'Este mes', r: { desde: primeroMes, hasta: hoy } },
    mesAnt: { texto: 'Mes pasado', r: { desde: primeroMesAnt, hasta: sumarDias(primeroMes, -1) } },
  }
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)
const fmtPct = (n: number | null) => (n == null ? '—' : `${n}%`)
const fmtNum = (n: number, dec = 0) => Number(n).toLocaleString('es-PY', { maximumFractionDigits: dec, minimumFractionDigits: 0 })
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '—')

export default function Reportes() {
  const sb = supabaseNavegador()
  const opciones = useMemo(rangos, [])
  const [preset, setPreset] = useState<string>('semana')
  const [rango, setRango] = useState<Rango>(opciones.semana!.r)
  const [vendedores, setVendedores] = useState<FilaVendedor[] | null>(null)
  const [resultados, setResultados] = useState<FilaResultado[]>([])
  const [zonas, setZonas] = useState<FilaZona[]>([])
  const [diasSinVisita, setDiasSinVisita] = useState(60)
  const [descuidados, setDescuidados] = useState<FilaDescuidado[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setVendedores(null)
    Promise.all([
      sb.rpc('vis_reporte_vendedores', { p_desde: rango.desde, p_hasta: rango.hasta }),
      sb.rpc('vis_reporte_resultados', { p_desde: rango.desde, p_hasta: rango.hasta }),
      sb.rpc('vis_reporte_zonas', { p_desde: rango.desde, p_hasta: rango.hasta }),
    ]).then(([v, r, z]) => {
      if (!vivo) return
      const e = v.error ?? r.error ?? z.error
      if (e) { setError(mensajeError(e)); return }
      setError(null)
      setVendedores((v.data ?? []) as unknown as FilaVendedor[])
      setResultados((r.data ?? []) as unknown as FilaResultado[])
      setZonas((z.data ?? []) as unknown as FilaZona[])
    })
    return () => { vivo = false }
  }, [sb, rango])

  useEffect(() => {
    sb.rpc('vis_clientes_sin_visita', { p_dias: diasSinVisita })
      .then(({ data, error }) => { if (error) setError(mensajeError(error)); else setDescuidados((data ?? []) as unknown as FilaDescuidado[]) })
  }, [sb, diasSinVisita])

  const t = useMemo(() => {
    const l = vendedores ?? []
    const s = (k: keyof FilaVendedor) => l.reduce((a, f) => a + Number(f[k] ?? 0), 0)
    return { visitas: s('visitas'), pedidos: s('con_pedido'), cobrado: s('cobrado_gs'), km: s('km'), horas: s('horas_jornada'), planificadas: s('planificadas'), visitadas: s('paradas_visitadas'), prospectos: s('prospectos_nuevos') }
  }, [vendedores])

  const maxResultado = Math.max(1, ...resultados.map((r) => Number(r.visitas)))
  const sufijo = `${rango.desde}_al_${rango.hasta}`

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reportes</h1>
          <p className="text-sm text-tenue">Del {fmtFecha(rango.desde)} al {fmtFecha(rango.hasta)}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1 rounded-lg border border-borde bg-superficie p-1" role="group" aria-label="Período">
            {Object.entries(opciones).map(([k, o]) => (
              <button key={k} type="button" aria-pressed={preset === k} onClick={() => { setPreset(k); setRango(o.r) }}
                className={cn('rounded-md px-3 py-1.5 text-sm font-medium', preset === k ? 'bg-marca text-white' : 'hover:bg-fondo')}>{o.texto}</button>
            ))}
          </div>
          <Entrada type="date" aria-label="Desde" className="w-40" value={rango.desde} max={rango.hasta} onChange={(e) => { setPreset(''); setRango((r) => ({ ...r, desde: e.target.value })) }} />
          <Entrada type="date" aria-label="Hasta" className="w-40" value={rango.hasta} min={rango.desde} onChange={(e) => { setPreset(''); setRango((r) => ({ ...r, hasta: e.target.value })) }} />
        </div>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      {/* Totales del período */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Visitas', fmtNum(t.visitas), `${fmtPct(pct(t.visitadas, t.planificadas))} de lo planificado`],
          ['Con pedido', fmtNum(t.pedidos), `${fmtPct(pct(t.pedidos, t.visitas))} de conversión`],
          ['Cobrado', fmtGuaranies(t.cobrado), 'en visitas'],
          ['Km recorridos', fmtNum(t.km, 1), t.visitas ? `${fmtNum(t.km / t.visitas, 1)} km por visita` : '—'],
          ['Horas en jornada', fmtNum(t.horas, 1), t.horas ? `${fmtNum(t.visitas / t.horas, 1)} visitas por hora` : '—'],
          ['Clientes nuevos', fmtNum(t.prospectos), 'prospectos dados de alta'],
        ].map(([titulo, valor, detalle]) => (
          <Tarjeta key={titulo} className="p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-tenue">{titulo}</p>
            <p className={cn('mt-1 font-semibold tabular', String(valor).length > 10 ? 'text-lg' : 'text-2xl')}>{vendedores ? valor : '…'}</p>
            <p className="text-xs text-tenue">{vendedores ? detalle : ''}</p>
          </Tarjeta>
        ))}
      </div>

      {/* Por vendedor */}
      <Tarjeta className="overflow-x-auto p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-semibold">Por vendedor</h2>
          <Boton variante="fantasma" disabled={!vendedores?.length} onClick={() => descargarCsv(`vendedores_${sufijo}`, [
            { titulo: 'Vendedor', valor: (f: FilaVendedor) => f.vendedor }, { titulo: 'Días con jornada', valor: (f: FilaVendedor) => f.dias_con_jornada },
            { titulo: 'Horas', valor: (f: FilaVendedor) => f.horas_jornada }, { titulo: 'Km', valor: (f: FilaVendedor) => f.km },
            { titulo: 'Visitas', valor: (f: FilaVendedor) => f.visitas }, { titulo: 'Planificadas', valor: (f: FilaVendedor) => f.planificadas },
            { titulo: 'Paradas visitadas', valor: (f: FilaVendedor) => f.paradas_visitadas }, { titulo: 'Fuera de ruta', valor: (f: FilaVendedor) => f.fuera_de_ruta },
            { titulo: 'Clientes distintos', valor: (f: FilaVendedor) => f.clientes_distintos }, { titulo: 'Con pedido', valor: (f: FilaVendedor) => f.con_pedido },
            { titulo: 'Cobranzas', valor: (f: FilaVendedor) => f.cobranzas }, { titulo: 'Cobrado Gs', valor: (f: FilaVendedor) => Math.round(f.cobrado_gs) },
            { titulo: 'Clientes nuevos', valor: (f: FilaVendedor) => f.prospectos_nuevos }, { titulo: 'Sin movimiento visitados', valor: (f: FilaVendedor) => f.inactivos_visitados },
            { titulo: 'Primera visita (prom.)', valor: (f: FilaVendedor) => hhmm(f.primera_visita_prom) }, { titulo: 'Última visita (prom.)', valor: (f: FilaVendedor) => hhmm(f.ultima_visita_prom) },
          ], vendedores ?? [])}><Download className="size-4" aria-hidden /> Excel</Boton>
        </div>
        {vendedores && vendedores.length === 0 ? <div className="p-4"><Vacio titulo="Sin vendedores con actividad en el período" /></div> : (
          <table className="mt-2 w-full min-w-[1100px] text-sm tabular">
            <thead>
              <tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
                <th className="px-4 py-2 font-medium">Vendedor</th>
                <th className="px-2 py-2 text-right font-medium">Visitas</th><th className="px-2 py-2 text-right font-medium">Promedio por día</th>
                <th className="px-2 py-2 text-right font-medium">Cumplimiento ruta</th><th className="px-2 py-2 text-right font-medium">Con pedido</th>
                <th className="px-2 py-2 text-right font-medium">Cobrado</th><th className="px-2 py-2 text-right font-medium">Km</th>
                <th className="px-2 py-2 text-right font-medium">Horas</th><th className="px-2 py-2 text-right font-medium">Nuevos</th>
                <th className="px-2 py-2 text-right font-medium">Rojos visitados</th><th className="px-4 py-2 text-right font-medium">Horario prom.</th>
              </tr>
            </thead>
            <tbody>
              {(vendedores ?? []).map((f) => {
                const porDia = f.dias_con_visitas ? f.visitas / f.dias_con_visitas : 0
                return (
                  <tr key={f.vendedor_id} className="border-b border-borde last:border-0">
                    <td className="px-4 py-2 font-medium">{f.vendedor}</td>
                    <td className="px-2 py-2 text-right">{f.visitas}</td>
                    <td className={cn('px-2 py-2 text-right', porDia >= f.meta_diaria ? 'text-green-700 dark:text-green-400' : porDia > 0 ? 'text-amber-700 dark:text-amber-300' : '')}>
                      {fmtNum(porDia, 1)} <span className="text-tenue">/ {f.meta_diaria}</span>
                    </td>
                    <td className="px-2 py-2 text-right">{fmtPct(pct(f.paradas_visitadas, f.planificadas))} <span className="text-xs text-tenue">({f.paradas_visitadas}/{f.planificadas})</span></td>
                    <td className="px-2 py-2 text-right">{f.con_pedido} <span className="text-xs text-tenue">({fmtPct(pct(f.con_pedido, f.visitas))})</span></td>
                    <td className="px-2 py-2 text-right">{fmtGuaranies(f.cobrado_gs)}</td>
                    <td className="px-2 py-2 text-right">{fmtNum(f.km, 1)}</td>
                    <td className="px-2 py-2 text-right">{fmtNum(f.horas_jornada, 1)}</td>
                    <td className="px-2 py-2 text-right">{f.prospectos_nuevos}</td>
                    <td className="px-2 py-2 text-right">{f.inactivos_visitados}</td>
                    <td className="px-4 py-2 text-right">{hhmm(f.primera_visita_prom)}–{hhmm(f.ultima_visita_prom)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Tarjeta>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        {/* Resultados */}
        <Tarjeta>
          <h2 className="font-semibold">Qué pasó en las visitas</h2>
          <p className="mb-3 text-xs text-tenue">Para ver por qué no se vende: stock, precio, comprador ausente…</p>
          {resultados.length === 0 ? <p className="text-sm text-tenue">Sin visitas en el período.</p> : (
            <ul className="flex flex-col gap-2">
              {resultados.map((r) => (
                <li key={r.resultado} title={`${r.resultado}: ${r.visitas} visitas (${fmtPct(pct(r.visitas, t.visitas))})`}>
                  <div className="flex justify-between text-sm"><span>{r.resultado}</span><span className="tabular text-tenue">{r.visitas} · {fmtPct(pct(r.visitas, t.visitas))}</span></div>
                  <div className="mt-1 h-2.5 rounded bg-fondo">
                    <div className={cn('h-full rounded', r.es_venta ? 'bg-green-600' : 'bg-marca/70')} style={{ width: `${(Number(r.visitas) / maxResultado) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        {/* Cobertura por zona */}
        <Tarjeta className="overflow-x-auto p-0">
          <div className="flex items-center justify-between px-4 pt-4">
            <div>
              <h2 className="font-semibold">Cobertura por zona</h2>
              <p className="text-xs text-tenue">Qué parte de los clientes de cada zona se visitó en el período</p>
            </div>
            <Boton variante="fantasma" disabled={!zonas.length} onClick={() => descargarCsv(`zonas_${sufijo}`, [
              { titulo: 'Zona', valor: (z: FilaZona) => z.zona }, { titulo: 'Vendedor', valor: (z: FilaZona) => z.responsable },
              { titulo: 'Clientes', valor: (z: FilaZona) => z.clientes }, { titulo: 'Activos', valor: (z: FilaZona) => z.activos },
              { titulo: 'Sin movimiento', valor: (z: FilaZona) => z.inactivos }, { titulo: 'Visitados', valor: (z: FilaZona) => z.visitados },
              { titulo: 'Visitas', valor: (z: FilaZona) => z.visitas }, { titulo: 'Con pedido', valor: (z: FilaZona) => z.con_pedido },
              { titulo: 'Sin visita hace 60 días', valor: (z: FilaZona) => z.sin_visita_60d },
            ], zonas)}><Download className="size-4" aria-hidden /> Excel</Boton>
          </div>
          <table className="mt-2 w-full min-w-[620px] text-sm tabular">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="px-4 py-2 font-medium">Zona</th><th className="px-2 py-2 font-medium">Cobertura</th>
              <th className="px-2 py-2 text-right font-medium">Visitas</th><th className="px-2 py-2 text-right font-medium">Pedidos</th>
              <th className="px-4 py-2 text-right font-medium">Sin visita +60 días</th>
            </tr></thead>
            <tbody>
              {zonas.map((z) => {
                const c = pct(z.visitados, z.clientes)
                return (
                  <tr key={z.zona_id} className="border-b border-borde last:border-0">
                    <td className="px-4 py-2"><div className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: z.color }} aria-hidden /><span className="font-medium">{z.zona}</span></div><span className="text-xs text-tenue">{z.responsable ?? 'sin vendedor'}</span></td>
                    <td className="px-2 py-2" title={`${z.visitados} de ${z.clientes} clientes visitados`}>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 rounded bg-fondo"><div className="h-full rounded bg-marca" style={{ width: `${c ?? 0}%` }} /></div>
                        <span className="text-xs">{fmtPct(c)} <span className="text-tenue">({z.visitados}/{z.clientes})</span></span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">{z.visitas}</td>
                    <td className="px-2 py-2 text-right">{z.con_pedido}</td>
                    <td className="px-4 py-2 text-right">{z.sin_visita_60d}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Tarjeta>
      </div>

      {/* Descuidados */}
      <Tarjeta className="overflow-x-auto p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <div>
            <h2 className="font-semibold">Clientes sin visitar</h2>
            <p className="text-xs text-tenue">Primero los que más compran. Sirve para armar las rutas de la semana que viene.</p>
          </div>
          <div className="flex items-center gap-2">
            <Selector aria-label="Días sin visita" className="w-auto" value={diasSinVisita} onChange={(e) => setDiasSinVisita(Number(e.target.value))}>
              {[30, 60, 90, 180].map((d) => <option key={d} value={d}>Más de {d} días</option>)}
            </Selector>
            <Boton variante="fantasma" disabled={!descuidados.length} onClick={() => descargarCsv(`sin_visita_${diasSinVisita}d`, [
              { titulo: 'Cliente', valor: (c: FilaDescuidado) => c.razon_social }, { titulo: 'Ciudad', valor: (c: FilaDescuidado) => c.ciudad },
              { titulo: 'Zona', valor: (c: FilaDescuidado) => c.zona }, { titulo: 'Vendedor', valor: (c: FilaDescuidado) => c.vendedor },
              { titulo: 'Estado', valor: (c: FilaDescuidado) => c.estado }, { titulo: 'Última visita', valor: (c: FilaDescuidado) => (c.ultima_visita ? fmtFecha(c.ultima_visita) : 'nunca') },
              { titulo: 'Última factura', valor: (c: FilaDescuidado) => fmtFecha(c.ultima_factura_fecha) }, { titulo: 'Ventas 6 meses Gs', valor: (c: FilaDescuidado) => Math.round(c.ventas_6m_gs) },
            ], descuidados)}><Download className="size-4" aria-hidden /> Excel</Boton>
          </div>
        </div>
        {descuidados.length === 0 ? <div className="p-4"><Vacio titulo="Ningún cliente en esa situación" /></div> : (
          <table className="mt-2 w-full min-w-[820px] text-sm">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="px-4 py-2 font-medium">Cliente</th><th className="px-2 py-2 font-medium">Zona</th><th className="px-2 py-2 font-medium">Vendedor</th>
              <th className="px-2 py-2 font-medium">Última visita</th><th className="px-2 py-2 font-medium">Última factura</th><th className="px-4 py-2 text-right font-medium">Ventas 6 meses</th>
            </tr></thead>
            <tbody>
              {descuidados.slice(0, 200).map((c) => (
                <tr key={c.id} className="border-b border-borde last:border-0">
                  <td className="px-4 py-2"><div className="flex items-center gap-2"><PuntoEstado estado={c.estado} /><span className="font-medium">{c.razon_social}</span></div><span className="text-xs text-tenue">{c.ciudad ?? ''}</span></td>
                  <td className="px-2 py-2">{c.zona ?? '—'}</td>
                  <td className="px-2 py-2">{c.vendedor ?? '—'}</td>
                  <td className="px-2 py-2">{hace(c.ultima_visita)}</td>
                  <td className="px-2 py-2">{fmtFecha(c.ultima_factura_fecha)}</td>
                  <td className="px-4 py-2 text-right tabular">{fmtGuaranies(c.ventas_6m_gs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {descuidados.length > 200 && <p className="px-4 pb-3 text-xs text-tenue">Mostrando 200 de {descuidados.length}. El Excel trae todos.</p>}
      </Tarjeta>
    </div>
  )
}
