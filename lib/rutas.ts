import type { EstadoRuta } from '@/lib/database.types'

/** Pantalla de registrar visita. Una sola dirección para todos los clientes: funciona sin señal. */
export function urlVisita(clienteId: string, extra: { parada?: string | null; alta?: string | null } = {}) {
  const q = new URLSearchParams({ c: clienteId })
  if (extra.parada) q.set('parada', extra.parada)
  if (extra.alta) q.set('alta', extra.alta)
  return `/visita?${q}`
}

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
