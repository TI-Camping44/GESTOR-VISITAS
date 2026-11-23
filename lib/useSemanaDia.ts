'use client'
// Semana del tablero, día de la Actividad y vista (día o semana) en la dirección, siempre de acuerdo:
// si se cambia la semana (flechas del tablero), el día pasa a esa semana; si se cambia el día (flechas o
// calendario de la Actividad), la semana lo sigue. Al entrar con un link que trae solo el día, manda el día.
import { useEffect, useRef } from 'react'
import { useParamUrl } from '@/lib/useParamUrl'
import { hoyIso, lunesDe, sumarDias } from '@/lib/fechas'

export type VistaActividad = 'dia' | 'semana'

/** Día que se muestra al pasar a una semana: hoy si es esta semana; si no, el viernes (o el lunes, si es futura). */
export function diaDeSemana(lunes: string, hoy = hoyIso()) {
  if (hoy >= lunes && hoy <= sumarDias(lunes, 6)) return hoy
  return hoy < lunes ? lunes : sumarDias(lunes, 4)
}

export function useSemanaDia() {
  const hoy = hoyIso()
  const [semana, setSemana] = useParamUrl('semana', lunesDe(hoy))
  const [dia, setDia] = useParamUrl('dia', hoy)
  const [vista, setVista] = useParamUrl<VistaActividad>('vista', 'dia')
  const previo = useRef<{ semana: string; dia: string } | null>(null)

  useEffect(() => {
    const p = previo.current
    previo.current = { semana, dia }
    if (lunesDe(dia) === semana) return
    if (!p) {
      // Primera vez: si el link trae el día y no la semana, la semana es la de ese día. Va en el próximo ciclo:
      // al cargar, el router de Next todavía no escucha los cambios de la dirección.
      const q = new URLSearchParams(window.location.search)
      const t = setTimeout(() => (q.get('dia') && !q.get('semana') ? setSemana(lunesDe(dia)) : setDia(diaDeSemana(semana))), 0)
      return () => clearTimeout(t)
    }
    if (p.semana !== semana) setDia(diaDeSemana(semana))
    else setSemana(lunesDe(dia))
  }, [semana, dia, setSemana, setDia])

  return { semana, setSemana, dia, setDia, vista, setVista, hoy }
}
