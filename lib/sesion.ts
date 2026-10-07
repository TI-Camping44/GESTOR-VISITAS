import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { supabaseServidor } from '@/lib/supabase/server'
import type { Perfil } from '@/lib/database.types'

/** Usuario de la app, o null si el email no tiene acceso. Vincula auth_user_id al primer login. */
export const obtenerPerfil = cache(async (): Promise<{ autenticado: boolean; perfil: Perfil | null }> => {
  const supabase = await supabaseServidor()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { autenticado: false, perfil: null }
  const { data, error } = await supabase.rpc('vis_vincular_usuario')
  if (error) throw new Error(`No se pudo verificar el acceso: ${error.message}`)
  return { autenticado: true, perfil: (data as Perfil | null) ?? null }
})

export async function requerirPerfil(): Promise<Perfil> {
  const { autenticado, perfil } = await obtenerPerfil()
  if (!autenticado) redirect('/login')
  if (!perfil) redirect('/sin-acceso')
  return perfil
}

export async function requerirSupervisor(): Promise<Perfil> {
  const perfil = await requerirPerfil()
  if (perfil.rol === 'vendedor') redirect('/hoy')
  return perfil
}
