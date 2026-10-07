import Link from 'next/link'
import { requerirSupervisor } from '@/lib/sesion'
import { supabaseServidor } from '@/lib/supabase/server'
import { NavAdmin } from '@/components/admin/NavAdmin'
import { BotonSalir } from '@/components/BotonSalir'

export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const perfil = await requerirSupervisor()
  // Un sync fallido queda en rojo hasta que un admin lo marque como visto (BRIEF regla 7).
  let fallos = 0
  if (perfil.rol === 'admin') {
    const sb = await supabaseServidor()
    const { count } = await sb.from('vis_sync_log').select('id', { count: 'exact', head: true }).eq('ok', false).is('visto_el', null)
    fallos = count ?? 0
  }
  return (
    <div className="min-h-full lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="border-b border-borde bg-superficie px-3 py-3 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="mb-3 flex items-center justify-between gap-2 px-2 lg:block">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-marca">Camping 44</p>
            <p className="font-semibold">Visitas y rutas</p>
          </div>
          <p className="truncate text-xs text-tenue lg:mt-1">{perfil.nombre}</p>
        </div>
        <NavAdmin rol={perfil.rol} />
        <BotonSalir className="mt-3 hidden w-full lg:flex" />
      </aside>
      <div className="min-w-0">
        {fallos > 0 && (
          <div role="alert" className="bg-red-600 px-4 py-2 text-sm font-medium text-white">
            La sincronización con Odoo falló {fallos === 1 ? 'una vez' : `${fallos} veces`}.{' '}
            <Link href="/sync" className="underline">Ver detalle</Link>
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
      </div>
    </div>
  )
}
