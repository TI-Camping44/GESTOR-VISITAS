import { requerirPerfil } from '@/lib/sesion'
import { ProveedorVendedor } from '@/components/vendedor/Proveedor'
import { BarraJornada } from '@/components/vendedor/BarraJornada'
import { NavInferior } from '@/components/vendedor/NavInferior'
import { temaEmpresa } from '@/lib/utils'
import { SelectorTema } from '@/components/SelectorTema'

export default async function LayoutVendedor({ children }: { children: React.ReactNode }) {
  const perfil = await requerirPerfil()
  return (
    <ProveedorVendedor perfil={perfil}>
      <div data-empresa={temaEmpresa(perfil.empresa)} className="min-h-full bg-fondo text-tinta">
        <div className="mx-auto min-h-full max-w-lg pb-24">
          <BarraJornada />
          <main className="px-4 py-4">{children}</main>
          <SelectorTema className="mx-4 mb-4" />
        </div>
        <NavInferior />
      </div>
    </ProveedorVendedor>
  )
}
