'use client'
// «Volver» arriba de las pantallas que no son pestañas (lugar, visita, alta de médico o de lugar).
// Si se llegó navegando dentro de la app vuelve a la pantalla anterior; si se abrió directo
// (link, recarga, sin señal) va a la pantalla que corresponde.
import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { urlLugar } from '@/lib/rutas'
import { useVendedor } from './Proveedor'

const PESTANAS = ['/hoy', '/visitas', '/mapa', '/medicos']

export function BotonVolver() {
  const ruta = usePathname()
  const busqueda = useSearchParams()
  const router = useRouter()
  const { esMedica } = useVendedor()
  const navegaciones = useRef(0)
  const anterior = useRef(ruta)
  useEffect(() => {
    if (anterior.current !== ruta) { navegaciones.current += 1; anterior.current = ruta }
  }, [ruta])

  const pestanas = esMedica ? PESTANAS : [...PESTANAS, '/prospecto/nuevo']
  if (ruta === '/' || pestanas.includes(ruta)) return null

  const c = busqueda.get('c')
  const lugar = busqueda.get('lugar')
  const parada = busqueda.get('parada')
  const destino =
    ruta === '/visita' && busqueda.get('m') && c ? urlLugar(c, { parada }) :
    ruta === '/lugar/nuevo' ? '/mapa' :
    ruta === '/medicos/nuevo' ? (lugar ? urlLugar(lugar) : '/medicos') :
    '/hoy'

  return (
    <button type="button" onClick={() => (navegaciones.current > 0 ? router.back() : router.push(destino))}
      className="-ml-1 mb-2 inline-flex items-center gap-0.5 rounded-lg py-1 pr-2 text-sm font-medium text-marca">
      <ChevronLeft className="size-5" aria-hidden /> Volver
    </button>
  )
}
