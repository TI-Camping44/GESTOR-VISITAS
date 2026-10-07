// Todo en hora de Asunción. Las fechas "puras" se manejan como 'YYYY-MM-DD'.
export const TZ = 'America/Asuncion'

const fmtIso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const fmtHora = new Intl.DateTimeFormat('es-PY', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
const fmtDiaCorto = new Intl.DateTimeFormat('es-PY', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' })
const fmtGs = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 })

/** 'YYYY-MM-DD' de un instante, en Asunción. */
export const fechaIso = (d: Date | string = new Date()) => fmtIso.format(typeof d === 'string' ? new Date(d) : d)
export const hoyIso = () => fechaIso(new Date())

/** 'YYYY-MM-DD' → Date a las 12:00 UTC (para aritmética de días sin problemas de huso). */
const aUtc = (iso: string) => new Date(`${iso}T12:00:00Z`)

export function sumarDias(iso: string, dias: number): string {
  const d = aUtc(iso)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Lunes de la semana de una fecha. */
export function lunesDe(iso: string): string {
  const dow = aUtc(iso).getUTCDay() // 0 = domingo
  return sumarDias(iso, dow === 0 ? -6 : 1 - dow)
}

/** Número de semana ISO (para nombres de ruta: "Sem 42"). */
export function semanaIso(iso: string): number {
  const d = aUtc(iso)
  const dow = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dow)
  const inicioAnio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - inicioAnio.getTime()) / 86400000 + 1) / 7)
}

/** dd/MM/yyyy */
export function fmtFecha(v: string | Date | null | undefined): string {
  if (!v) return '—'
  const iso = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fechaIso(v)
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function fmtFechaHora(v: string | Date | null | undefined): string {
  if (!v) return '—'
  const d = typeof v === 'string' ? new Date(v) : v
  return `${fmtFecha(d)} ${fmtHora.format(d)}`
}

export const fmtSoloHora = (v: string | Date) => fmtHora.format(typeof v === 'string' ? new Date(v) : v)

/** "lun 12/10" */
export const fmtDia = (iso: string) => fmtDiaCorto.format(aUtc(iso)).replace('.', '')

/** Gs. sin decimales */
export const fmtGuaranies = (n: number | null | undefined) => (n == null ? '—' : `Gs. ${fmtGs.format(Math.round(n))}`)

/** "hace 42 min" / "hace 3 h" / "hace 2 días" */
export function hace(v: string | Date | null | undefined, ahora = Date.now()): string {
  if (!v) return 'nunca'
  const min = Math.max(0, Math.round((ahora - new Date(v).getTime()) / 60000))
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} días`
}

export const DIAS_LABORALES = 6 // lunes a sábado
