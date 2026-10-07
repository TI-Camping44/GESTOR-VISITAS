'use client'
// Estado compartido de las pantallas del vendedor: perfil, jornada, cola offline y señal.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabaseNavegador } from '@/lib/supabase/client'
import { tracker } from '@/lib/tracking/tracker'
import { contarPendientes } from '@/lib/offline/db'
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

  const refrescarPendientes = useCallback(async () => {
    setPendientes(await contarPendientes().catch(() => ({ visitas: 0, posiciones: 0 })))
  }, [])

  const subir = useCallback(async () => {
    const r = await subirPendientes().catch((e) => ({ visitas: 0, posiciones: 0, errores: [mensajeError(e)] }))
    setErrores(r.errores)
    await refrescarPendientes()
  }, [refrescarPendientes])

  // Jornada abierta al entrar: si hay, el tracking sigue.
  useEffect(() => {
    let vivo = true
    supabaseNavegador().from('vis_jornadas').select('*').eq('vendedor_id', inicial.id).is('fin', null).maybeSingle()
      .then(({ data }) => {
        if (!vivo) return
        setJornada(data)
        if (data) tracker.iniciar()
        setCargando(false)
      })
    return () => { vivo = false }
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
    tracker.iniciar()
  }, [])

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
    await refrescarPendientes()
  }, [subir, refrescarPendientes])

  return (
    <Contexto.Provider value={{ perfil, jornada, cargandoJornada, pendientes, enLinea, erroresSubida, iniciarJornada, terminarJornada, aceptarAviso, refrescarPendientes }}>
      {children}
    </Contexto.Provider>
  )
}
