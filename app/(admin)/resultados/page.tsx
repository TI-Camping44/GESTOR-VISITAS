'use client'
// Resultados de visita: la lista desplegable que eligen el vendedor y la visitadora al registrar una visita.
// Los de siempre son compartidos por las dos empresas (solo un admin de ambas los cambia); cada empresa
// agrega los suyos, que ve solo ella. Nada se borra: un resultado que no se usa más se oculta (las visitas que lo
// tienen lo siguen mostrando).
import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff } from 'lucide-react'
import { Aviso, Boton, Entrada, Tarjeta } from '@/components/ui'
import { usePanel } from '@/components/admin/PanelModo'
import { supabaseNavegador } from '@/lib/supabase/client'
import { cn, mensajeError } from '@/lib/utils'
import type { Resultado, TipoUsuario } from '@/lib/database.types'

// Resultados que la app usa por el nombre: no se pueden renombrar ni ocultar.
const FIJOS = new Set(['Cliente nuevo', 'No le interesa', 'No estaba / no atendió', 'Sin acceso', 'Ya no atiende acá', 'Pidió volver otro día', 'Otro motivo', 'Otro'])

export default function Resultados() {
  const sb = supabaseNavegador()
  const { hayMedica, modo } = usePanel()
  const [lista, setLista] = useState<Resultado[] | null>(null)
  const [esAdmin, setEsAdmin] = useState(false)
  const [multi, setMulti] = useState(false)
  const [empresa, setEmpresa] = useState<string | null>(null)
  const [tipo, setTipo] = useState<TipoUsuario>(hayMedica && modo === 'medica' ? 'medica' : 'ventas')
  const [nuevo, setNuevo] = useState({ nombre: '', es_venta: false })
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error: e } = await sb.from('vis_resultados').select('*').order('orden').order('nombre')
    if (e) setError(mensajeError(e))
    setLista((data ?? []) as Resultado[])
  }, [sb])
  useEffect(() => {
    void cargar()
    void sb.rpc('vis_es_admin').then(({ data }) => setEsAdmin(!!data))
    void sb.rpc('vis_soy_admin_multi').then(({ data }) => setMulti(!!data))
    void sb.rpc('vis_mi_empresa').then(({ data }) => setEmpresa((data as string | null) ?? null))
  }, [sb, cargar])

  const delTipo = (lista ?? []).filter((r) => r.tipo === tipo && r.nombre !== 'Cliente nuevo')
  const puedeEditar = (r: Resultado) => esAdmin && (r.empresa_id ? r.empresa_id === empresa : multi)

  async function hacer(fn: () => PromiseLike<{ error: { code?: string; message: string } | null }>, msg?: string) {
    setOcupado(true); setError(null); setOk(null)
    const { error: e } = await fn()
    setOcupado(false)
    if (e) return setError(e.code === '23505' ? 'Ya hay un resultado con ese nombre.' : mensajeError(e))
    if (msg) setOk(msg)
    void cargar()
  }

  function agregar(e: React.FormEvent) {
    e.preventDefault()
    const nombre = nuevo.nombre.trim()
    if (!nombre || !empresa) return
    // Va antes de «Otro» / «Otro motivo», que quedan al final.
    const orden = Math.max(0, ...delTipo.filter((r) => r.orden < 90).map((r) => r.orden)) + 1
    void hacer(() => sb.from('vis_resultados').insert({ nombre, tipo, es_venta: tipo === 'ventas' && nuevo.es_venta, orden, empresa_id: empresa }),
      `«${nombre}» ya aparece en la lista de la app. Si alguien tiene la app abierta, le aparece al volver a entrar con señal.`)
    setNuevo({ nombre: '', es_venta: false })
  }

  // Subir o bajar: intercambia el orden con el de al lado (se renumera la lista para que no haya empates).
  function mover(i: number, delta: number) {
    const a = delTipo[i], b = delTipo[i + delta]
    if (!a || !b) return
    void hacer(async () => {
      const r1 = await sb.from('vis_resultados').update({ orden: b.orden === a.orden ? a.orden + delta : b.orden }).eq('id', a.id)
      if (r1.error) return r1
      return sb.from('vis_resultados').update({ orden: a.orden }).eq('id', b.id)
    })
  }

  function renombrar(r: Resultado, nombre: string) {
    const n = nombre.trim()
    if (!n || n === r.nombre) return
    void hacer(() => sb.from('vis_resultados').update({ nombre: n }).eq('id', r.id), `Se cambió a «${n}». Las visitas que ya lo tenían también lo muestran con el nombre nuevo.`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Resultados de visita</h1>
        <p className="text-sm text-tenue">La lista desplegable «Resultado» que se elige al registrar una visita. Los que agrega tu empresa los ve solo tu empresa; los «compartidos» son de las dos.</p>
      </div>
      {!esAdmin && lista && <Aviso tipo="info">Solo un admin agrega o cambia resultados.</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}

      {hayMedica && (
        <div role="tablist" aria-label="Tipo de visita" className="flex gap-1">
          {([['ventas', 'Visita de venta'], ['medica', 'Visita médica']] as const).map(([t, texto]) => (
            <button key={t} type="button" role="tab" aria-selected={tipo === t} onClick={() => setTipo(t)}
              className={cn('rounded-lg border px-3 py-1.5 text-sm font-medium', tipo === t ? 'border-marca bg-marca text-sobre-marca' : 'border-borde hover:border-marca')}>{texto}</button>
          ))}
        </div>
      )}

      {esAdmin && (
        <Tarjeta>
          <form onSubmit={agregar} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label htmlFor="nuevo-resultado" className="mb-1 block text-sm font-medium">Agregar resultado</label>
              <Entrada id="nuevo-resultado" placeholder={tipo === 'ventas' ? 'Ej.: Pidió catálogo, Pide visita del gerente…' : 'Ej.: Pidió más muestras…'}
                value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} autoComplete="off" />
            </div>
            {tipo === 'ventas' && (
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--c-marca)]" checked={nuevo.es_venta} onChange={(e) => setNuevo({ ...nuevo, es_venta: e.target.checked })} /> Cuenta como venta
              </label>
            )}
            <Boton type="submit" disabled={ocupado || !nuevo.nombre.trim()}>Agregar</Boton>
          </form>
        </Tarjeta>
      )}

      <Tarjeta className="overflow-x-auto p-0">
        {lista === null ? <div className="m-4 h-32 animate-pulse rounded-xl bg-borde/40" /> : (
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="w-20 px-3 py-2 font-medium">Orden</th><th className="px-2 py-2 font-medium">Resultado</th>
              {tipo === 'ventas' && <th className="px-2 py-2 font-medium">Cuenta como venta</th>}
              <th className="px-2 py-2 font-medium">De</th><th className="px-2 py-2 font-medium">En la app</th>
            </tr></thead>
            <tbody>
              {delTipo.map((r, i) => {
                const editable = puedeEditar(r)
                const fijo = FIJOS.has(r.nombre)
                return (
                  <tr key={r.id} className={cn('border-b border-borde last:border-0', !r.activo && 'text-tenue')}>
                    <td className="px-3 py-1.5">
                      <div className="flex">
                        <button type="button" aria-label={`Subir ${r.nombre}`} disabled={!editable || ocupado || i === 0} onClick={() => mover(i, -1)} className="grid size-8 place-items-center rounded-lg hover:bg-fondo disabled:opacity-30"><ArrowUp className="size-4" aria-hidden /></button>
                        <button type="button" aria-label={`Bajar ${r.nombre}`} disabled={!editable || ocupado || i === delTipo.length - 1} onClick={() => mover(i, 1)} className="grid size-8 place-items-center rounded-lg hover:bg-fondo disabled:opacity-30"><ArrowDown className="size-4" aria-hidden /></button>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      {editable && !fijo ? (
                        <Entrada aria-label={`Nombre de ${r.nombre}`} defaultValue={r.nombre} key={r.nombre} className="py-1.5" disabled={ocupado}
                          onBlur={(e) => renombrar(r, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                      ) : <span className="font-medium">{r.nombre}</span>}
                    </td>
                    {tipo === 'ventas' && (
                      <td className="px-2 py-1.5">
                        <input type="checkbox" aria-label={`${r.nombre} cuenta como venta`} className="size-4 accent-[var(--c-marca)]" checked={r.es_venta} disabled={!editable || ocupado}
                          onChange={(e) => void hacer(() => sb.from('vis_resultados').update({ es_venta: e.target.checked }).eq('id', r.id))} />
                      </td>
                    )}
                    <td className="px-2 py-1.5">{r.empresa_id ? 'Tu empresa' : <span className="text-tenue">Compartido</span>}</td>
                    <td className="px-2 py-1.5">
                      {editable && !fijo ? (
                        <Boton variante="secundario" className="min-h-8 px-2.5 text-sm" disabled={ocupado}
                          onClick={() => void hacer(() => sb.from('vis_resultados').update({ activo: !r.activo }).eq('id', r.id), r.activo ? `«${r.nombre}» ya no sale en la lista (las visitas que lo tienen no cambian).` : `«${r.nombre}» vuelve a salir en la lista.`)}>
                          {r.activo ? <><Eye className="size-4" aria-hidden /> Se muestra</> : <><EyeOff className="size-4" aria-hidden /> Oculto</>}
                        </Boton>
                      ) : <span className={r.activo ? '' : 'text-tenue'}>{r.activo ? 'Se muestra' : 'Oculto'}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Tarjeta>
      <p className="text-xs text-tenue">Los compartidos los cambia solo un admin de las dos empresas. «Otro», «No le interesa» y los de «no lo vio» de visita médica no se renombran ni se ocultan: la app los usa para los avisos y los tableros.</p>
    </div>
  )
}
