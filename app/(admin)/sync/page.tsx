'use client'
// Sincronización con Odoo (BRIEF §5): revisar la conexión, sincronizar a mano (además del cron
// diario), ver el log y marcar como vistos los fallos (apaga el banner rojo del panel).
import { useCallback, useEffect, useState, useTransition } from 'react'
import { Aviso, Boton, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtFechaHora } from '@/lib/fechas'
import { mensajeError } from '@/lib/utils'
import { accionRevisar, accionSincronizar } from './acciones'
import type { ResultadoSync, Revision } from '@/lib/sync/odoo'

type Log = { id: number; proceso: string; inicio: string; fin: string | null; ok: boolean | null; leidos: number | null; insertados: number | null; actualizados: number | null; error: string | null; visto_el: string | null }

export default function Sync() {
  const sb = supabaseNavegador()
  const [log, setLog] = useState<Log[]>([])
  const [error, setError] = useState<string | null>(null)
  const [esAdmin, setEsAdmin] = useState(false)
  const [revision, setRevision] = useState<Revision | null>(null)
  const [resultado, setResultado] = useState<ResultadoSync | null>(null)
  const [revisando, iniciarRevision] = useTransition()
  const [sincronizando, iniciarSync] = useTransition()

  const cargar = useCallback(async () => {
    const { data, error } = await sb.from('vis_sync_log').select('*').order('inicio', { ascending: false }).limit(100)
    if (error) setError(mensajeError(error))
    else setLog((data ?? []) as Log[])
  }, [sb])
  useEffect(() => {
    void cargar()
    sb.rpc('vis_es_admin').then(({ data }) => setEsAdmin(!!data))
  }, [cargar, sb])

  function revisar() {
    setError(null)
    iniciarRevision(async () => {
      const r = await accionRevisar()
      if ('error' in r) setError(r.error)
      else setRevision(r.revision)
    })
  }

  function sincronizar() {
    setError(null)
    setResultado(null)
    iniciarSync(async () => {
      const r = await accionSincronizar()
      if ('error' in r && !('pasos' in r)) setError(r.error)
      else setResultado(r as ResultadoSync)
      void cargar()
    })
  }

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
      <p className="text-sm text-tenue">
        Lee de Odoo (nunca escribe) clientes y facturación: cada cliente queda con el vendedor de su última factura de los
        últimos 12 meses y con su estado (activo o sin movimiento). Corre sola todos los días a las 05:00 y se puede correr acá.
        Las ubicaciones corregidas en la calle, las zonas y las notas no se tocan.
      </p>
      {esAdmin && (
        <div className="flex flex-wrap gap-2">
          <Boton variante="secundario" disabled={revisando || sincronizando} onClick={revisar}>{revisando ? 'Revisando…' : 'Revisar conexión'}</Boton>
          <Boton disabled={revisando || sincronizando} onClick={sincronizar}>{sincronizando ? 'Sincronizando… (puede tardar unos minutos)' : 'Sincronizar ahora'}</Boton>
        </div>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {resultado && (
        <Aviso tipo={resultado.ok ? 'ok' : 'error'}>
          {resultado.ok ? 'Sincronización completa. ' : `La sincronización falló: ${resultado.error}. `}
          {resultado.pasos.map((p) => `${p.proceso}: ${p.leidos} leídos, ${p.insertados} nuevos, ${p.actualizados} actualizados`).join(' · ')}
        </Aviso>
      )}
      {revision && <TarjetaRevision r={revision} />}
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

function TarjetaRevision({ r }: { r: Revision }) {
  return (
    <Tarjeta className="flex flex-col gap-3 text-sm">
      <h2 className="text-base font-semibold">Conexión con Odoo: OK</h2>
      <p>Odoo {r.version} · usuario {r.usuario} · {r.clientesOdoo.toLocaleString('es-PY')} clientes · {r.facturas12m.toLocaleString('es-PY')} facturas en 12 meses</p>
      {r.camposFaltantes.length > 0 && <Aviso tipo="alerta">Faltan campos en Odoo: {r.camposFaltantes.join(', ')}.</Aviso>}
      <div>
        <p className="font-medium">Compañías</p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {r.companias.map((c) => (
            <li key={c.id} className={`rounded-full border px-3 py-1 ${c.id === r.companiaElegida ? 'border-marca font-medium' : 'border-borde'}`}>{c.id} · {c.nombre}</li>
          ))}
        </ul>
        {r.companiaElegida == null && (
          <Aviso tipo="alerta">Falta <b>ODOO_COMPANY_ID</b> en Vercel: cargá el número de Camping 44 de la lista y volvé a desplegar. Sin eso se leen las facturas de todas las compañías.</Aviso>
        )}
      </div>
      <div className="overflow-x-auto">
        <p className="mb-1 font-medium">Vendedores que facturaron en 12 meses</p>
        <table className="w-full min-w-[560px]">
          <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
            <th className="py-1 pr-2 font-medium">En Odoo</th><th className="px-2 py-1 font-medium">Email</th><th className="px-2 py-1 text-right font-medium">Facturas</th><th className="px-2 py-1 font-medium">En la app</th>
          </tr></thead>
          <tbody>
            {r.vendedores.map((v) => (
              <tr key={`${v.odooId}-${v.nombre}`} className="border-b border-borde last:border-0">
                <td className="py-1 pr-2">{v.nombre}</td><td className="px-2 py-1 text-tenue">{v.email ?? '—'}</td>
                <td className="px-2 py-1 text-right tabular">{v.facturas}</td>
                <td className="px-2 py-1">{v.enApp ?? <span className="text-tenue">no está (sus clientes quedan como están)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-tenue">Se reconocen por email: para que un vendedor reciba su cartera, cargalo en Usuarios con el mismo email que usa en Odoo.</p>
      </div>
    </Tarjeta>
  )
}
