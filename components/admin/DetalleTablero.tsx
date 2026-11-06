'use client'
// Detalle del tablero: al tocar «7 / 10» de un día (o el total de la semana), los clientes que visitó con su
// estado, observación, motivo y visita anterior; y los de su ruta o de su zona que no visitó.
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Boton, PuntoEstado, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { descargarCsv } from '@/lib/csv'
import { fmtDia, fmtFecha, fmtSoloHora } from '@/lib/fechas'
import { ETIQUETA_ESTADO } from '@/lib/config'
import { mensajeError } from '@/lib/utils'
import type { FilaTableroDetalle } from '@/lib/database.types'

export type Seleccion = { vendedorId: string; nombre: string; desde: string; hasta: string }

export function DetalleTablero({ sel, alCerrar }: { sel: Seleccion; alCerrar: () => void }) {
  const [filas, setFilas] = useState<FilaTableroDetalle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verZona, setVerZona] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const unDia = sel.desde === sel.hasta
  const titulo = `${sel.nombre} · ${unDia ? `${fmtDia(sel.desde)}/${sel.desde.slice(0, 4)}` : `semana del ${fmtFecha(sel.desde)} al ${fmtFecha(sel.hasta)}`}`

  useEffect(() => {
    let vivo = true
    setFilas(null); setError(null); setVerZona(false)
    supabaseNavegador().rpc('vis_tablero_detalle', { p_vendedor: sel.vendedorId, p_desde: sel.desde, p_hasta: sel.hasta })
      .then(({ data, error: e }) => { if (!vivo) return; if (e) setError(mensajeError(e)); else setFilas(data ?? []) })
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return () => { vivo = false }
  }, [sel])

  const visitas = (filas ?? []).filter((f) => f.tipo === 'visita')
  const ruta = (filas ?? []).filter((f) => f.tipo === 'ruta')
  const zona = (filas ?? []).filter((f) => f.tipo === 'zona')
  const motivo = (f: FilaTableroDetalle) => f.resultado ?? '—'

  function excel() {
    descargarCsv(`Visitas ${titulo.replace(/[/:]/g, '-')}`, [
      { titulo: 'Qué', valor: (f: FilaTableroDetalle) => (f.tipo === 'visita' ? 'Visitado' : f.tipo === 'ruta' ? 'En la ruta y no visitó' : 'En la zona y no visitó') },
      { titulo: 'Cliente', valor: (f: FilaTableroDetalle) => f.razon_social },
      { titulo: 'Ciudad', valor: (f: FilaTableroDetalle) => f.ciudad ?? '' },
      { titulo: 'Estado', valor: (f: FilaTableroDetalle) => ETIQUETA_ESTADO[f.estado] ?? f.estado },
      { titulo: 'Fecha visita', valor: (f: FilaTableroDetalle) => (f.fecha_hora ? `${fmtFecha(f.fecha_hora)} ${fmtSoloHora(f.fecha_hora)}` : f.dia ? `planificado ${fmtFecha(f.dia)}` : '') },
      { titulo: 'Motivo', valor: (f: FilaTableroDetalle) => f.resultado ?? '' },
      { titulo: 'Observaciones', valor: (f: FilaTableroDetalle) => f.observaciones ?? '' },
      { titulo: 'Fecha última visita', valor: (f: FilaTableroDetalle) => (f.ultima_anterior ? fmtFecha(f.ultima_anterior) : '') },
      { titulo: 'Zona', valor: (f: FilaTableroDetalle) => f.zona ?? '' },
    ], [...visitas, ...ruta, ...zona])
  }

  const Tabla = ({ lista, conVisita }: { lista: FilaTableroDetalle[]; conVisita: boolean }) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-tenue">
          <tr className="border-b border-borde [&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
            <th>Cliente</th><th>Estado</th>
            {conVisita ? <><th>Fecha visita</th><th>Motivo</th><th>Obs.</th></> : <th>{unDia ? 'Zona' : 'Planificado'}</th>}
            <th>Últ. visita {conVisita ? 'anterior' : ''}</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((f, i) => (
            <tr key={`${f.cliente_id}-${i}`} className="border-b border-borde align-top last:border-0 [&>td]:px-2 [&>td]:py-2">
              <td><p className="font-medium">{f.razon_social}</p>{f.ciudad && <p className="text-xs text-tenue">{f.ciudad}</p>}</td>
              <td className="whitespace-nowrap"><PuntoEstado estado={f.estado} conTexto /></td>
              {conVisita ? (
                <>
                  <td className="whitespace-nowrap tabular">{f.fecha_hora && `${unDia ? '' : `${fmtFecha(f.fecha_hora)} `}${fmtSoloHora(f.fecha_hora)}`}{!f.en_ruta && <p className="text-xs text-tenue">fuera de ruta</p>}</td>
                  <td>{motivo(f)}</td>
                  <td className="max-w-80">{f.observaciones ?? <span className="text-tenue">—</span>}</td>
                </>
              ) : <td className="whitespace-nowrap">{f.tipo === 'ruta' && f.dia && !unDia ? fmtDia(f.dia) : f.zona ?? '—'}</td>}
              <td className="whitespace-nowrap tabular">{f.ultima_anterior ? fmtFecha(f.ultima_anterior) : <span className="text-tenue">nunca</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div ref={ref} className="scroll-mt-4">
      <Tarjeta className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{titulo}</h2>
          <div className="flex items-center gap-2">
            <Boton variante="secundario" onClick={excel} disabled={!filas?.length}>Excel</Boton>
            <button type="button" onClick={alCerrar} aria-label="Cerrar el detalle" className="grid size-10 place-items-center rounded-lg border border-borde"><X className="size-4" /></button>
          </div>
        </div>
        {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        {filas === null && !error && <div className="h-32 animate-pulse rounded-lg bg-borde/40" />}
        {filas && (
          <>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Visitados ({visitas.length})</h3>
              {visitas.length ? <Tabla lista={visitas} conVisita /> : <p className="text-sm text-tenue">No registró visitas.</p>}
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">En la ruta y no visitó ({ruta.length})</h3>
              {ruta.length ? <Tabla lista={ruta} conVisita={false} /> : <p className="text-sm text-tenue">Visitó todos los de la ruta{unDia ? ' de ese día' : ''}.</p>}
            </section>
            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold">En la zona y no visitó ({zona.length})</h3>
                {zona.length > 0 && <button type="button" className="text-sm text-marca underline" onClick={() => setVerZona(!verZona)}>{verZona ? 'Ocultar' : 'Ver'}</button>}
              </div>
              <p className="text-xs text-tenue">Clientes de su cartera en las zonas de su ruta{unDia ? ' de ese día' : ' de la semana'}, sin visita{unDia ? ' ese día' : ' en la semana'} y que no estaban en la ruta.</p>
              {verZona && <Tabla lista={zona} conVisita={false} />}
            </section>
          </>
        )}
      </Tarjeta>
    </div>
  )
}
