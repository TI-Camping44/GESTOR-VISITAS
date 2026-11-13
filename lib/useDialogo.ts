'use client'
// Panel o diálogo encima de la página: al abrir pone el foco adentro, Esc cierra, Tab no se escapa
// del panel, la página de atrás no se mueve, y al cerrar el foco vuelve a donde estaba.
import { useEffect, useRef, type RefObject } from 'react'

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useDialogo(ref: RefObject<HTMLElement | null>, alCerrar: () => void) {
  const cerrar = useRef(alCerrar)
  cerrar.current = alCerrar
  useEffect(() => {
    const panel = ref.current
    if (!panel) return
    const antes = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.focus()
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cerrar.current(); return }
      if (e.key !== 'Tab') return
      const lista = [...panel.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((x) => x.offsetParent !== null)
      if (!lista.length) return
      const primero = lista[0]!
      const ultimo = lista[lista.length - 1]!
      if (e.shiftKey && (document.activeElement === primero || document.activeElement === panel)) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus() }
    }
    document.addEventListener('keydown', alTeclado)
    return () => {
      document.removeEventListener('keydown', alTeclado)
      document.body.style.overflow = overflow
      antes?.focus?.()
    }
  }, [ref])
}
