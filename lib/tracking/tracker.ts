'use client'
// Tracking GPS durante la jornada (BRIEF §4b). Solo corre entre "Iniciar" y "Terminar jornada".
// Guarda una posición cada VIS_TRACK_INTERVALO_S o cuando se movió VIS_TRACK_DIST_MIN_M, lo que pase
// primero; descarta lecturas con precisión peor a 200 m. Las acumula en IndexedDB y sube en lote.
// Límite real: con la pantalla apagada Android pausa el JavaScript y quedan huecos.
import { VIS } from '@/lib/config'
import { distanciaM } from '@/lib/geo'
import { aLectura, leerGps, nivelBateria, type Lectura } from '@/lib/gps'
import { encolarPosiciones, subirPendientes } from '@/lib/offline/subir'

type WakeLock = { release: () => Promise<void> }
const MIN_ENTRE_PUNTOS_MS = 10_000

class Tracker {
  private watchId: number | null = null
  private ultima: Lectura | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private wakeLock: WakeLock | null = null
  private escuchas = new Set<() => void>()
  activo = false
  ultimaLectura: Lectura | null = null

  suscribir(fn: () => void) {
    this.escuchas.add(fn)
    return () => { this.escuchas.delete(fn) }
  }
  private avisar() { for (const fn of this.escuchas) fn() }

  iniciar() {
    if (this.activo || typeof navigator === 'undefined' || !navigator.geolocation) return
    this.activo = true
    this.watchId = navigator.geolocation.watchPosition(
      (p) => void this.recibir(aLectura(p)),
      () => { /* sin señal GPS: se reintenta solo */ },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    )
    this.timer = setInterval(() => void this.subir(), VIS.subidaCadaMs)
    window.addEventListener('online', this.alVolverSenal)
    document.addEventListener('visibilitychange', this.alCambiarVisibilidad)
    void this.pedirWakeLock()
    this.avisar()
  }

  async detener() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId)
    if (this.timer) clearInterval(this.timer)
    window.removeEventListener('online', this.alVolverSenal)
    document.removeEventListener('visibilitychange', this.alCambiarVisibilidad)
    await this.wakeLock?.release().catch(() => {})
    this.watchId = null
    this.timer = null
    this.wakeLock = null
    this.ultima = null
    this.activo = false
    this.avisar()
  }

  private async recibir(l: Lectura) {
    this.ultimaLectura = l
    if (l.precision > VIS.trackPrecisionMaxM) return
    const ant = this.ultima
    const ms = ant ? l.fecha.getTime() - ant.fecha.getTime() : Infinity
    const movido = ant ? distanciaM(ant, l) : Infinity
    const toca = ms >= VIS.trackIntervaloS * 1000 || (movido >= VIS.trackDistMinM && ms >= MIN_ENTRE_PUNTOS_MS)
    if (!toca) return
    this.ultima = l
    await encolarPosiciones([{
      fecha_hora: l.fecha.toISOString(), lat: l.lat, lng: l.lng, precision_m: l.precision,
      velocidad_kmh: l.velocidadKmh, bateria_pct: await nivelBateria(), origen: 'tracking',
    }])
    this.avisar()
  }

  async subir() {
    await subirPendientes().catch(() => {})
    this.avisar()
  }

  private alVolverSenal = () => { void this.subir() }

  private alCambiarVisibilidad = () => {
    if (document.visibilityState === 'visible' && this.activo) {
      void this.pedirWakeLock()
      void this.subir() // al volver a abrir la app se suben las pendientes
    }
  }

  private async pedirWakeLock() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } }
      this.wakeLock = (await nav.wakeLock?.request('screen')) ?? null
    } catch {
      this.wakeLock = null // el navegador no lo permite: se sigue igual
    }
  }
}

export const tracker = new Tracker()

/**
 * Ubicación para una pantalla (visita, alta, cerca mío). Con la jornada iniciada el tracking ya
 * tiene una lectura reciente y se usa al instante; si no, se pide al GPS. Si el GPS no responde,
 * sirve una lectura del tracking de hasta 1 minuto.
 */
export async function ubicacionRapida(): Promise<Lectura> {
  const reciente = (maxMs: number) => {
    const l = tracker.ultimaLectura
    return l && Date.now() - l.fecha.getTime() < maxMs ? l : null
  }
  const ya = reciente(15_000)
  if (ya) return ya
  try {
    return await leerGps()
  } catch (e) {
    const respaldo = reciente(60_000)
    if (respaldo) return respaldo
    throw e
  }
}
