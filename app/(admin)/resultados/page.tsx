'use client'
// Resultados de visita: los desplegables que eligen el vendedor y la visitadora al registrar una visita.
// Resultado → Detalle → Observaciones (0044): el «Detalle» aparece en la app solo si la empresa cargó detalles.
// Los compartidos son de las dos empresas (solo un admin de ambas los renombra); cada empresa puede ocultarlos para
// ella y agregar los suyos, que ve solo ella. Nada se borra: lo que no se usa se oculta (las visitas no cambian).
import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff } from 'lucide-react'
import { Aviso, Boton, Entrada, Tarjeta } from '@/components/ui'
import { usePanel } from '@/components/admin/PanelModo'
import { supabaseNavegador } from '@/lib/supabase/client'
import { cn, mensajeError } from '@/lib/utils'
import type { ClaseResultado, Resultado, TipoUsuario } from '@/lib/database.types'

// Resultados que la app usa por el nombre: no se renombran ni se ocultan.
const FIJOS = new Set(['Cliente nuevo', 'No le interesa', 'No estaba / no atendió', 'Sin acceso', 'Ya no atiende acá', 'Pidió volver otro día', 'Otro motivo'])
type Error = { code?: string; message: string } | null

export default function Resultados() {
  const sb = supabaseNavegador()
  const { hayMedica, modo } = usePanel()
  const [lista, setLista] = useState<Resultado[] | null>(null)
  const [esAdmin, setEsAdmin] = useState(false)
  const [multi, setMulti] = useState(false)
  const [empresa, setEmpresa] = useState<string | null>(null)
  const [tipo, setTipo] = useState<TipoUsuario>(hayMedica && modo === 'medica' ? 'medica' : 'ventas')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error: e } = await sb.from('vis_resultados_v').select('*').order('orden').order('nombre')
    if (e) setError(mensajeError(e))
    setLista((data ?? []) as Resultado[])
  }, [sb])
  useEffect(() => {
    void cargar()
    void sb.rpc('vis_es_admin').then(({ data }) => setEsAdmin(!!data))
    void sb.rpc('vis_soy_admin_multi').then(({ data }) => setMulti(!!data))
    void sb.rpc('vis_mi_empresa').then(({ data }) => setEmpresa((data as string | null) ?? null))
  }, [sb, cargar])

  async function hacer(fn: () => PromiseLike<{ error: Error }>, msg?: string) {
    setOcupado(true); setError(null); setOk(null)
    const { error: e } = await fn()
    setOcupado(false)
    if (e) return setError(e.code === '23505' ? 'Ya hay uno con ese nombre en esta lista.' : mensajeError(e))
    if (msg) setOk(msg)
    void cargar()
  }

  const comun = { sb, tipo, esAdmin, multi, empresa, ocupado, hacer }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Resultados de visita</h1>
        <p className="text-sm text-tenue">
          Lo que se elige al registrar una visita: <b>Resultado → Detalle → Observaciones</b> (texto libre, si hace falta más información).
          Lo que agrega tu empresa lo ve solo tu empresa; los «compartidos» son de las dos y los podés ocultar para tu empresa.
        </p>
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

      {lista === null ? <div className="h-40 animate-pulse rounded-xl bg-borde/40" /> : (
        <>
          <Lista {...comun} clase="resultado" filas={ordenar(lista.filter((r) => r.tipo === tipo && (r.clase ?? 'resultado') === 'resultado' && r.nombre !== 'Cliente nuevo'), empresa)} />
          <Lista {...comun} clase="detalle" filas={ordenar(lista.filter((r) => r.tipo === tipo && r.clase === 'detalle'), empresa)} />
        </>
      )}
      <p className="text-xs text-tenue">La app toma los cambios la próxima vez que se abre con señal. Los compartidos los renombra solo un admin de las dos empresas; los de «no lo vio» de visita médica no se renombran ni se ocultan porque la app los usa para el plan del día y los tableros.</p>
    </div>
  )
}

// Como en la app (por orden), con lo que tu empresa no ve al final.
const ordenar = (filas: Resultado[], empresa: string | null) => {
  const oculto = (r: Resultado) => (r.empresa_id && r.empresa_id === empresa ? !r.activo : !r.activo || !!r.oculto)
  return [...filas].sort((a, b) => Number(oculto(a)) - Number(oculto(b)) || a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'))
}

function Lista({ sb, tipo, clase, filas, esAdmin, multi, empresa, ocupado, hacer }: {
  sb: ReturnType<typeof supabaseNavegador>; tipo: TipoUsuario; clase: ClaseResultado; filas: Resultado[]
  esAdmin: boolean; multi: boolean; empresa: string | null; ocupado: boolean
  hacer: (fn: () => PromiseLike<{ error: Error }>, msg?: string) => Promise<void>
}) {
  const [nuevo, setNuevo] = useState({ nombre: '', es_venta: false })
  const propio = (r: Resultado) => !!r.empresa_id && r.empresa_id === empresa
  const titulo = clase === 'resultado' ? 'Resultado' : 'Detalle'
  const propios = filas.filter(propio)

  function agregar(e: React.FormEvent) {
    e.preventDefault()
    const nombre = nuevo.nombre.trim()
    if (!nombre || !empresa) return
    const orden = Math.max(0, ...filas.filter((r) => r.orden < 90).map((r) => r.orden)) + 1
    void hacer(() => sb.from('vis_resultados').insert({ nombre, tipo, clase, es_venta: tipo === 'ventas' && nuevo.es_venta, orden, empresa_id: empresa }),
      `«${nombre}» se agregó a «${titulo}». La app lo muestra la próxima vez que se abre con señal.`)
    setNuevo({ nombre: '', es_venta: false })
  }

  // Subir o bajar uno propio: se reordenan los propios entre ellos, sin tocar los compartidos.
  function mover(r: Resultado, delta: number) {
    const i = propios.findIndex((x) => x.id === r.id)
    const otro = propios[i + delta]
    if (!otro) return
    const nuevos = [...propios]
    nuevos[i] = otro; nuevos[i + delta] = r
    const valores = propios.map((x) => x.orden).sort((a, b) => a - b)
    for (let k = 1; k < valores.length; k++) if (valores[k]! <= valores[k - 1]!) valores[k] = valores[k - 1]! + 1
    void hacer(async () => {
      for (const [k, x] of nuevos.entries()) {
        if (x.orden === valores[k]) continue
        const res = await sb.from('vis_resultados').update({ orden: valores[k]! }).eq('id', x.id)
        if (res.error) return res
      }
      return { error: null }
    })
  }

  function renombrar(r: Resultado, nombre: string) {
    const n = nombre.trim()
    if (!n || n === r.nombre) return
    void hacer(() => sb.from('vis_resultados').update({ nombre: n }).eq('id', r.id), `Se cambió a «${n}». Las visitas que ya lo tenían lo muestran con el nombre nuevo.`)
  }

  function mostrarOcultar(r: Resultado) {
    const visible = propio(r) ? r.activo : !r.oculto
    const msg = visible ? `«${r.nombre}» ya no sale en la lista de tu empresa (las visitas que lo tienen no cambian).` : `«${r.nombre}» vuelve a salir en la lista.`
    if (propio(r)) return void hacer(() => sb.from('vis_resultados').update({ activo: !r.activo }).eq('id', r.id), msg)
    if (!empresa) return
    void hacer(() => (r.oculto
      ? sb.from('vis_resultados_ocultos').delete().eq('empresa_id', empresa).eq('resultado_id', r.id)
      : sb.from('vis_resultados_ocultos').insert({ empresa_id: empresa, resultado_id: r.id })), msg)
  }

  if (clase === 'detalle' && !filas.length && !esAdmin) return null
  return (
    <Tarjeta className="flex flex-col gap-3 p-0">
      <div className="px-4 pt-4">
        <h2 className="font-semibold">{clase === 'resultado' ? '1. Resultado' : '2. Detalle'}</h2>
        <p className="text-sm text-tenue">{clase === 'resultado'
          ? 'El primer desplegable: qué tipo de visita fue.'
          : filas.length ? 'El segundo desplegable, debajo del resultado: qué pasó en concreto.' : 'Si cargás detalles, la app muestra un segundo desplegable debajo del resultado. Sin detalles no aparece.'}</p>
      </div>
      {esAdmin && (
        <form onSubmit={agregar} className="flex flex-wrap items-end gap-3 px-4">
          <Entrada aria-label={`Agregar ${titulo.toLowerCase()}`} className="min-w-64 flex-1" autoComplete="off" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            placeholder={clase === 'resultado' ? (tipo === 'ventas' ? 'Agregar resultado (ej.: Rutina, Seguimiento…)' : 'Agregar resultado (ej.: Pidió más muestras…)') : 'Agregar detalle (ej.: Propuesta enviada, Promociones…)'} />
          {tipo === 'ventas' && (
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--c-marca)]" checked={nuevo.es_venta} onChange={(e) => setNuevo({ ...nuevo, es_venta: e.target.checked })} /> Cuenta como venta
            </label>
          )}
          <Boton type="submit" disabled={ocupado || !nuevo.nombre.trim()}>Agregar</Boton>
        </form>
      )}
      {filas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-y border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="w-20 px-3 py-2 font-medium">Orden</th><th className="px-2 py-2 font-medium">{titulo}</th>
              {tipo === 'ventas' && <th className="px-2 py-2 font-medium">Cuenta como venta</th>}
              <th className="px-2 py-2 font-medium">De</th><th className="px-2 py-2 font-medium">En la app</th>
            </tr></thead>
            <tbody>
              {filas.map((r) => {
                const mio = propio(r)
                const editable = esAdmin && (mio || (!r.empresa_id && multi))
                const fijo = FIJOS.has(r.nombre)
                const visible = mio ? r.activo : r.activo && !r.oculto
                const j = propios.findIndex((x) => x.id === r.id)
                return (
                  <tr key={r.id} className={cn('border-b border-borde last:border-0', !visible && 'text-tenue')}>
                    <td className="px-3 py-1.5">
                      {mio && esAdmin ? (
                        <div className="flex">
                          <button type="button" aria-label={`Subir ${r.nombre}`} disabled={ocupado || j === 0} onClick={() => mover(r, -1)} className="grid size-8 place-items-center rounded-lg hover:bg-fondo disabled:opacity-30"><ArrowUp className="size-4" aria-hidden /></button>
                          <button type="button" aria-label={`Bajar ${r.nombre}`} disabled={ocupado || j === propios.length - 1} onClick={() => mover(r, 1)} className="grid size-8 place-items-center rounded-lg hover:bg-fondo disabled:opacity-30"><ArrowDown className="size-4" aria-hidden /></button>
                        </div>
                      ) : null}
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
                    <td className="px-2 py-1.5">{mio ? 'Tu empresa' : <span className="text-tenue">Compartido</span>}</td>
                    <td className="px-2 py-1.5">
                      {esAdmin && !fijo && (mio || r.activo) ? (
                        <Boton variante="secundario" className="min-h-8 px-2.5 text-sm" disabled={ocupado} onClick={() => mostrarOcultar(r)}>
                          {visible ? <><Eye className="size-4" aria-hidden /> Se muestra</> : <><EyeOff className="size-4" aria-hidden /> Oculto</>}
                        </Boton>
                      ) : <span>{visible ? 'Se muestra' : 'Oculto'}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="pb-1" />
    </Tarjeta>
  )
}
