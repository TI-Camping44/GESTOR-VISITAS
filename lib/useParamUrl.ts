'use client'
// Estado chico de una pantalla (filtros, pestaña, página) guardado en la URL: se puede recargar,
// volver atrás o pasar el link y queda igual. Usa history.replaceState, que Next sincroniza con
// useSearchParams sin volver a pedir la página: funciona igual sin señal.
import { useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

export function useParamUrl<T extends string = string>(clave: string, porDefecto: NoInfer<T>): [T, (v: T) => void] {
  const sp = useSearchParams()
  const valor = (sp.get(clave) ?? porDefecto) as T
  const cambiar = useCallback((v: T) => {
    const p = new URLSearchParams(window.location.search)
    if (v === porDefecto || v === '') p.delete(clave)
    else p.set(clave, v)
    const qs = p.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`)
  }, [clave, porDefecto])
  return [valor, cambiar]
}
