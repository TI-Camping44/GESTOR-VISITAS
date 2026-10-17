'use client'
// Mis visitas (pedido de los comerciales): a quiénes visité y qué pasó, día por día,
// y la lista de clientes visitados en el período. Solo las visitas propias (vis_mis_visitas).
import { useEffect, useMemo, useState } from 'react'
import { Phone, MessageCircle, CloudOff } from 'lucide-react'
import { useVendedor } from '@/components/vendedor/Proveedor'
import { Aviso, Entrada, Insignia, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { abrir, guardarCache, leerCache, type VisitaPendiente } from '@/lib/offline/db'
import { fechaIso, fmtFecha, fmtGuaranies, fmtSoloHora, hoyIso, sumarDias } from '@/lib/fechas'
import { cn, linkTel, linkWhatsApp, mensajeError } from '@/lib/utils'
import type { MiVisita } from '@/lib/database.types'

const PERIODOS = [{ dias: 7, texto: '7 días' }, { dias: 30, texto: '30 días' }, { dias: 90, texto: '90 días' }]
const fmtDiaLargo = new Intl.DateTimeFormat('es-PY', { timeZone: 'UTC', weekday: 'long' })

function tituloDia(iso: string, hoy: string) {
  if (iso === hoy) return 'Hoy'
  if (iso === sumarDias(hoy, -1)) return 'Ayer'
  const d = fmtDiaLargo.format(new Date(`${iso}T12:00:00Z`))
  return `${d.charAt(0).toUpperCase()}${d.slice(1)} ${fmtFecha(iso)}`
}

export default function MisVisitas() {
  const { perfil, pendientes } = useVendedor()
  const hoy = hoyIso()
  const [vista, setVista] = useState<'dia' | 'clientes'>('dia')
  const [periodo, setPeriodo] = useState(30)
  const [dia, setDia] = useState('')
  const [buscar, setBuscar] = useState('')
  const [visitas, setVisitas] = useState<MiVisita[] | null>(null)
  const [sinEnviar, setSinEnviar] = useState<VisitaPendiente[]>([])
  const [guardadoEl, setGuardadoEl] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const desde = dia || sumarDias(hoy, -(periodo - 1))
  const hasta = dia || hoy
  const clave = `visitas:${perfil.id}:${desde}:${hasta}`

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const cache = await leerCache<MiVisita[]>(clave).catch(() => null)
      if (vivo) { setVisitas(cache?.datos ?? null); setGuardadoEl(cache?.guardado ?? null) }
      const { data, error } = await supabaseNavegador().rpc('vis_mis_visitas', { p_desde: desde, p_hasta: hasta })
      if (!vivo) return
      if (error) { if (!cache) setError(mensajeError(error)); return }
      setVisitas(data ?? [])
      setGuardadoEl(null)
      setError(null)
      await guardarCache(clave, data ?? []).catch(() => {})
    })()
    return () => { vivo = false }
  }, [clave, desde, hasta])

  // Las que todavía están en el celular esperando señal.
  useEffect(() => {
    abrir().then((d) => d.getAll('visitas')).then(setSinEnviar).catch(() => setSinEnviar([]))
  }, [pendientes.visitas])

  const porDia = useMemo(() => {
    const grupos = new Map<string, MiVisita[]>()
    for (const v of visitas ?? []) {
      const d = fechaIso(v.fecha_hora)
      grupos.set(d, [...(grupos.get(d) ?? []), v])
    }
    return [...grupos.entries()]
  }, [visitas])

  const clientes = useMemo(() => {
    const m = new Map<string, { ultima: MiVisita; cantidad: number; pedidos: number }>()
    for (const v of visitas ?? []) {
      const c = m.get(v.cliente_id)
      if (c) { c.cantidad++; if (v.hizo_pedido) c.pedidos++ } // vienen de la más nueva a la más vieja
      else m.set(v.cliente_id, { ultima: v, cantidad: 1, pedidos: v.hizo_pedido ? 1 : 0 })
    }
    const q = buscar.trim().toLowerCase()
    return [...m.values()].filter((c) => !q || `${c.ultima.razon_social} ${c.ultima.ciudad ?? ''}`.toLowerCase().includes(q))
  }, [visitas, buscar])

  const total = visitas?.length ?? 0
  const conPedido = (visitas ?? []).filter((v) => v.hizo_pedido).length
  const pestana = (activa: boolean) => cn('flex-1 rounded-lg py-2 text-sm font-medium', activa ? 'bg-superficie text-tinta shadow-sm' : 'text-tenue')

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Mis visitas</h1>

      <div className="flex rounded-xl bg-fondo p-1 ring-1 ring-borde" role="tablist">
        <button role="tab" aria-selected={vista === 'dia'} className={pestana(vista === 'dia')} onClick={() => setVista('dia')}>Por día</button>
        <button role="tab" aria-selected={vista === 'clientes'} className={pestana(vista === 'clientes')} onClick={() => setVista('clientes')}>Clientes</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PERIODOS.map((p) => (
          <button key={p.dias} onClick={() => { setPeriodo(p.dias); setDia('') }}
            className={cn('rounded-full border px-3 py-1 text-sm', !dia && periodo === p.dias ? 'border-marca bg-marca text-white' : 'border-borde text-tinta')}>
            {p.texto}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-sm text-tenue">
          Día
          <Entrada type="date" value={dia} max={hoy} onChange={(e) => setDia(e.target.value)} className="min-h-9 w-40 py-1" aria-label="Ver un día" />
        </label>
      </div>

      {error && <Aviso tipo="error">{error}</Aviso>}
      {guardadoEl && <Aviso tipo="info">Sin señal: mostrando lo guardado el {fmtFecha(new Date(guardadoEl))} a las {fmtSoloHora(new Date(guardadoEl))}.</Aviso>}

      {sinEnviar.length > 0 && (
        <Tarjeta className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="flex items-center gap-2 text-sm font-medium"><CloudOff className="size-4" aria-hidden /> Sin enviar todavía ({sinEnviar.length})</p>
          <ul className="mt-1 text-sm text-tenue">
            {sinEnviar.map((v) => <li key={v.client_uuid}>{v.nombreCliente} · {fmtSoloHora(new Date(v.creada))}</li>)}
          </ul>
          <p className="mt-1 text-xs text-tenue">Se envían solas cuando vuelve la señal.</p>
        </Tarjeta>
      )}

      {visitas && (
        <p className="text-sm text-tenue">
          {dia ? tituloDia(dia, hoy) : `Últimos ${periodo} días`}: <b className="text-tinta">{total}</b> visita{total === 1 ? '' : 's'} · <b className="text-tinta">{conPedido}</b> con pedido{vista === 'clientes' ? ` · ${clientes.length} cliente${clientes.length === 1 ? '' : 's'}` : ''}
        </p>
      )}

      {!visitas && !error && <p className="text-sm text-tenue">Cargando…</p>}
      {visitas && total === 0 && <Vacio titulo="Sin visitas en este período">Cuando guardes una visita, aparece acá.</Vacio>}

      {vista === 'dia' && porDia.map(([d, lista]) => (
        <section key={d} className="flex flex-col gap-2">
          <h2 className="sticky top-0 z-10 -mx-4 bg-fondo/95 px-4 py-1 text-sm font-semibold backdrop-blur">
            {tituloDia(d, hoy)} <span className="font-normal text-tenue">· {lista.length} visita{lista.length === 1 ? '' : 's'} · {lista.filter((v) => v.hizo_pedido).length} con pedido</span>
          </h2>
          {lista.map((v) => <FilaVisita key={v.id} v={v} />)}
        </section>
      ))}

      {vista === 'clientes' && total > 0 && (
        <>
          <Entrada value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar cliente o ciudad" aria-label="Buscar cliente" />
          {clientes.map(({ ultima: v, cantidad, pedidos }) => (
            <Tarjeta key={v.cliente_id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{v.razon_social}</p>
                  <p className="text-xs text-tenue">{v.ciudad ?? 'Sin ciudad'}</p>
                </div>
                <Contacto v={v} />
              </div>
              <p className="mt-1 text-sm">
                {cantidad} visita{cantidad === 1 ? '' : 's'}{pedidos > 0 && <> · <span className="text-green-700 dark:text-green-300">{pedidos} con pedido</span></>}
              </p>
              <p className="text-xs text-tenue">Última: {fmtFecha(v.fecha_hora)} · {v.resultado ?? 'sin resultado'}{v.proxima_visita ? ` · Próxima: ${fmtFecha(v.proxima_visita)}` : ''}</p>
            </Tarjeta>
          ))}
          {clientes.length === 0 && <Vacio titulo="No hay clientes con ese nombre" />}
        </>
      )}
    </div>
  )
}

function Contacto({ v }: { v: MiVisita }) {
  const tel = linkTel(v.telefono)
  const wa = linkWhatsApp(v.telefono_norm)
  return (
    <div className="flex shrink-0 gap-1">
      {tel && <a href={tel} className="rounded-lg border border-borde p-2" aria-label={`Llamar a ${v.razon_social}`}><Phone className="size-4" aria-hidden /></a>}
      {wa && <a href={wa} target="_blank" rel="noopener" className="rounded-lg border border-borde p-2" aria-label={`WhatsApp a ${v.razon_social}`}><MessageCircle className="size-4" aria-hidden /></a>}
    </div>
  )
}

function FilaVisita({ v }: { v: MiVisita }) {
  return (
    <Tarjeta className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium"><span className="mr-1 tabular-nums text-tenue">{fmtSoloHora(v.fecha_hora)}</span>{v.razon_social}</p>
          <p className="text-xs text-tenue">{v.ciudad ?? 'Sin ciudad'}{!v.en_ruta && ' · fuera de ruta'}</p>
        </div>
        <Contacto v={v} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {v.resultado && <Insignia className={v.es_venta || v.hizo_pedido ? 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200' : ''}>{v.resultado}</Insignia>}
        {v.hizo_pedido && !v.es_venta && <Insignia className="bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200">Con pedido</Insignia>}
        {v.hizo_cobranza && <Insignia>Cobró {fmtGuaranies(v.monto_cobrado_gs)}</Insignia>}
        {v.proxima_visita && <Insignia>Próxima: {fmtFecha(v.proxima_visita)}</Insignia>}
      </div>
      {v.observaciones && <p className="mt-2 line-clamp-3 text-sm text-tenue">{v.observaciones}</p>}
    </Tarjeta>
  )
}
