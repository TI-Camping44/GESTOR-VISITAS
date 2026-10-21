'use client'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config'

// Con señal débil una llamada puede quedar colgada para siempre (la app "no abre", la visita
// queda en "Guardando…"). Con tiempo máximo, falla como sin señal y la visita va a la cola offline.
const ESPERA_MS = 12_000
const ESPERA_ARCHIVOS_MS = 60_000 // fotos
const ESPERA_REPORTES_MS = 30_000 // tablero y reportes del panel, que pueden ser pesados

function fetchConTiempo(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const control = new AbortController()
  let vencido = false
  const ms = url.includes('/storage/v1/') ? ESPERA_ARCHIVOS_MS : /\/rpc\/vis_(reporte|tablero)/.test(url) ? ESPERA_REPORTES_MS : ESPERA_MS
  const t = setTimeout(() => { vencido = true; control.abort() }, ms)
  const externo = init?.signal
  if (externo) {
    if (externo.aborted) control.abort()
    else externo.addEventListener('abort', () => control.abort(), { once: true })
  }
  return fetch(input, { ...init, signal: control.signal })
    .catch((e) => { throw vencido ? new TypeError('Failed to fetch: señal muy débil, sin respuesta') : e })
    .finally(() => clearTimeout(t))
}

let cliente: ReturnType<typeof createBrowserClient<Database>> | null = null

export function supabaseNavegador() {
  cliente ??= createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { fetch: fetchConTiempo } })
  return cliente
}
