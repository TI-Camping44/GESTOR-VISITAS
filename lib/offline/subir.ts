'use client'
// Sube lo que quedó en la cola. Idempotente del lado de la base: reintentar nunca duplica.
import { abrir, type PosicionPendiente, type VisitaPendiente } from './db'
import { supabaseNavegador } from '@/lib/supabase/client'
import { mensajeError } from '@/lib/utils'

const LOTE_POSICIONES = 500
let enCurso: Promise<ResultadoSubida> | null = null

export type ResultadoSubida = { visitas: number; posiciones: number; errores: string[] }

/** Los errores de red se reintentan; los rechazos de la base (validación) quedan marcados. */
const esErrorDeRed = (e: unknown) => /fetch|network|Failed to fetch|Load failed|timeout/i.test(mensajeError(e))

export async function encolarVisita(v: VisitaPendiente) {
  await (await abrir()).put('visitas', v)
}

export async function encolarPosiciones(ps: PosicionPendiente[]) {
  const d = await abrir()
  const tx = d.transaction('posiciones', 'readwrite')
  await Promise.all([...ps.map((p) => tx.store.put(p)), tx.done])
}

export function subirPendientes(): Promise<ResultadoSubida> {
  enCurso ??= (async () => {
    const r: ResultadoSubida = { visitas: 0, posiciones: 0, errores: [] }
    if (typeof navigator !== 'undefined' && !navigator.onLine) return r
    const supabase = supabaseNavegador()
    const d = await abrir()

    // Posiciones primero: las visitas se ubican dentro de la jornada.
    for (;;) {
      const lote = (await d.getAll('posiciones')).sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora)).slice(0, LOTE_POSICIONES)
      if (!lote.length) break
      const { error } = await supabase.rpc('vis_subir_posiciones', { p: lote })
      if (error) {
        r.errores.push(`Posiciones: ${mensajeError(error)}`)
        break
      }
      const tx = d.transaction('posiciones', 'readwrite')
      await Promise.all([...lote.map((p) => tx.store.delete(p.fecha_hora)), tx.done])
      r.posiciones += lote.length
      if (lote.length < LOTE_POSICIONES) break
    }

    for (const v of await d.getAll('visitas')) {
      const { error } = await supabase.rpc('vis_registrar_visita', { p: v.payload as never })
      if (!error) {
        await d.delete('visitas', v.client_uuid)
        r.visitas++
      } else if (esErrorDeRed(error)) {
        break
      } else {
        await d.put('visitas', { ...v, intentos: v.intentos + 1, error: mensajeError(error) })
        r.errores.push(`${v.nombreCliente}: ${mensajeError(error)}`)
      }
    }
    return r
  })().finally(() => { enCurso = null })
  return enCurso
}
