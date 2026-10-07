'use client'
// Zonas (BRIEF §6 supervisor 5): alta, nombre, color y activa. Polígonos: Fase 2.
import { useCallback, useEffect, useState } from 'react'
import { Aviso, Boton, Entrada, Etiqueta, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { mensajeError } from '@/lib/utils'
import type { Zona } from '@/lib/database.types'

const COLORES = ['#6366f1', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#9333ea', '#be185d', '#4d7c0f']

export default function Zonas() {
  const sb = supabaseNavegador()
  const [zonas, setZonas] = useState<(Zona & { clientes: { count: number }[] })[]>([])
  const [nombre, setNombre] = useState('')
  const [color, setColor] = useState(COLORES[0]!)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await sb.from('vis_zonas').select('*, clientes:vis_clientes(count)').order('nombre')
    if (error) setError(mensajeError(error))
    else setZonas((data ?? []) as never)
  }, [sb])
  useEffect(() => { void cargar() }, [cargar])

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    const { error } = await sb.from('vis_zonas').insert({ nombre: nombre.trim(), color })
    if (error) return setError(error.code === '23505' ? 'Ya existe una zona con ese nombre.' : mensajeError(error))
    setNombre('')
    setError(null)
    void cargar()
  }

  async function actualizar(id: string, cambios: Partial<Zona>) {
    const { error } = await sb.from('vis_zonas').update(cambios).eq('id', id)
    if (error) setError(error.code === '23505' ? 'Ya existe una zona con ese nombre.' : mensajeError(error))
    void cargar()
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Zonas</h1>
      <Tarjeta>
        <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <Etiqueta htmlFor="z-nombre">Nueva zona</Etiqueta>
            <Entrada id="z-nombre" placeholder="Zona Norte, Asunción Centro…" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium">Color</span>
            <div className="flex gap-1">
              {COLORES.map((c) => (
                <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
                  className="size-8 rounded-full border-2" style={{ background: c, borderColor: color === c ? 'var(--c-tinta)' : 'transparent' }} />
              ))}
            </div>
          </div>
          <Boton type="submit">Agregar</Boton>
        </form>
      </Tarjeta>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {zonas.length === 0 ? <Vacio titulo="Sin zonas">Creá las zonas con las que trabajan los vendedores (las de Odoo se suman al conectar el sync).</Vacio> : (
        <Tarjeta className="p-0">
          <ul>
            {zonas.map((z) => (
              <li key={z.id} className="flex flex-wrap items-center gap-3 border-b border-borde px-4 py-3 last:border-0">
                <input type="color" value={z.color} aria-label={`Color de ${z.nombre}`} onChange={(e) => void actualizar(z.id, { color: e.target.value })} className="size-8 cursor-pointer rounded border-0 bg-transparent" />
                <Entrada defaultValue={z.nombre} aria-label="Nombre" className="max-w-xs flex-1"
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== z.nombre) void actualizar(z.id, { nombre: e.target.value.trim() }) }} />
                <span className="text-sm text-tenue tabular">{z.clientes[0]?.count ?? 0} clientes</span>
                <label className="ml-auto flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={z.activo} onChange={(e) => void actualizar(z.id, { activo: e.target.checked })} /> Activa
                </label>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
      <p className="text-sm text-tenue">Para asignar clientes a una zona, seleccionalos en Clientes y usá “Asignar zona”.</p>
    </div>
  )
}
