'use client'
// Tablero semanal (requerimiento 3): planificado vs. realizado por día y vendedor,
// cumplimiento contra la meta, agrupado por zona/ciudad y en el mapa con clustering.
import { useEffect, useMemo, useState } from 'react'
import { SelectorSemana } from '@/components/admin/SelectorSemana'
import { Mapa, type PuntoMapa } from '@/components/map/MapaDinamico'
import { Aviso, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtDia, fmtFechaHora, hoyIso, lunesDe, sumarDias } from '@/lib/fechas'
import { cn, mensajeError } from '@/lib/utils'
import type { FilaTablero } from '@/lib/database.types'

type VisitaSemana = {
  id: string; vendedor_id: string | null; fecha_hora: string; lat: number | null; lng: number | null; hizo_pedido: boolean
  ruta_parada_id: string | null; cliente: { razon_social: string; ciudad: string | null } | null; zona: { nombre: string } | null
}

// Paraguay está fijo en UTC−3 desde octubre de 2024.
const inicioDia = (iso: string) => `${iso}T00:00:00-03:00`

function colorCumplimiento(hechas: number, meta: number) {
  if (meta <= 0) return ''
  const r = hechas / meta
  return r >= 1 ? 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200' : r >= 0.7 ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : hechas > 0 ? 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200' : ''
}

export default function Tablero() {
  const [semana, setSemana] = useState(lunesDe(hoyIso()))
  const [filas, setFilas] = useState<FilaTablero[] | null>(null)
  const [visitas, setVisitas] = useState<VisitaSemana[]>([])
  const [kmHoras, setKmHoras] = useState<Map<string, { km: number; horas: number }>>(new Map())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setFilas(null)
    const sb = supabaseNavegador()
    Promise.all([
      sb.rpc('vis_tablero', { p_semana: semana }),
      sb.from('vis_visitas')
        .select('id, vendedor_id, fecha_hora, lat, lng, hizo_pedido, ruta_parada_id, cliente:vis_clientes!vis_visitas_cliente_id_fkey(razon_social, ciudad), zona:vis_zonas!vis_visitas_zona_id_fkey(nombre)')
        .eq('origen', 'app').gte('fecha_hora', inicioDia(semana)).lt('fecha_hora', inicioDia(sumarDias(semana, 7))).limit(5000),
      sb.rpc('vis_reporte_vendedores', { p_desde: semana, p_hasta: sumarDias(semana, 6) }),
    ]).then(([t, v, r]) => {
      if (!vivo) return
      if (t.error || v.error) setError(mensajeError(t.error ?? v.error))
      else { setError(null); setFilas((t.data ?? []) as FilaTablero[]); setVisitas((v.data ?? []) as unknown as VisitaSemana[]) }
      const filasR = (r.data ?? []) as unknown as { vendedor_id: string; km: number; horas_jornada: number }[]
      setKmHoras(new Map(filasR.map((f) => [f.vendedor_id, { km: Number(f.km), horas: Number(f.horas_jornada) }])))
    })
    return () => { vivo = false }
  }, [semana])

  const dias = useMemo(() => Array.from({ length: 6 }, (_, i) => sumarDias(semana, i)), [semana])
  const porVendedor = useMemo(() => {
    const m = new Map<string, { nombre: string; metaD: number; metaS: number; dias: Map<string, FilaTablero> }>()
    for (const f of filas ?? []) {
      const v = m.get(f.vendedor_id) ?? { nombre: f.vendedor, metaD: f.meta_diaria, metaS: f.meta_semanal, dias: new Map() }
      v.dias.set(f.dia, f)
      m.set(f.vendedor_id, v)
    }
    return [...m.entries()]
  }, [filas])

  const porZona = useMemo(() => {
    const m = new Map<string, { zona: string; ciudad: string; visitas: number; pedidos: number }>()
    for (const v of visitas) {
      const zona = v.zona?.nombre ?? 'Sin zona'
      const ciudad = v.cliente?.ciudad ?? 'Sin ciudad'
      const k = `${zona}|${ciudad}`
      const x = m.get(k) ?? { zona, ciudad, visitas: 0, pedidos: 0 }
      x.visitas++
      if (v.hizo_pedido) x.pedidos++
      m.set(k, x)
    }
    return [...m.values()].sort((a, b) => a.zona.localeCompare(b.zona) || b.visitas - a.visitas)
  }, [visitas])

  const puntos = useMemo<PuntoMapa[]>(() => visitas.filter((v) => v.lat != null && v.lng != null).map((v) => ({
    id: v.id, lat: v.lat!, lng: v.lng!, color: v.hizo_pedido ? '#16a34a' : '#2563eb',
    titulo: v.cliente?.razon_social ?? 'Visita', detalle: `${fmtFechaHora(v.fecha_hora)}${v.hizo_pedido ? ' · con pedido' : ''}${v.ruta_parada_id ? '' : ' · fuera de ruta'}`,
  })), [visitas])

  const hoy = hoyIso()
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Tablero semanal</h1>
        <SelectorSemana semana={semana} alCambiar={setSemana} />
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <Tarjeta className="overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm tabular">
          <thead>
            <tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="px-4 py-3 font-medium">Vendedor</th>
              {dias.map((d) => <th key={d} className={cn('px-2 py-3 text-center font-medium', d === hoy && 'text-marca')}>{fmtDia(d)}</th>)}
              <th className="px-3 py-3 text-center font-medium">Semana</th>
              <th className="px-3 py-3 text-center font-medium">Con pedido</th>
              <th className="px-3 py-3 text-center font-medium">Fuera de ruta</th>
              <th className="px-3 py-3 text-center font-medium">Km</th>
              <th className="px-3 py-3 text-center font-medium">Horas</th>
            </tr>
          </thead>
          <tbody>
            {filas === null && <tr><td colSpan={12} className="px-4 py-6 text-center text-tenue">Cargando…</td></tr>}
            {filas && porVendedor.length === 0 && <tr><td colSpan={12} className="px-4 py-6 text-center text-tenue">No hay vendedores activos. Cargalos en Vendedores.</td></tr>}
            {porVendedor.map(([id, v]) => {
              const lista = dias.map((d) => v.dias.get(d))
              const total = lista.reduce((s, f) => s + Number(f?.realizadas ?? 0), 0)
              const plan = lista.reduce((s, f) => s + Number(f?.planificadas ?? 0), 0)
              const pedidos = lista.reduce((s, f) => s + Number(f?.con_pedido ?? 0), 0)
              const fuera = lista.reduce((s, f) => s + Number(f?.fuera_de_ruta ?? 0), 0)
              const pct = v.metaS ? Math.round((total / v.metaS) * 100) : 0
              return (
                <tr key={id} className="border-b border-borde last:border-0">
                  <td className="px-4 py-3 font-medium">{v.nombre}</td>
                  {lista.map((f, i) => (
                    <td key={dias[i]} className="px-1 py-2 text-center">
                      <span className={cn('inline-block min-w-16 rounded-md px-2 py-1', colorCumplimiento(Number(f?.realizadas ?? 0), v.metaD))}
                        title={`${f?.realizadas ?? 0} realizadas de ${f?.planificadas ?? 0} planificadas · meta ${v.metaD}`}>
                        <strong>{f?.realizadas ?? 0}</strong><span className="text-tenue"> / {v.metaD}</span>
                        <span className="block text-[11px] text-tenue">plan {f?.planificadas ?? 0}</span>
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center">
                    <strong>{total}</strong><span className="text-tenue"> / {v.metaS}</span>
                    <div className="mx-auto mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-fondo" aria-label={`${pct}% de la meta`}>
                      <div className="h-full rounded-full bg-marca" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <span className="text-[11px] text-tenue">{pct}% · plan {plan}</span>
                  </td>
                  <td className="px-3 py-2 text-center">{pedidos}</td>
                  <td className="px-3 py-2 text-center">{fuera}</td>
                  <td className="px-3 py-2 text-center">{kmHoras.get(id)?.km.toLocaleString('es-PY', { maximumFractionDigits: 1 }) ?? '—'}</td>
                  <td className="px-3 py-2 text-center">{kmHoras.get(id)?.horas.toLocaleString('es-PY', { maximumFractionDigits: 1 }) ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Tarjeta>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Tarjeta className="overflow-x-auto p-0">
          <h2 className="px-4 pt-4 font-semibold">Por zona y ciudad</h2>
          {porZona.length === 0 ? <div className="p-4"><Vacio titulo="Sin visitas esta semana" /></div> : (
            <table className="mt-2 w-full text-sm tabular">
              <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue"><th className="px-4 py-2 font-medium">Zona</th><th className="px-2 py-2 font-medium">Ciudad</th><th className="px-2 py-2 text-right font-medium">Visitas</th><th className="px-4 py-2 text-right font-medium">Con pedido</th></tr></thead>
              <tbody>
                {porZona.map((z) => (
                  <tr key={`${z.zona}|${z.ciudad}`} className="border-b border-borde last:border-0">
                    <td className="px-4 py-2">{z.zona}</td><td className="px-2 py-2">{z.ciudad}</td>
                    <td className="px-2 py-2 text-right">{z.visitas}</td><td className="px-4 py-2 text-right">{z.pedidos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>
        <div>
          <h2 className="mb-2 font-semibold">Visitas de la semana <span className="text-sm font-normal text-tenue">· verde: con pedido</span></h2>
          <Mapa puntos={puntos} agrupar claveEncuadre={`${semana}-${puntos.length > 0}`} className="h-96 w-full overflow-hidden rounded-xl border border-borde" />
        </div>
      </div>
    </div>
  )
}
