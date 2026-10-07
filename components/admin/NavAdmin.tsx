'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Route, Radio, Users, MapPinned, UserCog, RefreshCw, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Rol } from '@/lib/database.types'

export function NavAdmin({ rol }: { rol: Rol }) {
  const ruta = usePathname()
  const items = [
    { href: '/tablero', texto: 'Tablero', Icono: BarChart3 },
    { href: '/rutas', texto: 'Rutas', Icono: Route },
    { href: '/en-vivo', texto: 'En vivo', Icono: Radio },
    { href: '/clientes', texto: 'Clientes', Icono: Users },
    { href: '/zonas', texto: 'Zonas', Icono: MapPinned },
    { href: '/vendedores', texto: 'Vendedores', Icono: UserCog },
    ...(rol === 'admin' ? [{ href: '/sync', texto: 'Sync Odoo', Icono: RefreshCw }] : []),
    { href: '/hoy', texto: 'App del vendedor', Icono: Smartphone },
  ]
  return (
    <nav aria-label="Panel" className="flex gap-1 overflow-x-auto lg:flex-col">
      {items.map(({ href, texto, Icono }) => {
        const activo = ruta === href || ruta.startsWith(`${href}/`)
        return (
          <Link key={href} href={href} aria-current={activo ? 'page' : undefined}
            className={cn('flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium', activo ? 'bg-marca text-white' : 'text-tinta hover:bg-fondo')}>
            <Icono className="size-4" aria-hidden />{texto}
          </Link>
        )
      })}
    </nav>
  )
}
