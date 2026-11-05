// Análisis del recorrido de una jornada: dónde se quedó parado, cuándo no hubo GPS (y con cuánta batería)
// y si pasó la velocidad máxima. Sirve igual con posiciones de la app y de Traccar (GPS en segundo plano).
import { distanciaM } from '@/lib/geo'

export type Pos = { fecha_hora: string; lat: number; lng: number; precision_m?: number | null; bateria_pct?: number | null; velocidad_kmh?: number | null; origen?: string | null }
export type Parada = { inicio: string; fin: string; minutos: number; lat: number; lng: number }
export type Corte = {
  inicio: string; fin: string; minutos: number; km: number | null
  bateriaAntes: number | null; bateriaDespues: number | null
  /** al_iniciar: desde que inició la jornada hasta la primera posición; al_final: desde la última hasta el cierre o ahora. */
  tipo: 'en_camino' | 'al_iniciar' | 'al_final'
  /** Dónde se cortó y dónde volvió (en_camino), [lng, lat]. */
  desde?: [number, number]; hasta?: [number, number]
}
export type Exceso = { inicio: string; fin: string; maxKmh: number; lat: number; lng: number }
export type Analisis = { paradas: Parada[]; cortes: Corte[]; excesos: Exceso[]; cubiertoPct: number | null; maxKmh: number | null; tramos: [number, number][][] }
export type Opciones = { radioM?: number; minParada?: number; huecoMin?: number; limiteKmh?: number }

const min = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60000

export function analizarJornada(pos: Pos[], inicio: string, fin: string | null, ahora = new Date().toISOString(), o: Opciones = {}): Analisis {
  const { radioM = 150, minParada = 10, huecoMin = 5, limiteKmh = 110 } = o
  const p = [...pos].sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora))
  const cierre = fin ?? ahora
  const total = Math.max(min(inicio, cierre), 0)

  // Paradas: puntos seguidos dentro de un radio del centro, por 10 minutos o más (aunque no haya puntos en el medio).
  const paradas: Parada[] = []
  for (let i = 0; i < p.length;) {
    let j = i, la = p[i]!.lat, lo = p[i]!.lng, n = 1
    while (j + 1 < p.length && distanciaM({ lat: la, lng: lo }, p[j + 1]!) <= radioM) {
      j++; n++
      la += (p[j]!.lat - la) / n; lo += (p[j]!.lng - lo) / n
    }
    const m = min(p[i]!.fecha_hora, p[j]!.fecha_hora)
    if (m >= minParada) paradas.push({ inicio: p[i]!.fecha_hora, fin: p[j]!.fecha_hora, minutos: Math.round(m), lat: la, lng: lo })
    i = j + 1
  }

  // Cortes: se movió sin que haya posiciones (más de 5 minutos y más lejos que el radio), y los bordes de la jornada.
  const cortes: Corte[] = []
  const tramos: [number, number][][] = []
  let actual: [number, number][] = []
  p.forEach((x, k) => {
    const a = p[k - 1]
    if (a && min(a.fecha_hora, x.fecha_hora) > huecoMin && distanciaM(a, x) > radioM) {
      cortes.push({ inicio: a.fecha_hora, fin: x.fecha_hora, minutos: Math.round(min(a.fecha_hora, x.fecha_hora)), km: Math.round(distanciaM(a, x) / 100) / 10,
        bateriaAntes: a.bateria_pct ?? null, bateriaDespues: x.bateria_pct ?? null, tipo: 'en_camino', desde: [a.lng, a.lat], hasta: [x.lng, x.lat] })
      if (actual.length > 1) tramos.push(actual)
      actual = []
    }
    actual.push([x.lng, x.lat])
  })
  if (actual.length > 1) tramos.push(actual)
  const primera = p[0], ultima = p.at(-1)
  if (!primera) {
    if (total > huecoMin) cortes.push({ inicio, fin: cierre, minutos: Math.round(total), km: null, bateriaAntes: null, bateriaDespues: null, tipo: 'al_iniciar' })
  } else {
    if (min(inicio, primera.fecha_hora) > huecoMin) cortes.unshift({ inicio, fin: primera.fecha_hora, minutos: Math.round(min(inicio, primera.fecha_hora)), km: null, bateriaAntes: null, bateriaDespues: primera.bateria_pct ?? null, tipo: 'al_iniciar' })
    if (ultima && min(ultima.fecha_hora, cierre) > huecoMin) cortes.push({ inicio: ultima.fecha_hora, fin: cierre, minutos: Math.round(min(ultima.fecha_hora, cierre)), km: null, bateriaAntes: ultima.bateria_pct ?? null, bateriaDespues: null, tipo: 'al_final' })
  }
  const sin = cortes.reduce((s, c) => s + c.minutos, 0)

  // Velocidad: tramos seguidos por encima del límite.
  const excesos: Exceso[] = []
  let maxKmh: number | null = null
  for (const x of p) {
    const v = x.velocidad_kmh
    if (v == null) continue
    maxKmh = Math.max(maxKmh ?? 0, v)
    if (v <= limiteKmh) continue
    const ult = excesos.at(-1)
    if (ult && min(ult.fin, x.fecha_hora) <= 3) { ult.fin = x.fecha_hora; if (v > ult.maxKmh) Object.assign(ult, { maxKmh: Math.round(v), lat: x.lat, lng: x.lng }) }
    else excesos.push({ inicio: x.fecha_hora, fin: x.fecha_hora, maxKmh: Math.round(v), lat: x.lat, lng: x.lng })
  }

  return { paradas, cortes, excesos, cubiertoPct: total > 0 ? Math.max(0, Math.round(100 * (1 - sin / total))) : null, maxKmh: maxKmh == null ? null : Math.round(maxKmh), tramos }
}

/** Por qué no hubo GPS, en palabras. */
export function motivoCorte(c: Corte, conSegundoPlano: boolean): string {
  if (c.bateriaAntes != null && c.bateriaAntes <= 5) return `Batería agotada (${c.bateriaAntes} %)`
  if (c.tipo === 'al_iniciar') return 'Sin GPS desde que inició la jornada'
  if (c.tipo === 'al_final') return conSegundoPlano ? 'Dejó de llegar el GPS (celular apagado, sin señal o GPS en segundo plano detenido)' : 'Sin GPS hasta el cierre (app cerrada o celular bloqueado)'
  return conSegundoPlano ? 'Sin GPS (celular apagado, sin señal o GPS en segundo plano detenido)' : 'Sin GPS (app cerrada o celular bloqueado)'
}

/**
 * Saca las lecturas que hacen ir y volver la línea: las imprecisas (más de 60 m) cuando hay otra buena
 * a menos de 3 minutos, los saltos imposibles (más de 180 km/h) y los picos (va lejos y vuelve enseguida).
 */
export function limpiarPosiciones<T extends Pos>(pos: T[], { malaM = 60, maxKmh = 180 }: { malaM?: number; maxKmh?: number } = {}): T[] {
  const p = [...pos].sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora))
  const buena = (x: T) => x.precision_m == null || Number(x.precision_m) <= malaM
  let r = p.filter((x, i) => buena(x) || !p.some((y, j) => j !== i && buena(y) && Math.abs(min(x.fecha_hora, y.fecha_hora)) <= 3))
  for (let cambio = true; cambio;) {
    cambio = false
    const out: T[] = []
    for (let i = 0; i < r.length; i++) {
      const a = out.at(-1), b = r[i]!, c = r[i + 1]
      if (a) {
        const ab = distanciaM(a, b), h = min(a.fecha_hora, b.fecha_hora) / 60
        if (h > 0 && ab / 1000 / h > maxKmh) { cambio = true; continue }
        if (c && ab > 250) {
          const bc = distanciaM(b, c), ac = distanciaM(a, c)
          if (bc > 250 && ac < 0.4 * Math.min(ab, bc) && min(a.fecha_hora, c.fecha_hora) <= 10) { cambio = true; continue }
        }
      }
      out.push(b)
    }
    r = out
  }
  return r
}
