import { requerirPerfil } from '@/lib/sesion'
import { ProveedorVendedor } from '@/components/vendedor/Proveedor'
import { BarraJornada } from '@/components/vendedor/BarraJornada'
import { NavInferior } from '@/components/vendedor/NavInferior'

export default async function LayoutVendedor({ children }: { children: React.ReactNode }) {
  const perfil = await requerirPerfil()
  return (
    <ProveedorVendedor perfil={perfil}>
      <div className="mx-auto min-h-full max-w-lg pb-24">
        <BarraJornada />
        <main className="px-4 py-4">{children}</main>
      </div>
      <NavInferior />
    </ProveedorVendedor>
  )
}
