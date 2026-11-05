import { Suspense } from 'react'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { requerirPerfil } from '@/lib/sesion'
import { supabaseServidor } from '@/lib/supabase/server'
import { ProveedorVendedor } from '@/components/vendedor/Proveedor'
import { BarraJornada } from '@/components/vendedor/BarraJornada'
import { NavInferior } from '@/components/vendedor/NavInferior'
import { BotonVolver } from '@/components/vendedor/BotonVolver'
import { BannerVerComo } from '@/components/vendedor/BannerVerComo'
import { SelectorTema } from '@/components/SelectorTema'
import { temaEmpresa } from '@/lib/utils'
import { COOKIE_VER_COMO } from '@/lib/verComo'
import type { Perfil } from '@/lib/database.types'

// Un supervisor o admin puede mirar la app de alguien de su gente (Ver la app como…, solo lectura).
async function perfilVisto(real: Perfil): Promise<Perfil | null> {
  if (real.rol === 'vendedor') return null
  const id = (await cookies()).get(COOKIE_VER_COMO)?.value
  if (!id) return null
  const sb = await supabaseServidor()
  const { data: lista } = await sb.rpc('vis_para_ver_como')
  const v = (lista ?? []).find((x) => x.id === id && x.empresa_id === real.empresa_id)
  if (!v) return null
  const { data } = await sb.from('vis_vendedores').select('id, nombre, email, rol, meta_diaria, meta_semanal, tracking_aceptado_el, empresa_id, equipo_id, tipo').eq('id', id).maybeSingle()
  if (!data) return null
  return { ...data, empresa: v.empresa, multi_empresa: false, equipo: v.equipo, tipo: v.tipo } as Perfil
}

export default async function LayoutVendedor({ children }: { children: React.ReactNode }) {
  const real = await requerirPerfil()
  const visto = await perfilVisto(real)
  const perfil = visto ?? real
  return (
    <ProveedorVendedor key={perfil.id} perfil={perfil} observador={visto ? real.nombre : null}>
      <div data-empresa={temaEmpresa(perfil.empresa)} className="min-h-full bg-fondo text-tinta">
        <div className="mx-auto min-h-full max-w-lg pb-24">
          {visto && <BannerVerComo nombre={visto.nombre} />}
          <BarraJornada />
          <main className="px-4 py-4"><Suspense fallback={null}><BotonVolver /></Suspense>{children}</main>
          <div className="mx-4 mb-2 text-center"><Link href="/gps" className="text-sm text-tenue underline">GPS en segundo plano</Link></div>
          <SelectorTema className="mx-4 mb-4" />
        </div>
        <NavInferior />
      </div>
    </ProveedorVendedor>
  )
}
