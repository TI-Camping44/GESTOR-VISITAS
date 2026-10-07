'use client'
// Captura de GPS con mensajes claros para el vendedor.
export type Lectura = { lat: number; lng: number; precision: number; velocidadKmh: number | null; fecha: Date }

export class ErrorGps extends Error {}

const MENSAJES: Record<number, string> = {
  1: 'La app no tiene permiso de ubicación. Activalo en los ajustes del navegador para este sitio.',
  2: 'No se pudo obtener la ubicación. Revisá que el GPS del celular esté prendido.',
  3: 'El GPS tardó demasiado. Salí al aire libre y reintentá.',
}

export function aLectura(p: GeolocationPosition): Lectura {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    precision: Math.round(p.coords.accuracy),
    velocidadKmh: p.coords.speed == null ? null : Math.round(p.coords.speed * 3.6),
    fecha: new Date(p.timestamp || Date.now()),
  }
}

export function leerGps(timeout = 20000): Promise<Lectura> {
  return new Promise((ok, mal) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      mal(new ErrorGps('Este navegador no tiene GPS.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => ok(aLectura(p)),
      (e) => mal(new ErrorGps(MENSAJES[e.code] ?? e.message)),
      { enableHighAccuracy: true, maximumAge: 0, timeout },
    )
  })
}

export async function nivelBateria(): Promise<number | null> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }
    if (!nav.getBattery) return null
    return Math.round((await nav.getBattery()).level * 100)
  } catch {
    return null
  }
}
