'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarCheck, Map, UserPlus, LayoutDashboard } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVendedor } from './Proveedor'

export function NavInferior() {
  const ruta = usePathname()
  const { perfil } = useVendedor()
  const items = [
    { href: '/hoy', texto: 'Hoy', Icono: CalendarCheck },
    { href: '/mapa', texto: 'Mapa', Icono: Map },
    { href: '/prospecto/nuevo', texto: 'Nuevo cliente', Icono: UserPlus },
    ...(perfil.rol !== 'vendedor' ? [{ href: '/tablero', texto: 'Panel', Icono: LayoutDashboard }] : []),
  ]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-borde bg-superficie pb-[env(safe-area-inset-bottom,0px)]" aria-label="Secciones">
      <ul className="mx-auto flex max-w-lg">
        {items.map(({ href, texto, Icono }) => {
          const activo = ruta === href || ruta.startsWith(`${href}/`)
          return (
            <li key={href} className="flex-1">
              <Link href={href} className={cn('flex flex-col items-center gap-0.5 py-2 text-xs font-medium', activo ? 'text-marca' : 'text-tenue')} aria-current={activo ? 'page' : undefined}>
                <Icono className="size-5" aria-hidden />
                {texto}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
