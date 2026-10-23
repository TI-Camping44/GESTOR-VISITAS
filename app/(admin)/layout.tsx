import Link from 'next/link'
import { requerirSupervisor } from '@/lib/sesion'
import { supabaseServidor } from '@/lib/supabase/server'
import { NavAdmin } from '@/components/admin/NavAdmin'
import { BotonSalir } from '@/components/BotonSalir'
import { SelectorEmpresa } from '@/components/admin/SelectorEmpresa'
import { SelectorTema } from '@/components/SelectorTema'
import { temaEmpresa } from '@/lib/utils'

export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const perfil = await requerirSupervisor()
  // Un sync fallido queda en rojo hasta que un admin lo marque como visto (BRIEF regla 7).
  let fallos = 0
  const sb = await supabaseServidor()
  if (perfil.rol === 'admin') {
    const { count } = await sb.from('vis_sync_log').select('id', { count: 'exact', head: true }).eq('ok', false).is('visto_el', null)
    fallos = count ?? 0
  }
  // Clientes dados de alta en zona de otro vendedor, sin revisar (las de su gente, por RLS).
  const { count: altas } = await sb.from('vis_alertas_alta').select('id', { count: 'exact', head: true }).is('revisada_el', null)
  return (
    <div data-empresa={temaEmpresa(perfil.empresa)} className="min-h-full bg-fondo text-tinta lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="border-b border-borde bg-barra px-3 py-3 text-barra-tinta lg:border-b-0 lg:border-r">
        <div className="lg:sticky lg:top-3">
        <div className="mb-3 flex items-center justify-between gap-2 px-2 lg:block">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-barra-acento">{perfil.empresa ?? 'Camping 44'}{perfil.equipo && ` · ${perfil.equipo}`}</p>
            <p className="font-semibold">Visitas y rutas</p>
          </div>
          <p className="truncate text-xs text-barra-tenue lg:mt-1">{perfil.nombre}</p>
          {perfil.multi_empresa && <SelectorEmpresa actual={perfil.empresa_id} />}
        </div>
        <NavAdmin rol={perfil.rol} altas={altas ?? 0} />
        <SelectorTema enBarra className="mt-3 hidden lg:flex" />
        <BotonSalir className="mt-3 hidden w-full lg:flex" />
        </div>
      </aside>
      <div className="min-w-0">
        {fallos > 0 && (
          <div role="alert" className="bg-red-600 px-4 py-2 text-sm font-medium text-white">
            La sincronización con Odoo falló {fallos === 1 ? 'una vez' : `${fallos} veces`}.{' '}
            <Link href="/sync" className="underline">Ver detalle</Link>
          </div>
        )}
        {(altas ?? 0) > 0 && (
          <div role="status" className="bg-amber-100 px-4 py-2 text-sm font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            {altas === 1 ? 'Un cliente nuevo fue dado de alta' : `${altas} clientes nuevos fueron dados de alta`} en zona de otro vendedor o al lado de sus clientes.{' '}
            <Link href="/altas" className="underline">Revisar</Link>
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
      </div>
    </div>
  )
}
