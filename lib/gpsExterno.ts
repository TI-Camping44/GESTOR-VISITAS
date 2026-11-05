// Posiciones que manda Traccar Client (GPS en segundo plano) a /api/gps.
// Acepta los dos formatos de Traccar: OsmAnd (parámetros: id, lat, lon, timestamp, accuracy, speed en nudos, batt)
// y el JSON de Traccar Client 9 ({device_id, location: {timestamp, coords: {...}, battery: {level}}} o una lista).
export type PuntoGps = { fecha_hora: string; lat: number; lng: number; precision_m: number | null; velocidad_kmh: number | null; bateria_pct: number | null }

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Unix en segundos o milisegundos, o fecha ISO. */
export function fechaGps(v: unknown, ahora = new Date()): string {
  const n = num(v)
  if (n != null) return new Date(n > 1e12 ? n : n * 1000).toISOString()
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString()
  return ahora.toISOString()
}

function punto(lat: unknown, lng: unknown, extra: { fecha?: unknown; precision?: unknown; kmh?: number | null; bateria?: number | null }): PuntoGps | null {
  const la = num(lat), lo = num(lng)
  if (la == null || lo == null) return null
  return { fecha_hora: fechaGps(extra.fecha), lat: la, lng: lo, precision_m: num(extra.precision), velocidad_kmh: extra.kmh ?? null, bateria_pct: extra.bateria ?? null }
}

/** Lee el código del vendedor y las posiciones de un envío de Traccar. */
export function leerEnvioGps(params: URLSearchParams, cuerpo: unknown): { codigo: string | null; puntos: PuntoGps[] } {
  const puntos: PuntoGps[] = []
  let codigo = params.get('id') ?? params.get('deviceid')
  // OsmAnd: todo en la dirección (o en un formulario).
  if (params.get('lat') != null) {
    const nudos = num(params.get('speed'))
    const p = punto(params.get('lat'), params.get('lon') ?? params.get('lng'), {
      fecha: params.get('timestamp'), precision: params.get('accuracy') ?? params.get('hdop'),
      kmh: nudos == null ? null : Math.round(nudos * 1.852 * 10) / 10, bateria: num(params.get('batt')),
    })
    if (p) puntos.push(p)
  }
  // JSON de Traccar Client 9.
  if (cuerpo && typeof cuerpo === 'object') {
    const c = cuerpo as Record<string, unknown>
    codigo = codigo ?? (typeof c.device_id === 'string' ? c.device_id : null)
    const ubic = c.location
    for (const l of (Array.isArray(ubic) ? ubic : ubic ? [ubic] : []) as Record<string, unknown>[]) {
      const co = (l.coords ?? {}) as Record<string, unknown>
      const ms = num(co.speed)
      const nivel = num((l.battery as Record<string, unknown> | undefined)?.level)
      const p = punto(co.latitude, co.longitude, {
        fecha: l.timestamp, precision: co.accuracy,
        kmh: ms == null || ms < 0 ? null : Math.round(ms * 3.6 * 10) / 10,
        bateria: nivel == null || nivel < 0 ? null : Math.round(nivel <= 1 ? nivel * 100 : nivel),
      })
      if (p) puntos.push(p)
    }
  }
  return { codigo: codigo?.trim() || null, puntos }
}
