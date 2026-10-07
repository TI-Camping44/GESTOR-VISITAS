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
 * Sin origen, el primer tramo sale de donde esté el celular (Google usa la ubicación actual).
 */
export function linksGoogleMaps(origen: Punto | null, paradas: Punto[]): string[] {
  const p = (x: Punto) => `${x.lat.toFixed(6)},${x.lng.toFixed(6)}`
  const links: string[] = []
  let desde: Punto | null = origen
  for (let i = 0; i < paradas.length; ) {
    const tramo = paradas.slice(i, i + 10) // 9 intermedias + destino
    const destino = tramo[tramo.length - 1]!
    const url = new URL('https://www.google.com/maps/dir/')
    url.searchParams.set('api', '1')
    if (desde) url.searchParams.set('origin', p(desde))
    url.searchParams.set('destination', p(destino))
    if (tramo.length > 1) url.searchParams.set('waypoints', tramo.slice(0, -1).map(p).join('|'))
    url.searchParams.set('travelmode', 'driving')
    links.push(url.toString())
    desde = destino
    i += tramo.length
  }
  return links
}

/** Lee coordenadas pegadas como "-25.28, -57.63" o un link de Google Maps (…@-25.28,-57.63,17z…). */
export function leerCoordenadas(texto: string): Punto | null {
  const m = texto.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}
