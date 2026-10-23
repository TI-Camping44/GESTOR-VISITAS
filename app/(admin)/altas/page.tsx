'use client'
// Altas a revisar: clientes que un vendedor dio de alta en la zona de otro vendedor o a menos de
// 300 m de clientes de otro vendedor (0019). El supervisor lo pasa al otro vendedor o lo deja.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Boton, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtFecha, fmtFechaHora } from '@/lib/fechas'
import { fmtDistancia } from '@/lib/geo'
import { cn, mensajeError } from '@/lib/utils'
import type { Database } from '@/lib/database.types'

type Alerta = Database['public']['Tables']['vis_alertas_alta']['Row']
type Cliente = { id: string; razon_social: string; ciudad: string | null; vendedor_id: string | null; lat: number | null; lng: number | null }

export default function Altas() {
  const sb = supabaseNavegador()
  const router = useRouter()
  const [vista, setVista] = useState<'pendientes' | 'revisadas'>('pendientes')
  const [alertas, setAlertas] = useState<Alerta[] | null>(null)
  const [clientes, setClientes] = useState<Map<string, Cliente>>(new Map())
  const [zonas, setZonas] = useState<Map<string, string>>(new Map())
  const [vendedores, setVendedores] = useState<Map<string, string>>(new Map())
  const [ocupado, setOcupado] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    let q = sb.from('vis_alertas_alta').select('*').order('creada_el', { ascending: false }).limit(200)
    q = vista === 'pendientes' ? q.is('revisada_el', null) : q.not('revisada_el', 'is', null)
    const { data, error } = await q
    if (error) { setError(mensajeError(error)); return }
    const lista = (data ?? []) as Alerta[]
    setAlertas(lista)
    const ids = [...new Set(lista.map((a) => a.cliente_id))]
    const zs = [...new Set(lista.map((a) => a.zona_id).filter((x): x is string => !!x))]
    const [c, z] = await Promise.all([
      ids.length ? sb.from('vis_clientes').select('id, razon_social, ciudad, vendedor_id, lat, lng').in('id', ids) : Promise.resolve({ data: [] }),
      zs.length ? sb.from('vis_zonas').select('id, nombre').in('id', zs) : Promise.resolve({ data: [] }),
    ])
    setClientes(new Map(((c.data ?? []) as Cliente[]).map((x) => [x.id, x])))
    setZonas(new Map(((z.data ?? []) as { id: string; nombre: string }[]).map((x) => [x.id, x.nombre])))
  }, [sb, vista])

  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => {
    sb.from('vis_vendedores').select('id, nombre').then(({ data }) => setVendedores(new Map((data ?? []).map((v) => [v.id, v.nombre]))))
  }, [sb])
  const nombre = useCallback((id: string | null | undefined, respaldo = 'otro vendedor') => (id ? vendedores.get(id) ?? respaldo : respaldo), [vendedores])

  async function resolver(a: Alerta, pasarA: string | null) {
    setOcupado(a.id); setError(null); setOk(null)
    try {
      const c = clientes.get(a.cliente_id)
      if (pasarA) {
        const { error } = await sb.from('vis_clientes').update({ vendedor_id: pasarA }).eq('id', a.cliente_id)
        if (error) throw error
      }
      const { data: yo } = await sb.rpc('vis_mi_id')
      const { error } = await sb.from('vis_alertas_alta').update({ revisada_el: new Date().toISOString(), revisada_por: yo, decision: pasarA ? 'pasado' : 'queda' }).eq('id', a.id)
      if (error) throw error
      setOk(pasarA ? `${c?.razon_social ?? 'El cliente'} pasó a ${nombre(pasarA)}.` : `${c?.razon_social ?? 'El cliente'} queda con ${nombre(c?.vendedor_id ?? a.vendedor_id)}.`)
      void cargar()
      router.refresh() // franja y contador del menú
    } catch (e) {
      setError(mensajeError(e))
    } finally {
      setOcupado(null)
    }
  }

  const pestana = (activa: boolean) => cn('rounded-lg px-3 py-1.5 text-sm font-medium', activa ? 'bg-superficie text-tinta shadow-sm' : 'text-tenue')
  const pendientes = useMemo(() => (vista === 'pendientes' ? alertas?.length ?? 0 : null), [alertas, vista])

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Altas a revisar</h1>
      <p className="text-sm text-tenue">
        Clientes que un vendedor dio de alta en la zona de otro vendedor, o a menos de 300 m de clientes de otro vendedor.
        Decidí si lo pasás al otro vendedor o si queda con quien lo cargó. La visita del alta queda siempre a nombre de quien la hizo.
      </p>
      <div className="flex w-fit rounded-xl bg-fondo p-1 ring-1 ring-borde" role="tablist">
        <button role="tab" aria-selected={vista === 'pendientes'} className={pestana(vista === 'pendientes')} onClick={() => setVista('pendientes')}>Pendientes{pendientes ? ` (${pendientes})` : ''}</button>
        <button role="tab" aria-selected={vista === 'revisadas'} className={pestana(vista === 'revisadas')} onClick={() => setVista('revisadas')}>Revisadas</button>
      </div>
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {alertas && alertas.length === 0 && <Vacio titulo={vista === 'pendientes' ? 'No hay altas para revisar' : 'Todavía no se revisó ninguna'} />}

      {alertas?.map((a) => {
        const c = clientes.get(a.cliente_id)
        const actual = c?.vendedor_id ?? a.vendedor_id
        // A quién se lo puede pasar: el dueño de la zona y los vendedores de los clientes cercanos.
        const opciones = [...new Set([a.dueno_zona_id, ...a.vecinos.map((v) => v.vendedor_id)].filter((x): x is string => !!x && x !== actual))]
        return (
          <Tarjeta key={a.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{c?.razon_social ?? 'Cliente'} <span className="font-normal text-tenue">· {c?.ciudad ?? 'sin ciudad'}</span></p>
              <p className="text-xs text-tenue">{fmtFechaHora(a.creada_el)}</p>
            </div>
            <p className="text-sm">Lo dio de alta <b>{nombre(a.vendedor_id)}</b>{actual !== a.vendedor_id && <> · hoy es de <b>{nombre(actual)}</b></>}.</p>
            {a.dueno_zona_id && <p className="text-sm">Está en la zona <b>{a.zona_id ? zonas.get(a.zona_id) ?? '—' : '—'}</b>, que trabaja <b>{nombre(a.dueno_zona_id)}</b>.</p>}
            {a.vecinos.length > 0 && (
              <div className="text-sm">
                <p>Clientes de otros vendedores cerca:</p>
                <ul className="ml-4 list-disc text-tenue">
                  {a.vecinos.map((v) => <li key={v.cliente_id}>{v.razon_social} — {v.vendedor}, a {fmtDistancia(v.distancia_m)}</li>)}
                </ul>
              </div>
            )}
            {c?.lat != null && c.lng != null && (
              <a href={`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`} target="_blank" rel="noreferrer" className="w-fit text-sm font-medium text-marca underline">Ver en el mapa</a>
            )}
            {vista === 'pendientes' ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {opciones.map((v) => (
                  <Boton key={v} disabled={ocupado === a.id} onClick={() => void resolver(a, v)}>Pasar a {nombre(v)}</Boton>
                ))}
                <Boton variante="secundario" disabled={ocupado === a.id} onClick={() => void resolver(a, null)}>Dejar con {nombre(actual)}</Boton>
              </div>
            ) : (
              <p className="text-xs text-tenue">
                {a.decision === 'pasado' ? `Pasado a ${nombre(actual)}` : `Quedó con ${nombre(actual)}`} · revisado por {nombre(a.revisada_por, '—')} el {fmtFecha(a.revisada_el)}
              </p>
            )}
          </Tarjeta>
        )
      })}
    </div>
  )
}
