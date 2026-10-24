'use client'
// Mis clientes en lista (pedido de los comerciales): toda la cartera del vendedor, también los que
// no tienen ubicación (no salen en el mapa). Con señal, de la base; sin señal, la guardada.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { MessageCircle, Navigation, Phone, Search } from 'lucide-react'
import { useVendedor } from '@/components/vendedor/Proveedor'
import { Aviso, Entrada, PuntoEstado, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { guardarCache, leerCache } from '@/lib/offline/db'
import { fmtFecha, fmtGuaranies, hace } from '@/lib/fechas'
import { ETIQUETA_ESTADO, COLOR_ESTADO } from '@/lib/config'
import { cn, linkTel, linkWhatsApp } from '@/lib/utils'
import { urlVisita } from '@/lib/rutas'
import type { EstadoCliente } from '@/lib/database.types'

export type ClienteCartera = {
  id: string; razon_social: string; ciudad: string | null; direccion: string | null; lat: number | null; lng: number | null
  estado: EstadoCliente; telefono?: string | null; telefono_norm?: string | null; ruc?: string | null
  ultima_visita?: string | null; ultima_factura_fecha?: string | null; ventas_6m_gs?: number | null
}
type Orden = 'visita' | 'compras' | 'nombre'
const ESTADOS: EstadoCliente[] = ['activo', 'potencial', 'inactivo']
const CAMPOS = 'id, razon_social, ciudad, direccion, lat, lng, estado, telefono, telefono_norm, ruc, ultima_visita, ultima_factura_fecha, ventas_6m_gs'
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const POR_PAGINA = 60

export function ListaClientes() {
  const { perfil } = useVendedor()
  const [clientes, setClientes] = useState<ClienteCartera[] | null>(null)
  const [sinSenal, setSinSenal] = useState(false)
  const [q, setQ] = useState('')
  const [estados, setEstados] = useState<Set<EstadoCliente>>(new Set(ESTADOS))
  const [orden, setOrden] = useState<Orden>('visita')
  const [mostrar, setMostrar] = useState(POR_PAGINA)
  const clave = `cartera:${perfil.id}`

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const cache = await leerCache<ClienteCartera[]>(clave).catch(() => null)
      if (cache && vivo) setClientes(cache.datos)
      const { data, error } = await supabaseNavegador().from('vis_clientes_v').select(CAMPOS).eq('vendedor_id', perfil.id).limit(3000)
      if (!vivo) return
      if (error || !data) { setSinSenal(true); if (!cache) setClientes([]); return }
      setClientes(data as ClienteCartera[])
      setSinSenal(false)
      void guardarCache(clave, data).catch(() => {})
    })()
    return () => { vivo = false }
  }, [clave, perfil.id])

  const lista = useMemo(() => {
    const n = normal(q.trim())
    const filtrados = (clientes ?? []).filter((c) => estados.has(c.estado)
      && (!n || normal(`${c.razon_social} ${c.ciudad ?? ''} ${c.ruc ?? ''}`).includes(n)))
    const porVisita = (c: ClienteCartera) => c.ultima_visita ?? '' // nunca visitados primero
    return filtrados.sort((a, b) =>
      orden === 'compras' ? Number(b.ventas_6m_gs ?? 0) - Number(a.ventas_6m_gs ?? 0)
      : orden === 'nombre' ? a.razon_social.localeCompare(b.razon_social, 'es')
      : porVisita(a).localeCompare(porVisita(b)))
  }, [clientes, q, estados, orden])

  const conteo = useMemo(() => Object.fromEntries(ESTADOS.map((e) => [e, (clientes ?? []).filter((c) => c.estado === e).length])), [clientes])
  const alternar = (e: EstadoCliente) => setEstados((s) => { const n = new Set(s); if (n.has(e)) n.delete(e); else n.add(e); return n })

  if (!clientes) return <p className="text-sm text-tenue">Cargando tus clientes…</p>

  return (
    <div className="flex flex-col gap-3">
      {sinSenal && <Aviso tipo="info">Sin señal: mostrando tus clientes guardados en el celular.</Aviso>}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
        <Entrada value={q} onChange={(e) => { setQ(e.target.value); setMostrar(POR_PAGINA) }} placeholder="Buscar por nombre, ciudad o RUC" className="pl-9" aria-label="Buscar cliente" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ESTADOS.map((e) => (
          <button key={e} type="button" onClick={() => alternar(e)} aria-pressed={estados.has(e)}
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm', estados.has(e) ? 'border-borde bg-superficie' : 'border-transparent bg-fondo opacity-50')}>
            <span className="size-2.5 rounded-full" style={{ background: COLOR_ESTADO[e] }} aria-hidden />{ETIQUETA_ESTADO[e]} <span className="text-tenue">{conteo[e]}</span>
          </button>
        ))}
        <Selector value={orden} onChange={(e) => setOrden(e.target.value as Orden)} className="ml-auto w-auto py-1 text-sm" aria-label="Ordenar">
          <option value="visita">Hace más que no visito</option>
          <option value="compras">Los que más compran</option>
          <option value="nombre">Por nombre</option>
        </Selector>
      </div>
      <p className="text-sm text-tenue">{lista.length} de {clientes.length} clientes</p>

      {clientes.length === 0 && <Vacio titulo="Todavía no tenés clientes asignados">Los asigna el supervisor, o llegan solos desde Odoo con tus facturas.</Vacio>}

      <ul className="flex flex-col gap-2">
        {lista.slice(0, mostrar).map((c) => {
          const tel = linkTel(c.telefono)
          const wa = linkWhatsApp(c.telefono_norm)
          const mapa = c.lat != null && c.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}` : null
          return (
            <li key={c.id}>
              <Tarjeta className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.razon_social}</p>
                    <p className="flex items-center gap-2 text-xs text-tenue"><PuntoEstado estado={c.estado} />{c.ciudad ?? 'Sin ciudad'}{c.lat == null && ' · sin ubicación'}</p>
                  </div>
                  <Link href={urlVisita(c.id)} className="shrink-0 text-sm font-medium text-marca">Visitar →</Link>
                </div>
                <p className="mt-1 text-xs text-tenue">
                  Última visita: {hace(c.ultima_visita)}
                  {c.ultima_factura_fecha && ` · Última compra: ${fmtFecha(c.ultima_factura_fecha)}`}
                  {Number(c.ventas_6m_gs ?? 0) > 0 && ` · 6 meses: ${fmtGuaranies(c.ventas_6m_gs)}`}
                </p>
                {(tel || wa || mapa) && (
                  <div className="mt-2 flex gap-2">
                    {tel && <a href={tel} className="inline-flex items-center gap-1 rounded-lg border border-borde px-2.5 py-1.5 text-xs font-medium"><Phone className="size-3.5" aria-hidden /> Llamar</a>}
                    {wa && <a href={wa} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-lg border border-borde px-2.5 py-1.5 text-xs font-medium"><MessageCircle className="size-3.5" aria-hidden /> WhatsApp</a>}
                    {mapa && <a href={mapa} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-lg border border-borde px-2.5 py-1.5 text-xs font-medium"><Navigation className="size-3.5" aria-hidden /> Cómo llegar</a>}
                  </div>
                )}
              </Tarjeta>
            </li>
          )
        })}
      </ul>
      {lista.length > mostrar && (
        <button type="button" onClick={() => setMostrar((m) => m + POR_PAGINA)} className="rounded-lg border border-borde py-2 text-sm font-medium">
          Ver más ({lista.length - mostrar})
        </button>
      )}
    </div>
  )
}
