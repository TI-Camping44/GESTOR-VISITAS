// Geometría simple del lado cliente: distancias, orden de paradas y links de navegación.
export type Punto = { lat: number; lng: number }

const R = 6371008.8 // radio medio de la Tierra en metros

export function distanciaM(a: Punto, b: Punto): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export const fmtDistancia = (m: number | null | undefined) =>
  m == null ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`

const largo = (ruta: Punto[], origen: Punto | null) =>
  ruta.reduce((s, p, i) => s + distanciaM(i === 0 ? (origen ?? p) : ruta[i - 1]!, p), 0)

/**
 * Ordena paradas: vecino más cercano desde el origen y después mejora 2-opt.
 * Es una heurística (no garantiza el óptimo) pero para 10–20 paradas anda muy bien.
 */
export function ordenarParadas<T extends Punto>(paradas: T[], origen: Punto | null): T[] {
  if (paradas.length < 3) return [...paradas]
  const resto = [...paradas]
  const ruta: T[] = []
  let actual: Punto = origen ?? resto[0]!
  while (resto.length) {
    let mejor = 0
    for (let i = 1; i < resto.length; i++) if (distanciaM(actual, resto[i]!) < distanciaM(actual, resto[mejor]!)) mejor = i
    actual = resto.splice(mejor, 1)[0]!
    ruta.push(actual as T)
  }
  // 2-opt: invertir tramos mientras acorte el recorrido.
  let mejoro = true
  for (let vuelta = 0; mejoro && vuelta < 50; vuelta++) {
    mejoro = false
    for (let i = 0; i < ruta.length - 1; i++) {
      for (let k = i + 1; k < ruta.length; k++) {
        const candidata = [...ruta.slice(0, i), ...ruta.slice(i, k + 1).reverse(), ...ruta.slice(k + 1)]
        if (largo(candidata, origen) + 0.5 < largo(ruta, origen)) {
          ruta.splice(0, ruta.length, ...candidata)
          mejoro = true
        }
      }
    }
  }
  return ruta
}

/**
 * Links de Google Maps para navegar la ruta, en tramos de hasta 9 paradas intermedias
 * (límite de waypoints de la URL). Cada tramo arranca donde terminó el anterior.
 */
export function linksGoogleMaps(origen: Punto | null, paradas: Punto[]): string[] {
  const p = (x: Punto) => `${x.lat.toFixed(6)},${x.lng.toFixed(6)}`
  const links: string[] = []
  let desde: Punto | null = origen
  let i = 0
  while (i < paradas.length) {
    // Sin origen, el primer tramo arranca en la primera parada.
    if (!desde) { desde = paradas[0]!; i = 1; if (i >= paradas.length) break }
    const tramo = paradas.slice(i, i + 10) // 9 intermedias + destino
    const destino = tramo[tramo.length - 1]!
    const intermedias = tramo.slice(0, -1)
    const url = new URL('https://www.google.com/maps/dir/')
    url.searchParams.set('api', '1')
    url.searchParams.set('origin', p(desde))
    url.searchParams.set('destination', p(destino))
    if (intermedias.length) url.searchParams.set('waypoints', intermedias.map(p).join('|'))
    url.searchParams.set('travelmode', 'driving')
    links.push(url.toString())
    desde = destino
    i += tramo.length
  }
  return links
}
