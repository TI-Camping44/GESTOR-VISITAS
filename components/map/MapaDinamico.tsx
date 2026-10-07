'use client'
import dynamic from 'next/dynamic'

// MapLibre necesita el navegador: nunca se renderiza en el servidor.
export const Mapa = dynamic(() => import('./Mapa').then((m) => m.Mapa), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-xl bg-borde/40" aria-label="Cargando mapa" />,
})
export type { PuntoMapa, LineaMapa } from './Mapa'
