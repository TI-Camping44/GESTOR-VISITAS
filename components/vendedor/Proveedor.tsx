'use client'
// Estado compartido de las pantallas del vendedor: perfil, jornada, cola offline y señal.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabaseNavegador } from '@/lib/supabase/client'
import { tracker } from '@/lib/tracking/tracker'
import { contarPendientes, guardarCache, leerCache } from '@/lib/offline/db'
import { subirPendientes } from '@/lib/offline/subir'
import { leerGps, nivelBateria } from '@/lib/gps'
import { mensajeError } from '@/lib/utils'
import type { Jornada, Perfil } from '@/lib/database.types'

type Ctx = {
  perfil: Perfil
  jornada: Jornada | null
  cargandoJornada: boolean
  pendientes: { visitas: number; posiciones: number }
  enLinea: boolean
  erroresSubida: string[]
  iniciarJornada: () => Promise<void>
  terminarJornada: () => Promise<void>
  aceptarAviso: () => Promise<void>
  refrescarPendientes: () => Promise<void>
  /** Nombre del vendedor de un cliente (null si no tiene; 'otro vendedor' si no es visible). */
  nombreVendedor: (id: string | null | undefined) => string | null
}

const Contexto = createContext<Ctx | null>(null)

export function useVendedor() {
  const c = useContext(Contexto)
  if (!c) throw new Error('useVendedor fuera de ProveedorVendedor')
  return c
}

export function ProveedorVendedor({ perfil: inicial, children }: { perfil: Perfil; children: ReactNode }) {
  const [perfil, setPerfil] = useState(inicial)
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [cargandoJornada, setCargando] = useState(true)
  const [pendientes, setPendientes] = useState({ visitas: 0, posiciones: 0 })
  const [enLinea, setEnLinea] = useState(true)
  const [erroresSubida, setErrores] = useState<string[]>([])
  const [vendedores, setVendedores] = useState<Record<string, string>>({})

  const refrescarPendientes = useCallback(async () => {
    setPendientes(await contarPendientes().catch(() => ({ visitas: 0, posiciones: 0 })))
  }, [])

  const subir = useCallback(async () => {
    const r = await subirPendientes().catch((e) => ({ visitas: 0, posiciones: 0, errores: [mensajeError(e)] }))
    setErrores(r.errores)
    await refrescarPendientes()
  }, [refrescarPendientes])

  // Jornada abierta al entrar: si hay, el tracking sigue. Sin señal, la última conocida.
  useEffect(() => {
    let vivo = true
    const clave = `jornada:${inicial.id}`
    ;(async () => {
      const cache = await leerCache<Jornada | null>(clave).catch(() => null)
      if (cache && vivo) {
        setJornada(cache.datos)
        if (cache.datos) tracker.iniciar()
        setCargando(false)
      }
      const { data, error } = await supabaseNavegador().from('vis_jornadas').select('*').eq('vendedor_id', inicial.id).is('fin', null).maybeSingle()
      if (!vivo) return
      if (!error) {
        setJornada(data)
        if (data) tracker.iniciar()
        void guardarCache(clave, data).catch(() => {})
      }
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [inicial.id])

  // Nombres de los vendedores (para avisar cuando un cliente es de otro). Sin señal, los guardados.
  useEffect(() => {
    let vivo = true
    void leerCache<Record<string, string>>('vendedores').then((c) => { if (c && vivo) setVendedores(c.datos) }).catch(() => {})
    void supabaseNavegador().from('vis_vendedores').select('id, nombre').then(({ data }) => {
      if (!data || !vivo) return
      const m = Object.fromEntries(data.map((v) => [v.id, v.nombre]))
      setVendedores(m)
      void guardarCache('vendedores', m).catch(() => {})
    })
    return () => { vivo = false }
  }, [])
  const nombreVendedor = useCallback((id: string | null | undefined) => (id ? vendedores[id] ?? 'otro vendedor' : null), [vendedores])

  // Con señal: guarda en el celular la cartera y los resultados (para registrar visitas sin señal
  // a cualquier cliente propio) y las pantallas de la app con lo que necesitan para abrir (public/sw.js).
  useEffect(() => {
    if (!navigator.onLine) return
    const sb = supabaseNavegador()
    void sb.from('vis_clientes_v').select('id, razon_social, ciudad, direccion, lat, lng, estado')
      .eq('vendedor_id', inicial.id).limit(3000)
      .then(({ data }) => { if (data) void guardarCache(`cartera:${inicial.id}`, data).catch(() => {}) })
    void sb.from('vis_resultados').select('*').eq('activo', true).order('orden')
      .then(({ data }) => { if (data?.length) void guardarCache('resultados', data).catch(() => {}) })
    if (!('serviceWorker' in navigator)) return
    const clave = 'vis-precarga'
    try { if (Date.now() - Number(localStorage.getItem(clave) ?? 0) < 6 * 3600_000) return } catch { /* sin almacenamiento: igual precarga */ }
    void navigator.serviceWorker.ready.then((reg) => {
      reg.active?.postMessage({ tipo: 'precargar', urls: ['/hoy', '/visitas', '/mapa', '/prospecto/nuevo', '/visita', '/offline'] })
      try { localStorage.setItem(clave, String(Date.now())) } catch { /* nada */ }
    })
  }, [inicial.id])

  // Señal, cola y subida periódica (las visitas offline se suben aunque no haya jornada).
  useEffect(() => {
    setEnLinea(navigator.onLine)
    const on = () => { setEnLinea(true); void subir() }
    const off = () => setEnLinea(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const t = setInterval(() => void subir(), 2 * 60 * 1000)
    const quitar = tracker.suscribir(() => void refrescarPendientes())
    void subir()
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t); quitar() }
  }, [subir, refrescarPendientes])

  const aceptarAviso = useCallback(async () => {
    const { data, error } = await supabaseNavegador().rpc('vis_aceptar_tracking')
    if (error) throw new Error(mensajeError(error))
    setPerfil((p) => ({ ...p, tracking_aceptado_el: data }))
  }, [])

  const iniciarJornada = useCallback(async () => {
    if (!navigator.onLine) throw new Error('Necesitás señal para iniciar la jornada.')
    const gps = await leerGps(15000).catch(() => null) // sin GPS igual se abre
    const { data, error } = await supabaseNavegador().rpc('vis_iniciar_jornada', {
      p_lat: gps?.lat, p_lng: gps?.lng, p_precision: gps?.precision, p_bateria: (await nivelBateria()) ?? undefined,
    })
    if (error) throw new Error(mensajeError(error))
    setJornada(data)
    void guardarCache(`jornada:${inicial.id}`, data).catch(() => {})
    tracker.iniciar()
  }, [inicial.id])

  const terminarJornada = useCallback(async () => {
    if (!navigator.onLine) throw new Error('Necesitás señal para terminar la jornada (para subir el recorrido).')
    await subir()
    const gps = await leerGps(10000).catch(() => null)
    const { error } = await supabaseNavegador().rpc('vis_terminar_jornada', {
      p_lat: gps?.lat, p_lng: gps?.lng, p_precision: gps?.precision, p_bateria: (await nivelBateria()) ?? undefined,
    })
    if (error) throw new Error(mensajeError(error))
    await tracker.detener()
    setJornada(null)
    void guardarCache(`jornada:${inicial.id}`, null).catch(() => {})
    await refrescarPendientes()
  }, [subir, refrescarPendientes, inicial.id])

  return (
    <Contexto.Provider value={{ perfil, jornada, cargandoJornada, pendientes, enLinea, erroresSubida, iniciarJornada, terminarJornada, aceptarAviso, refrescarPendientes, nombreVendedor }}>
      {children}
    </Contexto.Provider>
  )
}
