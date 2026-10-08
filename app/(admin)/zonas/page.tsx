'use client'
// Zonas (BRIEF §6 supervisor 5): nombre, color, ciudades, semana del mes en que se visita y
// vendedor responsable. Los clientes toman la zona por su ciudad. Polígonos: Fase 2.
import { useCallback, useEffect, useState } from 'react'
import { AreaTexto, Aviso, Boton, Entrada, Etiqueta, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { ORDINAL_SEMANA } from '@/lib/fechas'
import { cn, mensajeError } from '@/lib/utils'
import type { Vendedor, Zona } from '@/lib/database.types'

type ZonaConConteo = Zona & { clientes: { count: number }[] }
const lista = (texto: string) => [...new Set(texto.split(/[,\n]/).map((c) => c.trim()).filter(Boolean))]
const COLORES = ['#16a34a', '#2563eb', '#d97706', '#dc2626', '#0891b2', '#9333ea', '#be185d', '#4d7c0f']

export default function Zonas() {
  const sb = supabaseNavegador()
  const [zonas, setZonas] = useState<ZonaConConteo[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await sb.from('vis_zonas').select('*, clientes:vis_clientes(count)').order('nombre')
    if (error) setError(mensajeError(error))
    else setZonas((data ?? []) as unknown as ZonaConConteo[])
  }, [sb])
  useEffect(() => {
    void cargar()
    sb.from('vis_vendedores').select('*').eq('activo', true).order('nombre').then(({ data }) => setVendedores(data ?? []))
  }, [cargar, sb])

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    const { error } = await sb.from('vis_zonas').insert({ nombre: nombre.trim(), color: COLORES[zonas.length % COLORES.length] })
    if (error) return setError(error.code === '23505' ? 'Ya existe una zona con ese nombre.' : mensajeError(error))
    setNombre('')
    setError(null)
    void cargar()
  }

  async function asignarPorCiudad() {
    const { data, error } = await sb.rpc('vis_asignar_zonas_por_ciudad')
    if (error) return setError(mensajeError(error))
    setOk(data ? `${data} cliente${data === 1 ? '' : 's'} sin zona recibieron la de su ciudad.` : 'No había clientes sin zona con una ciudad conocida.')
    void cargar()
  }

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Zonas</h1>
        <Boton variante="secundario" onClick={() => void asignarPorCiudad()}>Asignar clientes sin zona por ciudad</Boton>
      </div>
      <p className="text-sm text-tenue">
        Un cliente nuevo toma la zona de su ciudad. Si la ciudad está en dos zonas (Asunción, que se reparte por quincena) queda sin zona
        y se asigna a mano desde Clientes.
      </p>
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}

      {zonas.length === 0 ? <Vacio titulo="Sin zonas" /> : (
        <ul className="flex flex-col gap-3">
          {zonas.map((z) => <FilaZona key={z.id} zona={z} vendedores={vendedores} alGuardar={(m) => { setOk(m); setError(null); void cargar() }} alFallar={setError} />)}
        </ul>
      )}

      <Tarjeta>
        <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <Etiqueta htmlFor="z-nombre">Nueva zona</Etiqueta>
            <Entrada id="z-nombre" placeholder="Zona Oeste…" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <Boton type="submit">Agregar</Boton>
        </form>
      </Tarjeta>
    </div>
  )
}

function FilaZona({ zona: z, vendedores, alGuardar, alFallar }: { zona: ZonaConConteo; vendedores: Vendedor[]; alGuardar: (m: string) => void; alFallar: (m: string) => void }) {
  const sb = supabaseNavegador()
  const [f, setF] = useState({
    nombre: z.nombre, color: z.color, frecuencia: z.frecuencia ?? '', semanas: new Set(z.semanas_mes), vendedor_id: z.vendedor_id ?? '',
    ciudades: z.ciudades.join(', '), alias: z.ciudades_alias.join(', '), activo: z.activo,
  })
  const [abierta, setAbierta] = useState(false)
  const responsable = vendedores.find((v) => v.id === z.vendedor_id)?.nombre ?? z.responsable

  async function guardar() {
    const { error } = await sb.from('vis_zonas').update({
      nombre: f.nombre.trim(), color: f.color, frecuencia: f.frecuencia.trim() || null, semanas_mes: [...f.semanas].sort(),
      vendedor_id: f.vendedor_id || null, activo: f.activo,
      ciudades: lista(f.ciudades), ciudades_alias: lista(f.alias),
    }).eq('id', z.id)
    if (error) alFallar(error.code === '23505' ? 'Ya existe una zona con ese nombre.' : mensajeError(error))
    else { setAbierta(false); alGuardar(`${f.nombre} guardada.`) }
  }

  return (
    <li>
      <Tarjeta className={cn('p-0', !z.activo && 'opacity-60')}>
        <button type="button" onClick={() => setAbierta((a) => !a)} aria-expanded={abierta} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left">
          <span className="size-4 shrink-0 rounded-full" style={{ background: z.color }} aria-hidden />
          <span className="font-semibold">{z.nombre}</span>
          <span className="text-sm text-tenue">{z.frecuencia ?? (z.semanas_mes.length ? z.semanas_mes.map((n) => ORDINAL_SEMANA[n]).join(' y ') + ' semana' : 'sin frecuencia')}</span>
          <span className="text-sm text-tenue">· {responsable ?? 'sin vendedor'}</span>
          <span className="ml-auto text-sm text-tenue tabular">{z.clientes[0]?.count ?? 0} clientes · {z.ciudades.length} ciudades</span>
        </button>
        {!abierta && z.ciudades.length > 0 && <p className="px-4 pb-3 text-sm text-tenue">{z.ciudades.join(', ')}</p>}
        {abierta && (
          <div className="grid gap-3 border-t border-borde px-4 py-4 md:grid-cols-2">
            <div><Etiqueta htmlFor={`n-${z.id}`}>Nombre</Etiqueta><Entrada id={`n-${z.id}`} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
            <div className="flex items-end gap-3">
              <div><Etiqueta htmlFor={`c-${z.id}`}>Color</Etiqueta><input id={`c-${z.id}`} type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 w-14 cursor-pointer rounded border border-borde bg-transparent" /></div>
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Activa</label>
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium">Semana del mes en que se visita</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-pressed={f.semanas.has(n)} onClick={() => setF((x) => { const s = new Set(x.semanas); if (s.has(n)) s.delete(n); else s.add(n); return { ...x, semanas: s } })}
                    className={cn('rounded-md border px-3 py-1.5 text-sm font-medium', f.semanas.has(n) ? 'border-marca bg-marca text-white' : 'border-borde')}>{ORDINAL_SEMANA[n]}</button>
                ))}
              </div>
            </div>
            <div><Etiqueta htmlFor={`f-${z.id}`}>Frecuencia (texto)</Etiqueta><Entrada id={`f-${z.id}`} value={f.frecuencia} placeholder="3ra semana, cada 15 días…" onChange={(e) => setF({ ...f, frecuencia: e.target.value })} /></div>
            <div>
              <Etiqueta htmlFor={`v-${z.id}`}>Vendedor</Etiqueta>
              <Selector id={`v-${z.id}`} value={f.vendedor_id} onChange={(e) => setF({ ...f, vendedor_id: e.target.value })}>
                <option value="">{z.responsable ? `${z.responsable} (todavía sin acceso a la app)` : 'Sin asignar'}</option>
                {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </Selector>
            </div>
            <div className="md:col-span-2">
              <Etiqueta htmlFor={`ci-${z.id}`}>Ciudades (separadas por coma; son las que el vendedor elige al dar de alta un cliente)</Etiqueta>
              <AreaTexto id={`ci-${z.id}`} value={f.ciudades} onChange={(e) => setF({ ...f, ciudades: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Etiqueta htmlFor={`al-${z.id}`}>Otras formas de escribirlas (“CDE”, “Fdo de la Mora”): reconocen la zona pero no salen en la lista</Etiqueta>
              <Entrada id={`al-${z.id}`} value={f.alias} onChange={(e) => setF({ ...f, alias: e.target.value })} />
            </div>
            <div className="flex gap-2 md:col-span-2">
              <Boton onClick={() => void guardar()}>Guardar</Boton>
              <Boton variante="secundario" onClick={() => setAbierta(false)}>Cancelar</Boton>
            </div>
          </div>
        )}
      </Tarjeta>
    </li>
  )
}
