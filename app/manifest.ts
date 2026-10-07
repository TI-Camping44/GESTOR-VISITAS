import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Visitas C44 — Camping 44',
    short_name: 'Visitas C44',
    description: 'Rutas y visitas de los vendedores',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f3f5f2',
    theme_color: '#1f6f4a',
    lang: 'es-PY',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
