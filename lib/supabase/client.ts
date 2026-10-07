'use client'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config'

let cliente: ReturnType<typeof createBrowserClient<Database>> | null = null

export function supabaseNavegador() {
  cliente ??= createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
  return cliente
}
