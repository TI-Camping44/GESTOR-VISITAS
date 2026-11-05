'use client'
// Recorrido de un día (En vivo): el trayecto con GPS, los tramos sin GPS punteados (cuándo se cortó y con
// cuánta batería), las paradas de 10 minutos o más con dónde fueron (visita, cliente sin visita, base o
// fuera de ruta) y los excesos de velocidad. Con el GPS en segundo plano (Traccar) el trayecto sale completo.
import { useEffect, useMemo, useState } from 'react'
import { Mapa, type LineaMapa, type PuntoMapa } from '@/components/map/MapaDinamico'
import { Boton, Entrada, Selector, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { descargarCsv } from '@/lib/csv'
import { fmtFecha, fmtSoloHora, hace, hoyIso } from '@/lib/fechas'
import { distanciaM, fmtDistancia } from '@/lib/geo'
import { analizarJornada, limpiarPosiciones, motivoCorte, type Corte, type Exceso, type Parada, type Pos } from '@/lib/paradas'
import { ajustarTramo, caminoProbable } from '@/lib/calles'
import { cn } from '@/lib/utils'
import type { ParadaDia, Vendedor } from '@/lib/database.types'

const CERCA_M = 300
type Visita = { id: string; fecha_hora: string; lat: number | null; lng: number | null; hizo_pedido: boolean; cliente: { razon_social: string } | null }
type Donde = { tipo: 'visita' | 'sin_visita' | 'base' | 'fuera'; texto: string }
type Evento = { inicio: string; fin: string | null; tipo: string; detalle: string; minutos: number | null; lat: number | null; lng: number | null; alerta: boolean }
type Datos = {
  pos: Pos[]; visitas: Visita[]; jornadas: { inicio: string; fin: string | null; km_actual: number | null }[]
  paradas: (Parada & { donde: Donde })[]; cortes: Corte[]; excesos: Exceso[]; tramos: [number, number][][]
  cubiertoPct: number | null; maxKmh: number | null; gps: { ultima_recibida_el: string | null } | null
}
const COLOR_DONDE: Record<Donde['tipo'], string> = { visita: '#16a34a', sin_visita: '#d97706', base: '#6b7280', fuera: '#dc2626' }
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`)
const linkMapa = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

export function RecorridoDia({ vendedores }: { vendedores: Vendedor[] }) {
  const sb = supabaseNavegador()
  const [vendedorId, setVendedorId] = useState('')
  const [dia, setDia] = useState(hoyIso())
  const [datos, setDatos] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(false)
  const [calles, setCalles] = useState(false)
  const [ajuste, setAjuste] = useState<{ lineas: LineaMapa[]; incompleto: boolean } | null>(null)
  const [ajustando, setAjustando] = useState(false)

  useEffect(() => {
    if (!vendedorId) { setDatos(null); return }
    let vivo = true
    setCargando(true)
    const desde = `${dia}T00:00:00-03:00`
    const hasta = new Date(new Date(desde).getTime() + 86400000).toISOString()
    ;(async () => {
      const [p, v, j, r, c, g] = await Promise.all([
        sb.from('vis_posiciones').select('fecha_hora, lat, lng, precision_m, bateria_pct, velocidad_kmh, origen, jornada_id').eq('vendedor_id', vendedorId).gte('fecha_hora', desde).lt('fecha_hora', hasta).order('fecha_hora').limit(5000),
        sb.from('vis_visitas').select('id, fecha_hora, lat, lng, hizo_pedido, cliente:vis_clientes!vis_visitas_cliente_id_fkey(razon_social)').eq('vendedor_id', vendedorId).gte('fecha_hora', desde).lt('fecha_hora', hasta).order('fecha_hora'),
        sb.from('vis_jornadas').select('id, inicio, fin, km_actual:vis_km_actual').eq('vendedor_id', vendedorId).gte('inicio', desde).lt('inicio', hasta).order('inicio'),
        sb.rpc('vis_paradas_dia', { p_dia: dia, p_vendedor: vendedorId }),
        sb.from('vis_config').select('base_lat, base_lng').maybeSingle(),
        sb.from('vis_gps_dispositivos').select('ultima_recibida_el').eq('vendedor_id', vendedorId).maybeSingle(),
      ])
      if (!vivo) return
      // Sin las lecturas imprecisas ni los saltos de GPS (hacían ir y volver la línea).
      const pos = limpiarPosiciones((p.data ?? []) as (Pos & { jornada_id: string })[])
      const visitas = (v.data ?? []) as unknown as Visita[]
      const jornadas = (j.data ?? []) as unknown as { id: string; inicio: string; fin: string | null; km_actual: number | null }[]
      const ruta = (r.data ?? []) as ParadaDia[]
      const vend = vendedores.find((x) => x.id === vendedorId)
      const base = vend?.base_lat != null ? { lat: vend.base_lat, lng: vend.base_lng! } : c.data?.base_lat != null ? { lat: c.data.base_lat, lng: c.data.base_lng! } : null

      // Cada jornada por separado (el tiempo entre jornadas no cuenta como «sin GPS»).
      const res = jornadas.map((jo) => ({ jo, a: analizarJornada(pos.filter((x) => x.jornada_id === jo.id), jo.inicio, jo.fin) }))
      const total = res.reduce((s, { jo }) => s + Math.max(0, (Date.parse(jo.fin ?? new Date().toISOString()) - Date.parse(jo.inicio)) / 60000), 0)
      const cubierto = res.reduce((s, { jo, a }) => s + ((a.cubiertoPct ?? 0) / 100) * Math.max(0, (Date.parse(jo.fin ?? new Date().toISOString()) - Date.parse(jo.inicio)) / 60000), 0)
      const paradas = res.flatMap(({ a }) => a.paradas)

      // Dónde fue cada parada.
      const donde = await Promise.all(paradas.map(async (pa): Promise<Donde> => {
        const vis = visitas.find((x) => x.lat != null && distanciaM(pa, { lat: x.lat, lng: x.lng! }) <= CERCA_M
          && Date.parse(x.fecha_hora) >= Date.parse(pa.inicio) - 15 * 60000 && Date.parse(x.fecha_hora) <= Date.parse(pa.fin) + 15 * 60000)
        if (vis) return { tipo: 'visita', texto: `Visita a ${vis.cliente?.razon_social ?? 'un cliente'}` }
        const enRuta = ruta.find((x) => x.lat != null && distanciaM(pa, { lat: x.lat, lng: x.lng! }) <= CERCA_M)
        if (enRuta) return { tipo: 'sin_visita', texto: `En ${enRuta.razon_social} (de la ruta), sin visita registrada` }
        const { data: cerca } = await sb.rpc('vis_clientes_cercanos', { p_lat: pa.lat, p_lng: pa.lng, p_radio_m: CERCA_M })
        const cli = (cerca ?? [])[0] as { razon_social: string } | undefined
        if (cli) return { tipo: 'sin_visita', texto: `En ${cli.razon_social}, sin visita registrada` }
        if (base && distanciaM(pa, base) <= CERCA_M) return { tipo: 'base', texto: 'En la base / depósito' }
        return { tipo: 'fuera', texto: 'Fuera de ruta: no es cliente ni base' }
      }))
      if (!vivo) return
      setDatos({
        pos, visitas, jornadas,
        paradas: paradas.map((pa, i) => ({ ...pa, donde: donde[i]! })),
        cortes: res.flatMap(({ a }) => a.cortes), excesos: res.flatMap(({ a }) => a.excesos), tramos: res.flatMap(({ a }) => a.tramos),
        cubiertoPct: total > 0 ? Math.round((100 * cubierto) / total) : null,
        maxKmh: res.reduce<number | null>((m, { a }) => (a.maxKmh == null ? m : Math.max(m ?? 0, a.maxKmh)), null),
        gps: g.data ?? null,
      })
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [vendedorId, dia, sb, vendedores])

  const conSegundoPlano = !!datos?.pos.some((x) => x.origen === 'traccar')

  // Ajustar a calles (OSRM): tramos con GPS encajados en las calles y, sin GPS, el camino más corto.
  useEffect(() => {
    if (!calles || !datos) { setAjuste(null); return }
    let vivo = true
    setAjustando(true)
    ;(async () => {
      const lineas: LineaMapa[] = []
      let incompleto = false, consultas = 0
      for (const [i, t] of datos.tramos.entries()) {
        if (++consultas > 30) { incompleto = true; lineas.push({ id: `t${i}`, color: '#2563eb', puntos: t }); continue }
        const r = await ajustarTramo(t)
        if (!vivo) return
        if (!r.ajustado) incompleto = true
        lineas.push({ id: `t${i}`, color: '#2563eb', puntos: r.puntos })
      }
      for (const [i, c] of datos.cortes.entries()) {
        if (!c.desde || !c.hasta) continue
        if (++consultas > 30) { incompleto = true; lineas.push({ id: `c${i}`, color: '#6b7280', puntos: [c.desde, c.hasta], punteada: true }); continue }
        const r = await caminoProbable(c.desde, c.hasta)
        if (!vivo) return
        if (!r.ajustado) incompleto = true
        lineas.push({ id: `c${i}`, color: '#6b7280', puntos: r.puntos, punteada: true })
      }
      if (vivo) { setAjuste({ lineas, incompleto }); setAjustando(false) }
    })()
    return () => { vivo = false }
  }, [calles, datos])

  const lineas = useMemo<LineaMapa[]>(() => calles && ajuste ? ajuste.lineas : !datos ? [] : [
    ...datos.tramos.map((t, i) => ({ id: `t${i}`, color: '#2563eb', puntos: t })),
    ...datos.cortes.filter((c) => c.desde && c.hasta).map((c, i) => ({ id: `c${i}`, color: '#6b7280', puntos: [c.desde!, c.hasta!], punteada: true })),
  ], [datos, calles, ajuste])
  const puntos = useMemo<PuntoMapa[]>(() => !datos ? [] : [
    ...datos.visitas.filter((x) => x.lat != null).map((x, i) => ({
      id: x.id, lat: x.lat!, lng: x.lng!, etiqueta: String(i + 1), color: x.hizo_pedido ? '#16a34a' : '#1f6f4a',
      titulo: x.cliente?.razon_social ?? 'Visita', detalle: fmtSoloHora(x.fecha_hora),
    })),
    ...datos.paradas.filter((pa) => pa.donde.tipo === 'fuera' || pa.donde.tipo === 'sin_visita').map((pa, i) => ({
      id: `p${i}`, lat: pa.lat, lng: pa.lng, etiqueta: pa.donde.tipo === 'fuera' ? '!' : 'P', color: COLOR_DONDE[pa.donde.tipo],
      titulo: pa.donde.texto, detalle: `${fmtSoloHora(pa.inicio)} a ${fmtSoloHora(pa.fin)} · ${dur(pa.minutos)}`,
    })),
    ...datos.excesos.map((e, i) => ({ id: `e${i}`, lat: e.lat, lng: e.lng, etiqueta: 'V', color: '#7c3aed', titulo: `${e.maxKmh} km/h`, detalle: fmtSoloHora(e.inicio) })),
  ], [datos])

  // Todo lo del día en orden: jornada, visitas, paradas, cortes y velocidad.
  const eventos = useMemo<Evento[]>(() => {
    if (!datos) return []
    const ev: Evento[] = []
    for (const jo of datos.jornadas) {
      ev.push({ inicio: jo.inicio, fin: null, tipo: 'Inicio de jornada', detalle: '', minutos: null, lat: null, lng: null, alerta: false })
      if (jo.fin) ev.push({ inicio: jo.fin, fin: null, tipo: 'Fin de jornada', detalle: '', minutos: null, lat: null, lng: null, alerta: false })
    }
    for (const x of datos.visitas) ev.push({ inicio: x.fecha_hora, fin: null, tipo: 'Visita', detalle: x.cliente?.razon_social ?? '', minutos: null, lat: x.lat, lng: x.lng, alerta: false })
    for (const pa of datos.paradas) {
      if (pa.donde.tipo === 'visita') continue
      ev.push({ inicio: pa.inicio, fin: pa.fin, tipo: 'Parada', detalle: pa.donde.texto, minutos: pa.minutos, lat: pa.lat, lng: pa.lng, alerta: pa.donde.tipo === 'fuera' })
    }
    for (const c of datos.cortes) {
      const bat = [c.bateriaAntes != null && `batería ${c.bateriaAntes} % al cortarse`, c.bateriaDespues != null && `${c.bateriaDespues} % al volver`, c.km != null && `${fmtDistancia(c.km * 1000)} en línea recta`].filter(Boolean).join(' · ')
      ev.push({ inicio: c.inicio, fin: c.fin, tipo: 'Sin GPS', detalle: `${motivoCorte(c, conSegundoPlano)}${bat ? ` · ${bat}` : ''}`, minutos: c.minutos, lat: null, lng: null, alerta: c.minutos >= 30 })
    }
    for (const e of datos.excesos) ev.push({ inicio: e.inicio, fin: e.fin, tipo: 'Exceso de velocidad', detalle: `${e.maxKmh} km/h`, minutos: null, lat: e.lat, lng: e.lng, alerta: true })
    return ev.sort((a, b) => a.inicio.localeCompare(b.inicio))
  }, [datos, conSegundoPlano])

  const nombre = vendedores.find((v) => v.id === vendedorId)?.nombre ?? ''
  const fuera = datos?.paradas.filter((pa) => pa.donde.tipo === 'fuera') ?? []
  const sinGps = datos?.cortes.reduce((s, c) => s + c.minutos, 0) ?? 0
  const inicio = datos?.jornadas[0]?.inicio
  const fin = datos?.jornadas.at(-1)?.fin
  const km = datos?.jornadas.reduce((s, x) => s + Number(x.km_actual ?? 0), 0) ?? 0

  function excel() {
    descargarCsv(`Recorrido ${nombre} ${fmtFecha(dia).replace(/\//g, '-')}`, [
      { titulo: 'Desde', valor: (e: Evento) => fmtSoloHora(e.inicio) },
      { titulo: 'Hasta', valor: (e: Evento) => (e.fin ? fmtSoloHora(e.fin) : '') },
      { titulo: 'Qué', valor: (e: Evento) => e.tipo },
      { titulo: 'Detalle', valor: (e: Evento) => e.detalle },
      { titulo: 'Duración (min)', valor: (e: Evento) => e.minutos ?? '' },
      { titulo: 'Mapa', valor: (e: Evento) => (e.lat != null ? linkMapa(e.lat, e.lng!) : '') },
    ], eventos)
  }

  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto font-semibold">Recorrido del día</h2>
        <div>
          <label htmlFor="rec-v" className="mb-1 block text-xs text-tenue">Vendedor</label>
          <Selector id="rec-v" value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
            <option value="">Elegí…</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
        </div>
        <div>
          <label htmlFor="rec-d" className="mb-1 block text-xs text-tenue">Día</label>
          <Entrada id="rec-d" type="date" value={dia} max={hoyIso()} onChange={(e) => setDia(e.target.value)} />
        </div>
        {datos && (
          <label className="flex min-h-10 items-center gap-2 text-sm" title="Redibuja el trayecto pegado a las calles (OpenStreetMap). En los tramos sin GPS muestra el camino más corto, que es una estimación.">
            <input type="checkbox" className="size-4 accent-[var(--c-marca)]" checked={calles} onChange={(e) => setCalles(e.target.checked)} />
            Ajustar a calles (aproximado)
          </label>
        )}
        {datos && <Boton variante="secundario" onClick={excel} disabled={!eventos.length}>Excel</Boton>}
      </div>
      {cargando && !datos && <div className="h-96 animate-pulse rounded-xl bg-borde/40" />}
      {datos && (
        <>
          <p className="text-sm text-tenue tabular">
            Inicio {inicio ? fmtSoloHora(inicio) : '—'} · fin {fin ? fmtSoloHora(fin) : inicio ? 'en curso' : '—'} ·
            {' '}{inicio ? `${fmtDistancia(km * 1000)} recorridos${fin ? '' : ' hasta ahora'}` : 'sin jornada'} · {datos.visitas.length} visitas
            {datos.maxKmh != null && ` · máxima ${datos.maxKmh} km/h`}
          </p>
          {inicio && (
            <div className="flex flex-wrap gap-2 text-sm">
              <span className={cn('rounded-full px-2.5 py-0.5 font-medium', (datos.cubiertoPct ?? 0) >= 80 ? 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200')}>
                GPS {datos.cubiertoPct ?? 0} % de la jornada{sinGps > 0 && ` · ${dur(sinGps)} sin GPS`}
              </span>
              <span className={cn('rounded-full px-2.5 py-0.5 font-medium', fuera.length ? 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200' : 'bg-fondo text-tenue')}>
                {fuera.length} parada{fuera.length === 1 ? '' : 's'} fuera de ruta{fuera.length > 0 && ` (${dur(fuera.reduce((s, x) => s + x.minutos, 0))})`}
              </span>
              {datos.excesos.length > 0 && <span className="rounded-full bg-violet-100 px-2.5 py-0.5 font-medium text-violet-900 dark:bg-violet-950 dark:text-violet-200">{datos.excesos.length} exceso{datos.excesos.length === 1 ? '' : 's'} de velocidad</span>}
              <span className="rounded-full bg-fondo px-2.5 py-0.5 text-tenue">
                GPS en segundo plano: {datos.gps?.ultima_recibida_el ? `último envío ${hace(datos.gps.ultima_recibida_el)}` : 'no configurado'}
              </span>
            </div>
          )}
          <Mapa puntos={puntos} lineas={lineas} claveEncuadre={`${vendedorId}-${dia}-${puntos.length}-${datos.pos.length}`} className="h-96 w-full overflow-hidden rounded-xl border border-borde" />
          {calles && (ajustando
            ? <p className="text-xs text-tenue">Ajustando a calles… (puede tardar unos segundos)</p>
            : ajuste && <p className="text-xs text-amber-700 dark:text-amber-300">Ajustado a calles con OpenStreetMap: en los tramos sin GPS (punteados) se dibuja el camino más corto, no necesariamente el que hizo.{ajuste.incompleto && ' Algunos tramos no se pudieron ajustar y quedan como líneas rectas.'}</p>)}
          <p className="text-xs text-tenue">Azul: recorrido con GPS · gris punteado: tramo sin GPS (no se sabe por dónde fue) · <b className="text-red-700 dark:text-red-400">!</b> parada fuera de ruta · <b className="text-amber-700 dark:text-amber-400">P</b> en un cliente sin visita registrada · <b className="text-violet-700 dark:text-violet-400">V</b> más de 110 km/h. Parada = 10 minutos o más en el mismo lugar.</p>
          {eventos.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-xs text-tenue"><tr className="border-b border-borde [&>th]:px-2 [&>th]:py-1.5"><th className="w-28">Hora</th><th className="w-36">Qué</th><th>Detalle</th><th className="w-20">Duración</th><th className="w-16" /></tr></thead>
                <tbody>
                  {eventos.map((e, i) => (
                    <tr key={i} className={cn('border-b border-borde last:border-0 align-top [&>td]:px-2 [&>td]:py-1.5', e.alerta && 'bg-red-50 dark:bg-red-950/30')}>
                      <td className="tabular">{fmtSoloHora(e.inicio)}{e.fin && ` a ${fmtSoloHora(e.fin)}`}</td>
                      <td className={cn('font-medium', e.alerta && 'text-red-700 dark:text-red-300')}>{e.tipo}</td>
                      <td>{e.detalle}</td>
                      <td className="tabular">{e.minutos != null ? dur(e.minutos) : ''}</td>
                      <td>{e.lat != null && <a href={linkMapa(e.lat, e.lng!)} target="_blank" rel="noreferrer" className="text-marca underline">Mapa</a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Tarjeta>
  )
}
