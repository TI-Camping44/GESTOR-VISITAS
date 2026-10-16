'use server'
// Invitación por correo: la manda un admin, solo a gente que gestiona (su empresa; TI, a todos).
import { headers } from 'next/headers'
import { supabaseServidor } from '@/lib/supabase/server'
import { enviarCorreo } from '@/lib/correo'
import { pasosInvitacion, textoInvitacion } from '@/lib/invitacion'
import { mensajeError, temaEmpresa } from '@/lib/utils'

const COLOR: Record<string, string> = { camping44: '#d90000', vitalica: '#d9640a' }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export async function enviarInvitacion(vendedorId: string): Promise<{ ok: true } | { error: string }> {
  try {
    const sb = await supabaseServidor()
    const { data: esAdmin } = await sb.rpc('vis_es_admin')
    if (!esAdmin) return { error: 'Solo un admin puede mandar invitaciones.' }

    const { data: v } = await sb.from('vis_vendedores').select('nombre, email, rol, telefono, activo, empresa_id, multi_empresa').eq('id', vendedorId).maybeSingle()
    if (!v) return { error: 'No se encontró a esa persona.' }
    if (!v.activo) return { error: `${v.nombre} está inactivo: activalo antes de invitarlo.` }
    const [{ data: miEmpresa }, { data: soyTI }] = await Promise.all([sb.rpc('vis_mi_empresa'), sb.rpc('vis_soy_admin_multi')])
    if (!soyTI && v.empresa_id !== miEmpresa) return { error: `${v.nombre} es de otra empresa: lo invita su admin.` }

    const { data: miId } = await sb.rpc('vis_mi_id')
    const [{ data: empresas }, { data: yo }] = await Promise.all([
      sb.from('vis_empresas').select('id, nombre').order('created_at'),
      sb.from('vis_vendedores').select('nombre, email').eq('id', miId ?? '').maybeSingle(),
    ])

    const h = await headers()
    const origen = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`
    // Quien tiene acceso a todas: "Camping 44 y Vitalica"; si no, su empresa.
    const nombreEmpresa = (v.multi_empresa ? (empresas ?? []).map((e) => e.nombre).join(' y ') : empresas?.find((e) => e.id === v.empresa_id)?.nombre) || null
    const origenEmpresa = empresas?.find((e) => e.id === v.empresa_id)?.nombre ?? null
    const color = COLOR[temaEmpresa(origenEmpresa) ?? ''] ?? '#262626'
    const pasos = pasosInvitacion(v, origen)

    const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#141414">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${color};color:#ffffff;padding:18px 24px;font-size:13px;letter-spacing:1px;text-transform:uppercase;font-weight:bold">${esc(nombreEmpresa ?? 'Visitas y Rutas')}</td></tr>
<tr><td style="padding:24px">
<p style="font-size:20px;font-weight:bold;margin:0 0 12px">Hola ${esc(v.nombre.split(' ')[0] ?? v.nombre)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 16px">Ya tenés acceso a <b>Visitas y Rutas</b>${nombreEmpresa ? ` de ${esc(nombreEmpresa)}` : ''}.</p>
<ol style="font-size:15px;line-height:1.6;padding-left:20px;margin:0 0 20px">${pasos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
<p style="margin:0 0 20px"><a href="${esc(origen)}/login" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">Entrar a la app</a></p>
<p style="font-size:13px;color:#666666;margin:0">Cualquier duda, respondé este correo${yo ? ` (${esc(yo.nombre)})` : ''}.</p>
</td></tr></table></td></tr></table></body></html>`

    await enviarCorreo({
      para: v.email,
      asunto: `Tu acceso a Visitas y Rutas${nombreEmpresa ? ` · ${nombreEmpresa}` : ''}`,
      texto: textoInvitacion(v, nombreEmpresa, origen),
      html,
      responderA: yo?.email,
      nombreRemitente: `Visitas y Rutas${nombreEmpresa ? ` · ${nombreEmpresa}` : ''}`,
    })
    return { ok: true }
  } catch (e) {
    if ((e as { code?: string })?.code === 'EAUTH') return { error: 'Gmail rechazó la cuenta de envío: revisá SMTP_USER y la contraseña de aplicación (SMTP_PASS) en Vercel.' }
    return { error: mensajeError(e) }
  }
}
