'use client'
// Registrar visita (BRIEF §6 vendedor 2): GPS del momento, resultado, pedido/cobranza, foto
// y sugerencia de corregir la ubicación si el cliente está lejos de donde figura.
// Una sola dirección para todos los clientes (/visita?c=<id>): así una copia guardada
// en el celular sirve sin señal para cualquier cliente (ver public/sw.js).
// Visita médica: /visita?c=<lugar>&m=<médico> (productos presentados y muestras, sin pedido ni cobranza).
import { useEffect, useState } from 'react'
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
import { esErrorDeRed, mensajeError } from '@/lib/utils'
import { urlLugar } from '@/lib/rutas'
import type { EstadoCliente, Medico, ParadaDia, Producto, ProductoVisita, ProximaVisita, Resultado } from '@/lib/database.types'

type ClienteVisita = { id: string; razon_social: string; ciudad: string | null; direccion: string | null; lat: number | null; lng: number | null; estado: EstadoCliente; vendedor_id?: string | null }
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

export default function RegistrarVisita() {
  const busqueda = useSearchParams()
  const clienteId = busqueda.get('c') ?? ''
  const paradaId = busqueda.get('parada')
  const altaId = busqueda.get('alta') // visita creada con el alta del cliente: se completa, no se duplica
  const medicoId = busqueda.get('m')
  const router = useRouter()
  const { perfil, refrescarPendientes, nombreVendedor, esMedica } = useVendedor()
  const gps = useGps()

  const [cliente, setCliente] = useState<ClienteVisita | null>(null)
  const [resultados, setResultados] = useState<Resultado[]>([])
  const [medico, setMedico] = useState<Medico | null>(null)
  const [productos, setProductos] = useState<Producto[]>([])
  const [muestras, setMuestras] = useState<Record<string, number | null>>({}) // producto → muestras (null = presentado sin muestras)
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
      if (!clienteId) { setErrorCarga('Falta el cliente.'); return }
      const sb = supabaseNavegador()
      // Primero lo guardado en el celular (sirve sin señal o con señal débil), después la base.
      const [ruta, cartera, cacheRes] = await Promise.all([
        leerCache<{ paradas: ParadaDia[]; pendientes?: ProximaVisita[] }>(`hoy:${perfil.id}:${hoyIso()}`).catch(() => null),
        leerCache<ClienteVisita[]>(`cartera:${perfil.id}`).catch(() => null),
        leerCache<Resultado[]>('resultados').catch(() => null),
      ])
      if (!vivo) return
      if (cacheRes) setResultados(cacheRes.datos)
      const enRuta = ruta?.datos.paradas.find((p) => p.cliente_id === clienteId)
        ?? ruta?.datos.pendientes?.find((p) => p.cliente_id === clienteId)
      const guardado: ClienteVisita | undefined = enRuta
        ? { id: enRuta.cliente_id, razon_social: enRuta.razon_social, ciudad: enRuta.ciudad, direccion: enRuta.direccion, lat: enRuta.lat, lng: enRuta.lng, estado: enRuta.estado }
        : cartera?.datos.find((c) => c.id === clienteId)
      if (guardado) setCliente(guardado)

      const [{ data, error }, r] = await Promise.all([
        sb.from('vis_clientes_v').select('id, razon_social, ciudad, direccion, lat, lng, estado, vendedor_id').eq('id', clienteId).maybeSingle(),
        sb.from('vis_resultados').select('*').eq('activo', true).order('orden'),
      ])
      if (!vivo) return
      if (data) setCliente(data as ClienteVisita)
      else if (!guardado) setErrorCarga(error ? 'Sin señal y este cliente no está guardado en el celular. Abrilo una vez con señal.' : 'No encontramos este cliente o no lo tenés asignado.')
      if (r.data) { setResultados(r.data); void guardarCache('resultados', r.data) }
    })()
    return () => { vivo = false }
  }, [clienteId, perfil.id])

  // Visita médica: el médico y la lista de productos (primero lo guardado en el celular).
  useEffect(() => {
    if (!medicoId) return
    let vivo = true
    ;(async () => {
      const [meds, prods] = await Promise.all([
        leerCache<Medico[]>(`medicos:${perfil.id}`).catch(() => null),
        leerCache<Producto[]>('productos').catch(() => null),
      ])
      if (!vivo) return
      const m = meds?.datos.find((x) => x.id === medicoId)
      if (m) setMedico(m)
      if (prods) setProductos(prods.datos)
      const sb = supabaseNavegador()
      const [rm, rp] = await Promise.all([
        sb.from('vis_medicos_v').select('*').eq('id', medicoId).maybeSingle(),
        sb.from('vis_productos').select('*').eq('activo', true).order('orden').order('nombre'),
      ])
      if (!vivo) return
      if (rm.data) setMedico(rm.data)
      if (rp.data) { setProductos(rp.data); void guardarCache('productos', rp.data) }
    })()
    return () => { vivo = false }
  }, [medicoId, perfil.id])

  const tipoResultado = medicoId || esMedica ? 'medica' : 'ventas'
  const opciones = resultados.filter((r) => (r.tipo ?? 'ventas') === tipoResultado)
  const volver = esMedica ? urlLugar(clienteId, { parada: paradaId }) : '/hoy'

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
      client_uuid, cliente_id: cliente.id, ruta_parada_id: paradaId, visita_id: altaId, fecha_hora: new Date().toISOString(),
      lat: l?.lat ?? null, lng: l?.lng ?? null, precision_m: l?.precision ?? null,
      resultado_id: Number(resultadoId), hizo_pedido: hizoPedido || !!resultadoElegido?.es_venta,
      hizo_cobranza: cobranza, monto_cobrado_gs: cobranza ? Math.round(Number(monto)) : null,
      observaciones: obs.trim() || null, proxima_visita: proxima || null, fotos: [] as string[],
      medico_id: medicoId, productos: Object.entries(muestras).map(([producto, n]): ProductoVisita => ({ producto, muestras: n ?? 0 })),
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
      if (esErrorDeRed(err)) {
        // Sin señal: se guarda en el celular y se sube sola. (La foto queda para la Fase 2.)
        await encolarVisita({ client_uuid, payload: { ...payload, capturada_offline: true, fotos: [] }, creada: Date.now(), intentos: 0, nombreCliente: medico ? `${medico.nombre} · ${cliente.razon_social}` : cliente.razon_social })
        await refrescarPendientes()
        setFin({ tipo: 'offline', alerta: null, sinUbicacion: false })
      } else {
        setError(mensajeError(err))
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
          {fin.tipo === 'online' ? `Visita a ${medico ? `${medico.nombre} (${cliente.razon_social})` : cliente.razon_social} registrada.` : 'Sin señal: la visita quedó guardada en el celular y se sube sola cuando vuelva la conexión.'}
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
              <Boton variante="secundario" onClick={() => router.push(volver)}>No</Boton>
            </div>
          </Tarjeta>
        )}
        {ubicacionGuardada && <Aviso tipo="ok">Ubicación del cliente actualizada.</Aviso>}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Boton variante={preguntar ? 'secundario' : 'primario'} grande onClick={() => { router.push(volver); router.refresh() }}>{esMedica ? 'Volver al lugar' : 'Volver a Hoy'}</Boton>
      </div>
    )
  }

  const lejos = gps.lectura && destino ? distanciaM(gps.lectura, destino) > VIS.distAlertaM : false
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-tenue">Registrar visita</p>
        {medico && <h1 className="text-xl font-semibold leading-snug">{medico.nombre}{medico.especialidad && <span className="font-normal text-tenue"> · {medico.especialidad}</span>}</h1>}
        {medico ? <p className="font-medium">{cliente.razon_social}</p> : <h1 className="text-xl font-semibold leading-snug">{cliente.razon_social}</h1>}
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {!esMedica && <PuntoEstado estado={cliente.estado} conTexto />}
          <span className="text-sm text-tenue">{[cliente.direccion, cliente.ciudad].filter(Boolean).join(' · ')}</span>
        </div>
      </div>

      {medicoId && !medico && <Aviso tipo="alerta">Este médico no está guardado en el celular: abrí Médicos una vez con señal.</Aviso>}
      {cliente.vendedor_id && cliente.vendedor_id !== perfil.id && (
        <Aviso tipo="alerta">Este cliente es de <b>{nombreVendedor(cliente.vendedor_id)}</b>. Si lo visitás, la visita queda a tu nombre y su vendedor la ve en el historial.</Aviso>
      )}
      {altaId && <Aviso tipo="ok">El cliente quedó cargado y la visita ya cuenta. Elegí el resultado y tocá <b>Guardar visita</b> para completarla.</Aviso>}
      <CapturaGps gps={gps} destino={destino} />
      {lejos && <Aviso tipo="alerta">Estás lejos de donde figura el cliente. Si está acá, al guardar te preguntamos si corregimos la ubicación.</Aviso>}

      <div>
        <Etiqueta htmlFor="resultado">Resultado</Etiqueta>
        <Selector id="resultado" required value={resultadoId} onChange={(e) => setResultadoId(e.target.value)}>
          <option value="">Elegí…</option>
          {opciones.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </Selector>
      </div>

      {tipoResultado === 'medica' && productos.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Productos presentados y muestras</legend>
          {productos.map((pr) => {
            const marcado = pr.nombre in muestras
            return (
              <div key={pr.id} className="flex items-center gap-3">
                <label className="flex flex-1 items-center gap-3 text-base">
                  <input type="checkbox" className="size-5 accent-[var(--c-marca)]" checked={marcado}
                    onChange={(e) => setMuestras((m) => { const n = { ...m }; if (e.target.checked) n[pr.nombre] = null; else delete n[pr.nombre]; return n })} />
                  {pr.nombre}
                </label>
                {marcado && (
                  <Entrada aria-label={`Muestras de ${pr.nombre}`} className="w-24" inputMode="numeric" pattern="[0-9]*" placeholder="Muestras"
                    value={muestras[pr.nombre] ?? ''} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setMuestras((m) => ({ ...m, [pr.nombre]: v ? Number(v) : null })) }} />
                )}
              </div>
            )
          })}
        </fieldset>
      )}

      {tipoResultado === 'ventas' && <div className="flex flex-col gap-3">
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
      </div>}

      <div>
        <Etiqueta htmlFor="obs">Observaciones</Etiqueta>
        <AreaTexto id="obs" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Qué pasó, qué necesita, a quién ver la próxima vez…" />
      </div>

      <div>
        <Etiqueta htmlFor="proxima">Próxima visita</Etiqueta>
        <Entrada id="proxima" type="date" min={hoyIso()} value={proxima} onChange={(e) => setProxima(e.target.value)} />
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium">{esMedica ? 'Foto (opcional)' : 'Foto de la fachada (opcional)'}</span>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-borde px-3 py-3 text-sm">
          <Camera className="size-5 text-marca" aria-hidden />
          {foto ? foto.name : 'Sacar o elegir foto'}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
        </label>
      </div>

      {error && <Aviso tipo="error">{error}</Aviso>}
      <Boton type="submit" grande disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar visita'}</Boton>
      {enviando && <p className="text-center text-sm text-tenue">Si no hay señal, en unos segundos queda guardada en el celular y se sube sola después.</p>}
      {!gps.lectura && !gps.leyendo && <p className="text-center text-xs text-tenue">Se puede guardar sin GPS, pero no queda la ubicación de la visita.</p>}
    </form>
  )
}
