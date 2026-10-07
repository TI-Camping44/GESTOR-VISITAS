'use client'
// Sincronización con Odoo (BRIEF §5). La integración queda para el final; acá se ve el log
// y se marcan como vistos los fallos (apaga el banner rojo del panel).
import { useCallback, useEffect, useState } from 'react'
import { Aviso, Boton, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtFechaHora } from '@/lib/fechas'
import { mensajeError } from '@/lib/utils'

type Log = { id: number; proceso: string; inicio: string; fin: string | null; ok: boolean | null; leidos: number | null; insertados: number | null; actualizados: number | null; error: string | null; visto_el: string | null }

export default function Sync() {
  const sb = supabaseNavegador()
  const [log, setLog] = useState<Log[]>([])
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await sb.from('vis_sync_log').select('*').order('inicio', { ascending: false }).limit(100)
    if (error) setError(mensajeError(error))
    else setLog((data ?? []) as Log[])
  }, [sb])
  useEffect(() => { void cargar() }, [cargar])

  async function marcarVistos() {
    const { data: yo } = await sb.rpc('vis_mi_id')
    const { error } = await sb.from('vis_sync_log').update({ visto_el: new Date().toISOString(), visto_por: yo }).eq('ok', false).is('visto_el', null)
    if (error) setError(mensajeError(error))
    void cargar()
  }

  const sinVer = log.filter((l) => l.ok === false && !l.visto_el).length
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Sincronización con Odoo</h1>
      <Aviso tipo="info">
        La conexión con Odoo (clientes, vendedores, facturación e historial de visitas) se activa en la última etapa.
        Hasta entonces los clientes se cargan como prospectos desde la app.
      </Aviso>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {sinVer > 0 && (
        <Tarjeta className="flex items-center justify-between gap-3 border-red-300">
          <p className="font-medium text-red-700 dark:text-red-300">{sinVer} corrida{sinVer > 1 ? 's' : ''} con error sin revisar.</p>
          <Boton variante="secundario" onClick={() => void marcarVistos()}>Marcar como vistas</Boton>
        </Tarjeta>
      )}
      {log.length === 0 ? <Vacio titulo="Todavía no hubo sincronizaciones" /> : (
        <Tarjeta className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="px-4 py-2 font-medium">Proceso</th><th className="px-2 py-2 font-medium">Inicio</th><th className="px-2 py-2 font-medium">Resultado</th>
              <th className="px-2 py-2 text-right font-medium">Leídos</th><th className="px-2 py-2 text-right font-medium">Nuevos</th><th className="px-4 py-2 text-right font-medium">Actualizados</th>
            </tr></thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id} className="border-b border-borde align-top last:border-0">
                  <td className="px-4 py-2 font-medium">{l.proceso}</td>
                  <td className="px-2 py-2">{fmtFechaHora(l.inicio)}</td>
                  <td className="px-2 py-2">{l.ok == null ? 'en curso' : l.ok ? 'OK' : <span className="text-red-700 dark:text-red-300">Error: {l.error}</span>}</td>
                  <td className="px-2 py-2 text-right tabular">{l.leidos ?? '—'}</td>
                  <td className="px-2 py-2 text-right tabular">{l.insertados ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular">{l.actualizados ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}
    </div>
  )
}
