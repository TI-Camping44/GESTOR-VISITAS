'use client'
// Mapa MapLibre con tiles de OpenFreeMap (sin API key).
// Puntos con color propio, agrupados (clustering) si se pide, etiqueta opcional
// (número de parada o iniciales) y popup con link. Opcional: líneas y "mi posición".
import { useEffect, useRef } from 'react'
import { LngLatBounds, Map as MapaML, Marker, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CENTRO_PY, MAPA_ESTILO } from '@/lib/config'

setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')

export type PuntoMapa = {
  id: string
  lat: number
  lng: number
  color: string
  titulo: string
  detalle?: string
  href?: string
  textoLink?: string
  etiqueta?: string
  /** Para heatmap: peso del punto. */
  peso?: number
}

export type LineaMapa = { id: string; color: string; puntos: [number, number][] } // [lng, lat]

type Props = {
  puntos: PuntoMapa[]
  agrupar?: boolean
  lineas?: LineaMapa[]
  yo?: { lat: number; lng: number } | null
  /** Encuadra los puntos al cargar y cuando cambia esta clave. */
  claveEncuadre?: string
  className?: string
  alClicPunto?: (id: string) => void
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function aGeoJson(puntos: PuntoMapa[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: puntos.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { id: p.id, color: p.color, titulo: p.titulo, detalle: p.detalle ?? '', href: p.href ?? '', textoLink: p.textoLink ?? 'Abrir', etiqueta: p.etiqueta ?? '' },
    })),
  }
}

function aLineas(lineas: LineaMapa[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: lineas.filter((l) => l.puntos.length > 1).map((l) => ({
      type: 'Feature', geometry: { type: 'LineString', coordinates: l.puntos }, properties: { id: l.id, color: l.color },
    })),
  }
}

export function Mapa({ puntos, agrupar = false, lineas = [], yo, claveEncuadre, className, alClicPunto }: Props) {
  const div = useRef<HTMLDivElement>(null)
  const mapa = useRef<MapaML | null>(null)
  const listo = useRef(false)
  const marcaYo = useRef<Marker | null>(null)
  const alClic = useRef(alClicPunto)
  alClic.current = alClicPunto
  const ultimoEncuadre = useRef<string | undefined>(undefined)
  const pendiente = useRef<(() => void) | null>(null)

  // Crear el mapa una sola vez.
  useEffect(() => {
    if (!div.current) return
    const m = new MapaML({
      container: div.current,
      style: MAPA_ESTILO,
      center: [CENTRO_PY.lng, CENTRO_PY.lat],
      zoom: CENTRO_PY.zoom,
      attributionControl: { compact: true },
    })
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    m.on('load', () => {
      m.addSource('lineas', { type: 'geojson', data: aLineas([]) })
      m.addLayer({ id: 'lineas', type: 'line', source: 'lineas', paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.8 } })

      m.addSource('puntos', { type: 'geojson', data: aGeoJson([]), cluster: agrupar, clusterRadius: 45, clusterMaxZoom: 14 })
      if (agrupar) {
        m.addLayer({
          id: 'grupos', type: 'circle', source: 'puntos', filter: ['has', 'point_count'],
          paint: { 'circle-color': '#1f6f4a', 'circle-opacity': 0.85, 'circle-radius': ['step', ['get', 'point_count'], 16, 20, 22, 100, 28], 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
        })
        m.addLayer({
          id: 'grupos-n', type: 'symbol', source: 'puntos', filter: ['has', 'point_count'],
          layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-font': ['Noto Sans Bold'] },
          paint: { 'text-color': '#fff' },
        })
        m.on('click', 'grupos', async (e: MapLayerMouseEvent) => {
          const f = e.features?.[0]
          if (!f) return
          const src = m.getSource('puntos') as GeoJSONSource
          const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number)
          m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom })
        })
      }
      m.addLayer({
        id: 'punto', type: 'circle', source: 'puntos', filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['case', ['==', ['get', 'etiqueta'], ''], 7, 12],
          'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
        },
      })
      m.addLayer({
        id: 'punto-etq', type: 'symbol', source: 'puntos', filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'etiqueta'], '']],
        layout: { 'text-field': ['get', 'etiqueta'], 'text-size': 11, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
        paint: { 'text-color': '#fff' },
      })
      m.on('click', 'punto', (e: MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (!f) return
        const p = f.properties as Record<string, string>
        alClic.current?.(p.id!)
        const html = `<strong>${esc(p.titulo ?? '')}</strong>${p.detalle ? `<div style="margin-top:2px;font-size:12px;opacity:.8">${esc(p.detalle)}</div>` : ''}${
          p.href ? `<a href="${esc(p.href)}" style="display:inline-block;margin-top:6px;font-weight:600;color:#1f6f4a">${esc(p.textoLink ?? 'Abrir')} →</a>` : ''}`
        new Popup({ offset: 10, maxWidth: '260px' }).setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setHTML(html).addTo(m)
      })
      for (const capa of ['punto', 'grupos']) {
        m.on('mouseenter', capa, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', capa, () => { m.getCanvas().style.cursor = '' })
      }
      listo.current = true
      pendiente.current?.()
      pendiente.current = null
    })
    mapa.current = m
    return () => { listo.current = false; m.remove(); mapa.current = null }
    // agrupar se fija al crear el mapa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Actualizar datos.
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    const aplicar = () => {
      ;(m.getSource('puntos') as GeoJSONSource | undefined)?.setData(aGeoJson(puntos))
      ;(m.getSource('lineas') as GeoJSONSource | undefined)?.setData(aLineas(lineas))
      const clave = claveEncuadre ?? 'inicial'
      if (ultimoEncuadre.current !== clave) {
        const coords: [number, number][] = [...puntos.map((p) => [p.lng, p.lat] as [number, number]), ...lineas.flatMap((l) => l.puntos)]
        if (yo && !coords.length) coords.push([yo.lng, yo.lat])
        if (coords.length === 1) m.jumpTo({ center: coords[0]!, zoom: 14 })
        else if (coords.length > 1) {
          const b = coords.reduce((acc, c) => acc.extend(c), new LngLatBounds(coords[0]!, coords[0]!))
          m.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 })
        }
        if (coords.length) ultimoEncuadre.current = clave
      }
    }
    if (listo.current) aplicar()
    else pendiente.current = aplicar
  }, [puntos, lineas, claveEncuadre, yo])

  // Mi posición.
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    if (!yo) { marcaYo.current?.remove(); marcaYo.current = null; return }
    if (!marcaYo.current) {
      const el = document.createElement('div')
      el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)'
      el.title = 'Tu ubicación'
      marcaYo.current = new Marker({ element: el }).setLngLat([yo.lng, yo.lat]).addTo(m)
    } else marcaYo.current.setLngLat([yo.lng, yo.lat])
  }, [yo])

  return <div ref={div} className={className ?? 'h-72 w-full overflow-hidden rounded-xl border border-borde'} role="region" aria-label="Mapa" />
}
