'use client'
// Visita médica → Productos y muestras: qué productos se presentaron y cuántas muestras se dejaron en el
// período (por producto), y la lista de productos que elige la visitadora (llega de Odoo; un admin la ajusta).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Aviso, Boton, Entrada, Selector, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { descargarCsv } from '@/lib/csv'
import { hoyIso, sumarDias } from '@/lib/fechas'
import { useParamUrl } from '@/lib/useParamUrl'
import { cn, mensajeError } from '@/lib/utils'
import { leerVisitas, useVisitadoras, type VisitaMedica } from '@/components/admin/medica/datos'
import type { Producto } from '@/lib/database.types'

const PERIODOS = [{ dias: '7', texto: 'Últimos 7 días' }, { dias: '30', texto: 'Últimos 30 días' }, { dias: '60', texto: 'Últimos 60 días' }, { dias: '90', texto: 'Últimos 90 días' }]

export default function Productos() {
  const sb = supabaseNavegador()
  const visitadoras = useVisitadoras()
  const [dias, setDias] = useParamUrl('dias', '30')
  const [visitas, setVisitas] = useState<VisitaMedica[] | null>(null)
  const [productos, setProductos] = useState<Producto[]>([])
  const [esAdmin, setEsAdmin] = useState(false)
  const [nuevo, setNuevo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const cargarProductos = useCallback(async () => {
    const { data } = await sb.from('vis_productos').select('*').order('orden').order('nombre')
    setProductos(data ?? [])
  }, [sb])
  useEffect(() => { void cargarProductos(); void sb.rpc('vis_es_admin').then(({ data }) => setEsAdmin(!!data)) }, [sb, cargarProductos])
  useEffect(() => {
    if (!visitadoras.length) return
    let vivo = true
    setVisitas(null)
    leerVisitas(visitadoras.map((v) => v.id), sumarDias(hoyIso(), -Number(dias)), hoyIso())
      .then((v) => { if (vivo) setVisitas(v) }).catch((e: Error) => { if (vivo) { setError(e.message); setVisitas([]) } })
    return () => { vivo = false }
  }, [visitadoras, dias])

  const porProducto = useMemo(() => {
    const m = new Map<string, { veces: number; muestras: number; medicos: Set<string> }>()
    for (const v of visitas ?? []) for (const p of v.productos ?? []) {
      const x = m.get(p.producto) ?? { veces: 0, muestras: 0, medicos: new Set<string>() }
      x.veces++; x.muestras += Number(p.muestras ?? 0); if (v.medico_id) x.medicos.add(v.medico_id)
      m.set(p.producto, x)
    }
    return [...m].map(([producto, x]) => ({ producto, ...x, medicos: x.medicos.size })).sort((a, b) => b.veces - a.veces)
  }, [visitas])

  async function agregar(e: React.FormEvent) {
    e.preventDefault()
    const nombre = nuevo.trim()
    if (!nombre) return
    const { data: empresa } = await sb.rpc('vis_mi_empresa')
    const { error: err } = await sb.from('vis_productos').insert({ empresa_id: empresa!, nombre, orden: productos.length + 1 })
    if (err) return setError(err.code === '23505' ? 'Ese producto ya está.' : mensajeError(err))
    setNuevo('')
    void cargarProductos()
  }
  async function cambiar(p: Producto, cambios: Partial<Producto>) {
    const { error: err } = await sb.from('vis_productos').update(cambios).eq('id', p.id)
    if (err) setError(mensajeError(err))
    void cargarProductos()
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Productos y muestras</h1>
        <p className="text-sm text-tenue">Qué productos presentó la visitadora y cuántas muestras dejó, y la lista de productos que puede elegir en la visita.</p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Tarjeta className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Presentados en el período</h2>
            <Selector aria-label="Período" value={dias} onChange={(e) => setDias(e.target.value)} className="ml-auto w-auto">
              {PERIODOS.map((p) => <option key={p.dias} value={p.dias}>{p.texto}</option>)}
            </Selector>
            <Boton variante="secundario" disabled={!porProducto.length} onClick={() => descargarCsv(`muestras_${hoyIso()}`, [
              { titulo: 'Producto', valor: (f: (typeof porProducto)[number]) => f.producto },
              { titulo: 'Veces presentado', valor: (f: (typeof porProducto)[number]) => f.veces },
              { titulo: 'Médicos', valor: (f: (typeof porProducto)[number]) => f.medicos },
              { titulo: 'Muestras', valor: (f: (typeof porProducto)[number]) => f.muestras },
            ], porProducto)}>Excel</Boton>
          </div>
          {visitas === null ? <div className="h-32 animate-pulse rounded-lg bg-borde/40" /> : porProducto.length === 0 ? <p className="text-sm text-tenue">Sin visitas con productos en el período.</p> : (
            <table className="w-full text-sm tabular">
              <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
                <th className="py-1.5 font-medium">Producto</th><th className="py-1.5 text-right font-medium">Veces</th><th className="py-1.5 text-right font-medium">Médicos</th><th className="py-1.5 text-right font-medium">Muestras</th>
              </tr></thead>
              <tbody>{porProducto.map((f) => (
                <tr key={f.producto} className="border-b border-borde last:border-0"><td className="py-1.5">{f.producto}</td><td className="py-1.5 text-right">{f.veces}</td><td className="py-1.5 text-right">{f.medicos}</td><td className="py-1.5 text-right">{f.muestras}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Tarjeta>
        <Tarjeta className="flex h-fit flex-col gap-2">
          <h2 className="font-semibold">Lista de productos</h2>
          <p className="text-sm text-tenue">Llegan solos de Odoo: lo que facturó la empresa en 12 meses, primero lo más vendido. La visitadora los elige al registrar la visita.</p>
          <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
            {productos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 border-b border-borde py-1 last:border-0">
                <span className={cn('min-w-0 break-words', !p.activo && 'text-tenue line-through')}>{p.nombre}{p.codigo && <span className="text-xs text-tenue"> · {p.codigo}</span>}</span>
                {esAdmin && <button type="button" className="shrink-0 text-xs text-tenue underline" onClick={() => void cambiar(p, { activo: !p.activo })}>{p.activo ? 'Ocultar' : 'Volver a mostrar'}</button>}
              </li>
            ))}
            {productos.length === 0 && <li className="text-sm text-tenue">Todavía no hay productos.</li>}
          </ul>
          {esAdmin ? (
            <form onSubmit={agregar} className="flex gap-2">
              <Entrada aria-label="Nuevo producto" placeholder="Nombre del producto…" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
              <Boton type="submit" variante="secundario">Agregar</Boton>
            </form>
          ) : <p className="text-xs text-tenue">Los productos los carga un admin.</p>}
        </Tarjeta>
      </div>
    </div>
  )
}
