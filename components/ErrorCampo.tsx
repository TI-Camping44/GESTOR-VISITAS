'use client'
// Error de validación al lado del campo: el mensaje queda debajo, el campo se marca en rojo
// (aria-invalid) y recibe el foco, así se ve qué corregir sin buscar el error al pie del formulario.
import { useCallback, useState } from 'react'

export function useErrorCampo() {
  const [err, setErr] = useState<{ id: string; msg: string } | null>(null)
  const marcar = useCallback((id: string, msg: string) => {
    setErr({ id, msg })
    requestAnimationFrame(() => {
      const el = document.getElementById(id)
      if (!el) return
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    })
  }, [])
  const limpiar = useCallback(() => setErr(null), [])
  /** Props para el campo: lo marca inválido y borra el error cuando se corrige. */
  const campo = (id: string) => ({
    'aria-invalid': err?.id === id ? true : undefined,
    'aria-describedby': err?.id === id ? `${id}-error` : undefined,
    onInput: err?.id === id ? limpiar : undefined,
  })
  const mensaje = (id: string) => (err?.id === id
    ? <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-medium text-red-700 dark:text-red-300">{err.msg}</p>
    : null)
  return { marcar, limpiar, campo, mensaje }
}
