import { redirect } from 'next/navigation'
import { requerirPerfil } from '@/lib/sesion'

export default async function Inicio() {
  const perfil = await requerirPerfil()
  redirect(perfil.rol === 'vendedor' ? '/hoy' : '/tablero')
}
