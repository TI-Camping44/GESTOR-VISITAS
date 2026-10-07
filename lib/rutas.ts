import type { EstadoRuta } from '@/lib/database.types'

export const COLOR_ESTADO_RUTA: Record<EstadoRuta, string> = {
  borrador: 'bg-fondo text-tenue',
  publicada: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200',
  cerrada: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

export const ETIQUETA_ESTADO_RUTA: Record<EstadoRuta, string> = {
  borrador: 'Borrador (el vendedor no la ve)',
  publicada: 'Publicada',
  cerrada: 'Cerrada',
}

/** Cambia el "Sem NN" del nombre al copiar una ruta a otra semana. */
export const renombrarSemana = (nombre: string, semana: number) =>
  /Sem\s*\d+/i.test(nombre) ? nombre.replace(/Sem\s*\d+/i, `Sem ${semana}`) : `${nombre} – Sem ${semana}`
