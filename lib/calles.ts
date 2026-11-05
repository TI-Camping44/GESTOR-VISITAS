// «Ajustar a calles» (Recorrido del día): redibuja el trayecto pegado a las calles con OSRM, el
// servicio de rutas de OpenStreetMap (servidor público de demostración: pocas consultas, de a una).
// Los tramos con GPS se «encajan» en las calles (match); los tramos sin GPS se dibujan por el
// camino más corto (route), que es una estimación. Si el servicio no responde, queda la línea original.
import { distanciaM } from '@/lib/geo'

export const OSRM = 'https://router.project-osrm.org'
type C = [number, number] // [lng, lat]

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
let ultima = 0
async function pedir(url: string): Promise<unknown | null> {
  const falta = 1100 - (Date.now() - ultima) // una consulta por segundo
  if (falta > 0) await esperar(falta)
  ultima = Date.now()
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

/** Saca los puntos repetidos (quieto en el mismo lugar), que confunden al ajuste. */
export function simplificar(puntos: C[], minM = 20): C[] {
  const out: C[] = []
  for (const p of puntos) {
    const u = out.at(-1)
    if (!u || distanciaM({ lat: u[1], lng: u[0] }, { lat: p[1], lng: p[0] }) >= minM) out.push(p)
  }
  const fin = puntos.at(-1)
  if (fin && out.at(-1) !== fin && out.length > 0) out.push(fin)
  return out
}

/** Un tramo con GPS pegado a las calles (de a 90 puntos). Si no se puede, el original. */
export async function ajustarTramo(puntos: C[]): Promise<{ puntos: C[]; ajustado: boolean }> {
  const s = simplificar(puntos)
  if (s.length < 2) return { puntos, ajustado: false }
  const out: C[] = []
  let ok = false
  for (let i = 0; i < s.length - 1; i += 89) {
    const parte = s.slice(i, i + 90)
    if (parte.length < 2) break
    const coords = parte.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';')
    const radios = parte.map(() => 30).join(';')
    const r = await pedir(`${OSRM}/match/v1/driving/${coords}?geometries=geojson&overview=full&gaps=ignore&tidy=true&radiuses=${radios}`) as
      { code?: string; matchings?: { geometry: { coordinates: C[] } }[] } | null
    if (r?.code === 'Ok' && r.matchings?.length) { out.push(...r.matchings.flatMap((m) => m.geometry.coordinates)); ok = true }
    else out.push(...parte)
  }
  return { puntos: out.length > 1 ? out : puntos, ajustado: ok }
}

/** Camino más probable entre dos puntos (para un tramo sin GPS). Si no se puede, la recta. */
export async function caminoProbable(a: C, b: C): Promise<{ puntos: C[]; ajustado: boolean }> {
  const r = await pedir(`${OSRM}/route/v1/driving/${a[0].toFixed(6)},${a[1].toFixed(6)};${b[0].toFixed(6)},${b[1].toFixed(6)}?overview=full&geometries=geojson`) as
    { code?: string; routes?: { geometry: { coordinates: C[] } }[] } | null
  const g = r?.code === 'Ok' ? r.routes?.[0]?.geometry.coordinates : null
  return g && g.length > 1 ? { puntos: g, ajustado: true } : { puntos: [a, b], ajustado: false }
}
