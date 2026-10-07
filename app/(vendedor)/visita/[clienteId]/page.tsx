'use client'
// Registrar visita (BRIEF §6 vendedor 2): GPS del momento, resultado, pedido/cobranza, foto
// y sugerencia de corregir la ubicación si el cliente está lejos de donde figura.
import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Camera } from 'lucide-react'
import { useVendedor } from '@/components/vendedor/Proveedor'
import { CapturaGps, useGps } from '@/components/vendedor/CapturaGps'
import { AreaTexto, Aviso, Boton, Entrada, Etiqueta, PuntoEstado, Selector, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { guardarCache, leerCache } from '@/lib/offline/db'
import { encolarVisita } from '@/lib/offline/subir'
import { hoyIso } from '@/lib/fechas'
import { distanciaM, fmtDistancia } from '@/lib/geo'
import { VIS } from '@/lib/config'
import { mensajeError } from '@/lib/utils'
import type { EstadoCliente, ParadaDia, Resultado } from '@/lib/database.types'

type ClienteVisita = { id: string; razon_social: string; ciudad: string | null; direccion: string | null; lat: number | null; lng: number | null; estado: EstadoCliente }
type Fin = { tipo: 'online' | 'offline'; alerta: number | null; sinUbicacion: boolean }

async function comprimir(archivo: File, max = 1280): Promise<Blob> {
  const img = await createImageBitmap(archivo)
  const escala = Math.min(1, max / Math.max(img.width, img.height))
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.round(img.width * escala)
  lienzo.height = Math.round(img.height * escala)
  lienzo.getContext('2d')!.drawImage(img, 0, 0, lienzo.width, lienzo.height)
  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo comprimir la foto'))), 'image/jpeg', 0.8))
}

export default function RegistrarVisita({ params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = use(params)
  const paradaId = useSearchParams().get('parada')
  const router = useRouter()
  const { perfil, refrescarPendientes } = useVendedor()
  const gps = useGps()

  const [cliente, setCliente] = useState<ClienteVisita | null>(null)
  const [resultados, setResultados] = useState<Resultado[]>([])
  const [errorCarga, setErrorCarga] = useState<string | null>(null)

  const [resultadoId, setResultadoId] = useState('')
  const [hizoPedido, setHizoPedido] = useState(false)
  const [cobranza, setCobranza] = useState(false)
  const [monto, setMonto] = useState('')
  const [obs, setObs] = useState('')
  const [proxima, setProxima] = useState('')
  const [foto, setFoto] = useState<File | null>(null)

  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fin, setFin] = useState<Fin | null>(null)
  const [ubicacionGuardada, setUbicacionGuardada] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const sb = supabaseNavegador()
      // Cliente: primero de la ruta guardada (sirve sin señal), después de la base.
      const ruta = await leerCache<{ paradas: ParadaDia[] }>(`hoy:${perfil.id}:${hoyIso()}`).catch(() => null)
      const enRuta = ruta?.datos.paradas.find((p) => p.cliente_id === clienteId)
      if (enRuta && vivo) setCliente({ id: enRuta.cliente_id, razon_social: enRuta.razon_social, ciudad: enRuta.ciudad, direccion: enRuta.direccion, lat: enRuta.lat, lng: enRuta.lng, estado: enRuta.estado })
      const { data, error } = await sb.from('vis_clientes_v').select('id, razon_social, ciudad, direccion, lat, lng, estado').eq('id', clienteId).maybeSingle()
      if (!vivo) return
      if (data) setCliente(data as ClienteVisita)
      else if (!enRuta) setErrorCarga(error ? 'Sin señal y este cliente no está en tu ruta guardada.' : 'No encontramos este cliente o no lo tenés asignado.')

      const cacheRes = await leerCache<Resultado[]>('resultados').catch(() => null)
      if (cacheRes && vivo) setResultados(cacheRes.datos)
      const r = await sb.from('vis_resultados').select('*').eq('activo', true).order('orden')
      if (r.data && vivo) { setResultados(r.data); void guardarCache('resultados', r.data) }
    })()
    return () => { vivo = false }
  }, [clienteId, perfil.id])

  const destino = cliente?.lat != null && cliente.lng != null ? { lat: cliente.lat, lng: cliente.lng } : null
  const resultadoElegido = resultados.find((r) => String(r.id) === resultadoId)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!cliente) return
    if (!resultadoId) { setError('Elegí el resultado de la visita.'); return }
    if (cobranza && !(Number(monto) > 0)) { setError('Indicá el monto cobrado.'); return }
    setEnviando(true)
    setError(null)
    const client_uuid = crypto.randomUUID()
    const l = gps.lectura
    const payload: Record<string, unknown> = {
      client_uuid, cliente_id: cliente.id, ruta_parada_id: paradaId, fecha_hora: new Date().toISOString(),
      lat: l?.lat ?? null, lng: l?.lng ?? null, precision_m: l?.precision ?? null,
      resultado_id: Number(resultadoId), hizo_pedido: hizoPedido || !!resultadoElegido?.es_venta,
      hizo_cobranza: cobranza, monto_cobrado_gs: cobranza ? Math.round(Number(monto)) : null,
      observaciones: obs.trim() || null, proxima_visita: proxima || null, fotos: [] as string[],
    }
    const sinUbicacion = cliente.lat == null && gps.precisionOk

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')
      const sb = supabaseNavegador()
      if (foto) {
        const ruta = `${perfil.id}/${client_uuid}.jpg`
        const { error: errFoto } = await sb.storage.from('vis-fotos').upload(ruta, await comprimir(foto), { contentType: 'image/jpeg', upsert: true })
        if (errFoto) throw errFoto
        payload.fotos = [ruta]
      }
      const { data, error } = await sb.rpc('vis_registrar_visita', { p: payload as never })
      if (error) throw error
      const r = data as { alerta_distancia: boolean; distancia_cliente_m: number | null }
      setFin({ tipo: 'online', alerta: r.alerta_distancia && gps.precisionOk ? r.distancia_cliente_m : null, sinUbicacion })
    } catch (err) {
      const msg = mensajeError(err)
      if (/fetch|network|Load failed/i.test(msg)) {
        // Sin señal: se guarda en el celular y se sube sola. (La foto queda para la Fase 2.)
        await encolarVisita({ client_uuid, payload: { ...payload, capturada_offline: true, fotos: [] }, creada: Date.now(), intentos: 0, nombreCliente: cliente.razon_social })
        await refrescarPendientes()
        setFin({ tipo: 'offline', alerta: null, sinUbicacion: false })
      } else {
        setError(msg)
      }
    } finally {
      setEnviando(false)
    }
  }

  async function corregirUbicacion() {
    const l = gps.lectura
    if (!cliente || !l) return
    setEnviando(true)
    const { error } = await supabaseNavegador().rpc('vis_actualizar_ubicacion', {
      p_cliente: cliente.id, p_lat: l.lat, p_lng: l.lng, p_precision: l.precision, p_origen: 'gps_visita',
      p_motivo: cliente.lat == null ? 'Primera ubicación, tomada en visita' : 'Confirmado por el vendedor en la visita',
    })
    setEnviando(false)
    if (error) setError(mensajeError(error))
    else setUbicacionGuardada(true)
  }

  if (errorCarga) return <Aviso tipo="error">{errorCarga} <Link href="/hoy" className="underline">Volver</Link></Aviso>
  if (!cliente) return <div className="h-40 animate-pulse rounded-xl bg-borde/40" />

  if (fin) {
    const preguntar = (fin.alerta != null || fin.sinUbicacion) && !ubicacionGuardada
    return (
      <div className="flex flex-col gap-4">
        <Aviso tipo={fin.tipo === 'online' ? 'ok' : 'alerta'}>
          {fin.tipo === 'online' ? `Visita a ${cliente.razon_social} registrada.` : 'Sin señal: la visita quedó guardada en el celular y se sube sola cuando vuelva la conexión.'}
          {fin.tipo === 'offline' && foto && ' La foto no se guardó (sin señal).'}
        </Aviso>
        {preguntar && (
          <Tarjeta className="flex flex-col gap-3">
            <p className="font-medium">
              {fin.sinUbicacion
                ? `${cliente.razon_social} no tiene ubicación cargada. ¿Guardamos esta como la ubicación del cliente?`
                : `Estás a ${fmtDistancia(fin.alerta)} de la ubicación registrada. ¿El cliente está acá?`}
            </p>
            <p className="text-sm text-tenue">Se corrige solo en esta app (no en Odoo) y queda en el historial.</p>
            <div className="flex gap-2">
              <Boton className="flex-1" disabled={enviando} onClick={() => void corregirUbicacion()}>Sí, está acá</Boton>
              <Boton variante="secundario" onClick={() => router.push('/hoy')}>No</Boton>
            </div>
          </Tarjeta>
        )}
        {ubicacionGuardada && <Aviso tipo="ok">Ubicación del cliente actualizada.</Aviso>}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Boton variante={preguntar ? 'secundario' : 'primario'} grande onClick={() => { router.push('/hoy'); router.refresh() }}>Volver a Hoy</Boton>
      </div>
    )
  }

  const lejos = gps.lectura && destino ? distanciaM(gps.lectura, destino) > VIS.distAlertaM : false
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-tenue">Registrar visita</p>
        <h1 className="text-xl font-semibold leading-snug">{cliente.razon_social}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <PuntoEstado estado={cliente.estado} conTexto />
          <span className="text-sm text-tenue">{[cliente.direccion, cliente.ciudad].filter(Boolean).join(' · ')}</span>
        </div>
      </div>

      <CapturaGps gps={gps} destino={destino} />
      {lejos && <Aviso tipo="alerta">Estás lejos de donde figura el cliente. Si está acá, al guardar te preguntamos si corregimos la ubicación.</Aviso>}

      <div>
        <Etiqueta htmlFor="resultado">Resultado</Etiqueta>
        <Selector id="resultado" required value={resultadoId} onChange={(e) => setResultadoId(e.target.value)}>
          <option value="">Elegí…</option>
          {resultados.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </Selector>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-3 text-base">
          <input type="checkbox" className="size-5 accent-[var(--c-marca)]" checked={hizoPedido || !!resultadoElegido?.es_venta} disabled={!!resultadoElegido?.es_venta} onChange={(e) => setHizoPedido(e.target.checked)} />
          ¿Hizo pedido?
        </label>
        <label className="flex items-center gap-3 text-base">
          <input type="checkbox" className="size-5 accent-[var(--c-marca)]" checked={cobranza} onChange={(e) => setCobranza(e.target.checked)} />
          ¿Hizo cobranza?
        </label>
        {cobranza && (
          <div>
            <Etiqueta htmlFor="monto">Monto cobrado (Gs.)</Etiqueta>
            <Entrada id="monto" inputMode="numeric" pattern="[0-9]*" value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ''))} placeholder="0" />
          </div>
        )}
      </div>

      <div>
        <Etiqueta htmlFor="obs">Observaciones</Etiqueta>
        <AreaTexto id="obs" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Qué pasó, qué necesita, a quién ver la próxima vez…" />
      </div>

      <div>
        <Etiqueta htmlFor="proxima">Próxima visita</Etiqueta>
        <Entrada id="proxima" type="date" min={hoyIso()} value={proxima} onChange={(e) => setProxima(e.target.value)} />
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium">Foto de la fachada (opcional)</span>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-borde px-3 py-3 text-sm">
          <Camera className="size-5 text-marca" aria-hidden />
          {foto ? foto.name : 'Sacar o elegir foto'}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
        </label>
      </div>

      {error && <Aviso tipo="error">{error}</Aviso>}
      <Boton type="submit" grande disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar visita'}</Boton>
      {!gps.lectura && !gps.leyendo && <p className="text-center text-xs text-tenue">Se puede guardar sin GPS, pero no queda la ubicación de la visita.</p>}
    </form>
  )
}
