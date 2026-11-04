// Ruteo de visita médica: horas estimadas de llegada y lectura de la planilla pegada desde Google Sheets.
import { distanciaM, type Punto } from '@/lib/geo'
import { sumarDias } from '@/lib/fechas'

// ── Horas estimadas ────────────────────────────────────────────────
// Igual que la planilla de Sergio: línea recta × 1,35 (calles), 20 km/h, 5 min para estacionar,
// 45 min por lugar y almuerzo de una hora al pasar las 12 (si el día empezó antes de las 11).
export type OpcionesHoras = { inicioMin?: number; minPorLugar?: number; kmh?: number; factorCalle?: number; estacionarMin?: number; sinDatosMin?: number }
export type Hora = { llegada: number; salida: number; km: number | null }

const conCoordenadas = (p: { lat: number | null; lng: number | null } | null | undefined): p is Punto => p?.lat != null && p?.lng != null

export function horasEstimadas(base: { lat: number | null; lng: number | null } | null, paradas: { lat: number | null; lng: number | null }[], o: OpcionesHoras = {}): Hora[] {
  const { inicioMin = 8 * 60, minPorLugar = 45, kmh = 20, factorCalle = 1.35, estacionarMin = 5, sinDatosMin = 15 } = o
  let t = inicioMin
  let antes: { lat: number | null; lng: number | null } | null = base
  let almorzo = inicioMin >= 11 * 60
  return paradas.map((p) => {
    let km: number | null = null
    let viaje = sinDatosMin
    if (conCoordenadas(antes) && conCoordenadas(p)) {
      km = (distanciaM(antes, p) / 1000) * factorCalle
      viaje = Math.round((km / kmh) * 60 + estacionarMin)
    }
    const llegada = t + viaje
    const salida = llegada + minPorLugar
    t = salida
    if (!almorzo && t >= 12 * 60) { t += 60; almorzo = true }
    antes = p
    return { llegada, salida, km: km == null ? null : Math.round(km * 10) / 10 }
  })
}

export const fmtMin = (m: number) => `${Math.floor(m / 60) % 24}:${String(Math.round(m) % 60).padStart(2, '0')}`
/** "08:30" → 510; "8" → 480. */
export function minDeHora(t: string): number | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(t)
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2] ?? 0)
  return h < 24 && mi < 60 ? h * 60 + mi : null
}

// ── Planilla pegada ────────────────────────────────────────────────
// Columnas (en cualquier orden, con encabezado): Centro médico / Consultorio · Especialidad · Dr · Día de visita.
// Opcionales: Fecha, Orden, Dirección, Latitud, Longitud. Sin encabezado se toma ese orden de cuatro columnas.
export type FilaRuteo = { dia: string; lugar: string; especialidad: string | null; medico: string | null; direccion: string | null; lat: number | null; lng: number | null; orden: number | null; renglon: number }
type Col = 'lugar' | 'especialidad' | 'medico' | 'dia' | 'fecha' | 'orden' | 'direccion' | 'lat' | 'lng'

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']

function columna(enc: string): Col | null {
  const t = normal(enc)
  if (!t) return null
  if (/^(dia|dia de visita|dia visita)$/.test(t) || t.startsWith('dia de')) return 'dia'
  if (t.startsWith('fecha')) return 'fecha'
  if (t.startsWith('orden') || t === 'n' || t === 'nro' || t === '#') return 'orden'
  if (t.startsWith('especialidad')) return 'especialidad'
  if (/^(dr|dra|dr\.|doctor|doctora|medico|medicos|medico\(s\)|medico\(s\) objetivo|medico objetivo|profesional)/.test(t)) return 'medico'
  if (/^(centro|consultorio|institucion|lugar|hospital|sanatorio|establecimiento)/.test(t)) return 'lugar'
  if (t.startsWith('direccion')) return 'direccion'
  if (t.startsWith('lat')) return 'lat'
  if (t.startsWith('lon') || t === 'lng') return 'lng'
  return null
}

/** Día de la semana del lunes `lunes`: "04/11/2026", "4/11", "2026-11-04", "Miércoles", "mie". */
export function leerDia(texto: string, lunes: string): string | null {
  const t = normal(texto)
  if (!t) return null
  const anio = lunes.slice(0, 4)
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(t)
  if (m) {
    const a = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : anio
    return `${a}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  }
  const i = DIAS.findIndex((d) => t.startsWith(d) || (t.length >= 3 && d.startsWith(t.slice(0, 3)) && /^[a-z]+$/.test(t.split(/\s/)[0]!)))
  return i >= 0 ? sumarDias(lunes, i) : null
}

const numero = (s: string | undefined) => {
  if (!s) return null
  const n = Number(s.trim().replace(',', '.'))
  return Number.isFinite(n) && s.trim() !== '' ? n : null
}
const separarMedicos = (s: string) => s.split(/\s*(?:[;\n/]|,(?!\s*\d))\s*/).map((x) => x.trim()).filter(Boolean)

export function leerPlanilla(texto: string, lunes: string): { filas: FilaRuteo[]; errores: string[] } {
  const renglones = texto.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '')
  if (renglones.length === 0) return { filas: [], errores: [] }
  const sep = renglones[0]!.includes('\t') ? '\t' : renglones[0]!.includes(';') ? ';' : ','
  const celdas = renglones.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')))
  let mapa: Partial<Record<Col, number>> = {}
  celdas[0]!.forEach((c, i) => { const k = columna(c); if (k && mapa[k] == null) mapa[k] = i })
  const conEncabezado = mapa.lugar != null
  if (!conEncabezado) mapa = { lugar: 0, especialidad: 1, medico: 2, dia: 3 }
  const filas: FilaRuteo[] = []
  const errores: string[] = []
  const desde = conEncabezado ? 1 : 0
  for (let r = desde; r < celdas.length; r++) {
    const c = celdas[r]!
    const v = (k: Col) => (mapa[k] != null ? (c[mapa[k]!] ?? '').trim() : '')
    const lugar = v('lugar')
    if (!lugar) continue
    const dia = leerDia(v('fecha'), lunes) ?? leerDia(v('dia'), lunes)
    if (!dia) { errores.push(`Renglón ${r + 1} (${lugar}): falta el día o no se entiende «${v('dia') || v('fecha')}».`); continue }
    if (dia < lunes || dia > sumarDias(lunes, 6)) { errores.push(`Renglón ${r + 1} (${lugar}): el ${dia.split('-').reverse().join('/')} no es de esa semana.`); continue }
    const base = { dia, lugar, especialidad: v('especialidad') || null, direccion: v('direccion') || null, lat: numero(v('lat')), lng: numero(v('lng')), orden: numero(v('orden')), renglon: r + 1 }
    const medicos = separarMedicos(v('medico'))
    if (medicos.length === 0) filas.push({ ...base, medico: null })
    else for (const m of medicos) filas.push({ ...base, medico: m })
  }
  // Orden dentro de cada día: la columna Orden si está; si no, el de la planilla.
  filas.sort((a, b) => a.dia.localeCompare(b.dia) || (a.orden ?? a.renglon) - (b.orden ?? b.renglon) || a.renglon - b.renglon)
  return { filas, errores }
}
