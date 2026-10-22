'use server'
// Revisar la conexión con Odoo y sincronizar a mano. Solo un admin.
import { supabaseServidor } from '@/lib/supabase/server'
import { revisarOdoo, sincronizarOdoo, type ResultadoSync, type Revision } from '@/lib/sync/odoo'
import { mensajeError } from '@/lib/utils'

async function soloAdmin() {
  const { data } = await (await supabaseServidor()).rpc('vis_es_admin')
  if (!data) throw new Error('Solo un admin puede usar la conexión con Odoo.')
}

export async function accionRevisar(): Promise<{ ok: true; revision: Revision } | { error: string }> {
  try {
    await soloAdmin()
    return { ok: true, revision: await revisarOdoo() }
  } catch (e) {
    return { error: mensajeError(e) }
  }
}

export async function accionSincronizar(): Promise<ResultadoSync | { error: string }> {
  try {
    await soloAdmin()
    return await sincronizarOdoo()
  } catch (e) {
    return { error: mensajeError(e) }
  }
}
