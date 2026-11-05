'use server'
// Ver la app como un vendedor o la visitadora (solo lectura). Si es de la otra empresa,
// el admin de las dos empresas pasa a esa empresa para ver sus datos.
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabaseServidor } from '@/lib/supabase/server'
import { requerirSupervisor } from '@/lib/sesion'
import { COOKIE_VER_COMO } from '@/lib/verComo'

export async function verComo(formData: FormData) {
  const perfil = await requerirSupervisor()
  const id = String(formData.get('vendedor') ?? '')
  const sb = await supabaseServidor()
  const { data } = await sb.rpc('vis_para_ver_como')
  const elegido = (data ?? []).find((v) => v.id === id)
  if (!elegido) redirect('/ver-como?error=1')
  if (elegido.empresa_id !== perfil.empresa_id) {
    const { error } = await sb.rpc('vis_cambiar_empresa', { p_empresa: elegido.empresa_id })
    if (error) redirect('/ver-como?error=1')
  }
  const store = await cookies()
  store.set(COOKIE_VER_COMO, id, { path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 12 * 3600 })
  redirect('/hoy')
}

export async function dejarDeVer() {
  const store = await cookies()
  store.delete(COOKIE_VER_COMO)
  redirect('/ver-como')
}
