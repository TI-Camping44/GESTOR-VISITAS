'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Route, Radio, Users, MapPinned, UserCog, RefreshCw, Smartphone, FileBarChart, ShieldAlert, Stethoscope, ClipboardList, Building2, Tags, Pill, CalendarRange } from 'lucide-react'
import { usePanel } from './PanelModo'
import { cn } from '@/lib/utils'
import type { Rol } from '@/lib/database.types'

export function NavAdmin({ rol, altas = 0 }: { rol: Rol; altas?: number }) {
  const ruta = usePathname()
  const { modo } = usePanel()
  const comunes = [
    { href: '/vendedores', texto: 'Usuarios', Icono: UserCog },
    { href: '/ver-como', texto: 'Ver la app como…', Icono: Smartphone },
  ]
  const items = modo === 'medica' ? [
    { href: '/medica', texto: 'Actividad', Icono: ClipboardList },
    { href: '/medica/medicos', texto: 'Médicos', Icono: Stethoscope },
    { href: '/medica/lugares', texto: 'Consultorios y lugares', Icono: Building2 },
    { href: '/medica/especialidades', texto: 'Especialidades', Icono: Tags },
    { href: '/medica/ruteo', texto: 'Ruteo de la semana', Icono: CalendarRange },
    { href: '/medica/en-vivo', texto: 'En vivo', Icono: Radio },
    { href: '/medica/productos', texto: 'Productos y muestras', Icono: Pill },
    ...comunes,
  ] : [
    { href: '/tablero', texto: 'Tablero', Icono: BarChart3 },
    { href: '/reportes', texto: 'Reportes', Icono: FileBarChart },
    { href: '/rutas', texto: 'Rutas', Icono: Route },
    { href: '/en-vivo', texto: 'En vivo', Icono: Radio },
    { href: '/clientes', texto: 'Clientes', Icono: Users },
    { href: '/altas', texto: 'Altas a revisar', Icono: ShieldAlert, contador: altas },
    { href: '/zonas', texto: 'Zonas', Icono: MapPinned },
    ...comunes.slice(0, 1),
    ...(rol === 'admin' ? [{ href: '/sync', texto: 'Sync Odoo', Icono: RefreshCw }] : []),
    ...comunes.slice(1),
  ]
  return (
    <nav aria-label="Panel" className="flex gap-1 overflow-x-auto lg:flex-col">
      {items.map(({ href, texto, Icono, ...item }) => {
        const contador = ('contador' in item ? item.contador : 0) ?? 0
        const activo = ruta === href || (href !== '/medica' && ruta.startsWith(`${href}/`))
        return (
          <Link key={href} href={href} aria-current={activo ? 'page' : undefined}
            className={cn('flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium', activo ? 'bg-marca text-sobre-marca' : 'text-barra-tinta hover:bg-barra-hover')}>
            <Icono className="size-4" aria-hidden />{texto}
            {contador > 0 && <span className="ml-auto rounded-full bg-amber-400 px-1.5 text-xs font-semibold text-black">{contador}</span>}
          </Link>
        )
      })}
    </nav>
  )
}
