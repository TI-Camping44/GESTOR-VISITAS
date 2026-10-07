import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...v: ClassValue[]) => twMerge(clsx(v))

/** Mensaje legible de un error de Supabase/Postgres (los RAISE de la base ya vienen en español). */
export function mensajeError(e: unknown): string {
  if (!e) return 'Error desconocido'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return String(e)
}

export const linkWhatsApp = (telNorm: string | null | undefined) => (telNorm ? `https://wa.me/${telNorm}` : null)
export const linkTel = (tel: string | null | undefined) => (tel ? `tel:${tel.replace(/[^\d+]/g, '')}` : null)
