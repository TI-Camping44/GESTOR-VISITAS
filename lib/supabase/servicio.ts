import 'server-only'
// Cliente con la service_role: salta el RLS. Solo para la sincronización con Odoo (servidor).
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { SUPABASE_URL } from '@/lib/config'

export function supabaseServicio() {
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!clave) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en Vercel.')
  return createClient<Database>(SUPABASE_URL, clave, { auth: { persistSession: false, autoRefreshToken: false } })
}
