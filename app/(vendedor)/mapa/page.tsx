'use client'
// Mapa del vendedor (BRIEF §6 vendedor 4): sus clientes por color, filtro por estado y "cerca mío".
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Mapa, type PuntoMapa } from '@/components/map/MapaDinamico'
import { Aviso, Boton, PuntoEstado, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { leerGps } from '@/lib/gps'
import { fmtDistancia } from '@/lib/geo'
import { hace } from '@/lib/fechas'
import { COLOR_ESTADO, ETIQUETA_ESTADO } from '@/lib/config'
import { cn, mensajeError } from '@/lib/utils'
import type { EstadoCliente } from '@/lib/database.types'

type C = { id: string; razon_social: string; ciudad: string | null; lat: number; lng: number; estado: EstadoCliente; ultima_visita: string | null; distancia_m?: number }
const ESTADOS: EstadoCliente[] = ['activo', 'potencial', 'inactivo']

export default function MapaVendedor() {
  const [clientes, setClientes] = useState<C[]>([])
  const [filtro, setFiltro] = useState<Set<EstadoCliente>>(new Set(ESTADOS))
  const [cerca, setCerca] = useState<{ radio: number; lista: C[]; yo: { lat: number; lng: number } } | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabaseNavegador().from('vis_clientes_v').select('id, razon_social, ciudad, lat, lng, estado, ultima_visita')
      .not('lat', 'is', null).limit(5000)
      .then(({ data, error }) => {
        if (error) setError(mensajeError(error))
        else setClientes((data ?? []) as C[])
      })
  }, [])

  async function buscarCerca(radioKm: number) {
    setBuscando(true)
    setError(null)
    try {
      const yo = await leerGps()
      const { data, error } = await supabaseNavegador().rpc('vis_clientes_cercanos', { p_lat: yo.lat, p_lng: yo.lng, p_radio_m: radioKm * 1000 })
      if (error) throw error
      setCerca({ radio: radioKm, lista: (data ?? []) as C[], yo: { lat: yo.lat, lng: yo.lng } })
    } catch (e) {
      setError(mensajeError(e))
    } finally {
      setBuscando(false)
    }
  }

  const visibles = (cerca?.lista ?? clientes).filter((c) => filtro.has(c.estado))
  const puntos = useMemo<PuntoMapa[]>(() => visibles.map((c) => ({
    id: c.id, lat: c.lat, lng: c.lng, color: COLOR_ESTADO[c.estado], titulo: c.razon_social,
    detalle: `${ETIQUETA_ESTADO[c.estado]} · última visita ${hace(c.ultima_visita)}`,
    href: `/visita/${c.id}`, textoLink: 'Registrar visita',
  })), [visibles])

  const alternar = (e: EstadoCliente) => setFiltro((f) => {
    const n = new Set(f)
    if (n.has(e)) n.delete(e)
    else n.add(e)
    return n
  })

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">Mis clientes</h1>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
        {ESTADOS.map((e) => (
          <button key={e} type="button" onClick={() => alternar(e)} aria-pressed={filtro.has(e)}
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm', filtro.has(e) ? 'border-borde bg-superficie' : 'border-transparent bg-fondo opacity-50')}>
            <span className="size-2.5 rounded-full" style={{ background: COLOR_ESTADO[e] }} aria-hidden />{ETIQUETA_ESTADO[e]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-tenue">Cerca mío:</span>
        {[2, 5, 10].map((km) => (
          <Boton key={km} variante={cerca?.radio === km ? 'primario' : 'secundario'} disabled={buscando} onClick={() => void buscarCerca(km)}>{km} km</Boton>
        ))}
        {cerca && <Boton variante="fantasma" onClick={() => setCerca(null)}>Ver todos</Boton>}
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <Mapa puntos={puntos} agrupar={!cerca} yo={cerca?.yo ?? null} claveEncuadre={cerca ? `cerca-${cerca.radio}` : `todos-${clientes.length}`} className="h-[55vh] w-full overflow-hidden rounded-xl border border-borde" />

      {cerca && (
        <ul className="flex flex-col gap-2">
          {visibles.length === 0 && <li className="text-sm text-tenue">No hay clientes tuyos a menos de {cerca.radio} km.</li>}
          {visibles.map((c) => (
            <li key={c.id}>
              <Tarjeta className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.razon_social}</p>
                  <div className="flex items-center gap-2"><PuntoEstado estado={c.estado} /><span className="text-xs text-tenue">{fmtDistancia(c.distancia_m)} · {c.ciudad ?? ''}</span></div>
                </div>
                <Link href={`/visita/${c.id}`} className="shrink-0 text-sm font-medium text-marca">Visitar →</Link>
              </Tarjeta>
            </li>
          ))}
        </ul>
      )}
      {!cerca && <p className="text-xs text-tenue">{clientes.length} clientes con ubicación. Tocá un punto para registrar una visita.</p>}
    </div>
  )
}
