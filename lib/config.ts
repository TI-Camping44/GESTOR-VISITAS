// La URL y la clave publicable de Supabase son públicas por diseño (van en el bundle del
// navegador y el acceso real lo controla el RLS). Se pueden pisar con variables de entorno.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fhbnqvqxgmukukwlyune.supabase.co'
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_m9eqBUSN4IVr0HMz1fh_UA_HQMf8ol5'

const num = (v: string | undefined, porDefecto: number) => {
  const n = Number(v)
  return v && Number.isFinite(n) ? n : porDefecto
}

/** Parámetros de GPS y tracking (BRIEF §1). La base hace cumplir los suyos en vis_config. */
export const VIS = {
  gpsPrecisionMaxM: num(process.env.VIS_GPS_PRECISION_MAX_M, 100),
  distAlertaM: num(process.env.VIS_DIST_ALERTA_M, 300),
  trackIntervaloS: num(process.env.VIS_TRACK_INTERVALO_S, 60),
  trackDistMinM: num(process.env.VIS_TRACK_DIST_MIN_M, 50),
  trackPrecisionMaxM: 200,
  sinSenalMin: num(process.env.VIS_SIN_SENAL_MIN, 15),
  subidaCadaMs: 2 * 60 * 1000,
  base: process.env.VIS_BASE_LAT && process.env.VIS_BASE_LNG
    ? { lat: Number(process.env.VIS_BASE_LAT), lng: Number(process.env.VIS_BASE_LNG) }
    : null,
} as const

export const MAPA_ESTILO = 'https://tiles.openfreemap.org/styles/liberty'
export const CENTRO_PY = { lat: -24.2, lng: -57.5, zoom: 6 } as const

export const COLOR_ESTADO = {
  activo: '#16a34a',
  potencial: '#2563eb',
  inactivo: '#dc2626',
} as const

export const ETIQUETA_ESTADO = {
  activo: 'Activo',
  potencial: 'Potencial',
  inactivo: 'Sin movimiento',
} as const
