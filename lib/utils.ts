import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...v: ClassValue[]) => twMerge(clsx(v))

function textoError(e: unknown): string {
  if (!e) return 'Error desconocido'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return String(e)
}

/** Sin señal, o tan débil que no hubo respuesta a tiempo (ver lib/supabase/client.ts). */
export const esErrorDeRed = (e: unknown) => /failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout|timed out|aborted|sin respuesta/i.test(textoError(e))

/** Mensaje legible de un error de Supabase/Postgres (los RAISE de la base ya vienen en español). */
export function mensajeError(e: unknown): string {
  if (esErrorDeRed(e)) return 'Sin señal o señal muy débil: probá de nuevo cuando tengas conexión.'
  return textoError(e)
}

export const linkWhatsApp = (telNorm: string | null | undefined) => (telNorm ? `https://wa.me/${telNorm}` : null)
export const linkTel = (tel: string | null | undefined) => (tel ? `tel:${tel.replace(/[^\d+]/g, '')}` : null)

/** Tema de colores según la empresa ("Camping 44" → "camping44"); ver globals.css. */
export function temaEmpresa(nombre: string | null | undefined): string | undefined {
  const t = (nombre ?? '').normalize('NFD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  return t || undefined
}
