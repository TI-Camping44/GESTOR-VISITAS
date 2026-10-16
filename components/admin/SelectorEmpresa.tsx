'use client'
// Para usuarios con acceso a varias empresas (TI): elige con cuál trabaja.
// Toda la app (vendedores, zonas, rutas, en vivo, reportes) pasa a mostrar esa empresa.
import { useEffect, useState } from 'react'
import { supabaseNavegador } from '@/lib/supabase/client'
import { mensajeError } from '@/lib/utils'
import type { Empresa } from '@/lib/database.types'

export function SelectorEmpresa({ actual }: { actual: string | null }) {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [cambiando, setCambiando] = useState(false)

  useEffect(() => {
    supabaseNavegador().from('vis_empresas').select('id, nombre').order('created_at')
      .then(({ data }) => setEmpresas(data ?? []))
  }, [])

  async function cambiar(id: string) {
    setCambiando(true)
    const { error } = await supabaseNavegador().rpc('vis_cambiar_empresa', { p_empresa: id })
    if (error) { setCambiando(false); alert(mensajeError(error)); return }
    window.location.reload()
  }

  if (empresas.length < 2) return null
  return (
    <label className="mt-2 block text-xs text-barra-tenue">
      Empresa
      <select value={actual ?? ''} disabled={cambiando} onChange={(e) => void cambiar(e.target.value)}
        className="mt-1 block w-full rounded-md border border-barra-hover bg-barra px-2 py-1.5 text-sm text-barra-tinta">
        {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
      </select>
    </label>
  )
}
