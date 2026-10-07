import type { NextConfig } from 'next'

// Parámetros de tracking/GPS que necesita el navegador. No son secretos: se fijan en el build.
const VIS_PUBLICAS = {
  VIS_GPS_PRECISION_MAX_M: process.env.VIS_GPS_PRECISION_MAX_M ?? '100',
  VIS_DIST_ALERTA_M: process.env.VIS_DIST_ALERTA_M ?? '300',
  VIS_TRACK_INTERVALO_S: process.env.VIS_TRACK_INTERVALO_S ?? '60',
  VIS_TRACK_DIST_MIN_M: process.env.VIS_TRACK_DIST_MIN_M ?? '50',
  VIS_SIN_SENAL_MIN: process.env.VIS_SIN_SENAL_MIN ?? '15',
  VIS_BASE_LAT: process.env.VIS_BASE_LAT ?? '',
  VIS_BASE_LNG: process.env.VIS_BASE_LNG ?? '',
}

const nextConfig: NextConfig = {
  env: VIS_PUBLICAS,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ]
  },
}

export default nextConfig
