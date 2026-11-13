'use client'
// Aviso antes de salir de un formulario con datos sin guardar (visita, alta de cliente, médico, lugar).
// Cubre recargar o cerrar la pestaña (beforeunload), los links de la app (menú de abajo, «Cómo llegar»…)
// y el botón «Volver» (que pregunta con puedeSalir()).
import { useEffect } from 'react'

const MENSAJE = 'Tenés datos sin guardar en esta pantalla. ¿Salir igual?'
let sucioActual = false

/** Para botones que navegan sin ser un link (por ejemplo «Volver»): pregunta si hay datos sin guardar. */
export function puedeSalir() {
  return !sucioActual || window.confirm(MENSAJE)
}

export function useAvisoSinGuardar(sucio: boolean) {
  useEffect(() => {
    if (!sucio) return
    sucioActual = true
    const alSalir = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    const alClic = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return // tel:, WhatsApp, Google Maps: no salen de la app
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      if (!window.confirm(MENSAJE)) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('beforeunload', alSalir)
    document.addEventListener('click', alClic, true)
    return () => {
      sucioActual = false
      window.removeEventListener('beforeunload', alSalir)
      document.removeEventListener('click', alClic, true)
    }
  }, [sucio])
}
