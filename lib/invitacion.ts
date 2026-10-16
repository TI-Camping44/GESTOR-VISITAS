// Texto de la invitación para entrar a la app (lo usan el correo y el botón de WhatsApp).
import type { Vendedor } from '@/lib/database.types'

export type Invitado = Pick<Vendedor, 'nombre' | 'email' | 'rol' | 'telefono'>

export function pasosInvitacion(v: Invitado, origen: string) {
  return [
    `Abrí ${origen}/login${v.rol === 'vendedor' ? ' desde el celular (Chrome)' : ''}.`,
    `Tocá «Entrar con Google» y elegí tu cuenta ${v.email}.`,
    v.rol === 'vendedor'
      ? 'Para tenerla como app: menú ⋮ → «Agregar a pantalla principal». Cada mañana tocá «Iniciar jornada».'
      : 'Desde la computadora ves el panel: rutas, en vivo y reportes.',
  ]
}

export function textoInvitacion(v: Invitado, empresa: string | null | undefined, origen: string) {
  const pasos = pasosInvitacion(v, origen).map((p, i) => `${i + 1}. ${p}`).join('\n')
  return `Hola ${v.nombre.split(' ')[0]}: ya tenés acceso a Visitas y Rutas${empresa ? ` de ${empresa}` : ''}.\n\n${pasos}\n\nCualquier duda avisame.`
}

// Teléfono de Paraguay a formato wa.me: 0981 123 456 → 595981123456.
export function telWhatsApp(tel: string | null | undefined) {
  const d = (tel ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('595')) return d
  if (d.startsWith('0')) return `595${d.slice(1)}`
  return d.length === 9 ? `595${d}` : d
}
