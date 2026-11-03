'use client'
// Invitación para entrar a la app: llega por correo (desde la cuenta de envío de la empresa).
// WhatsApp y Copiar quedan como respaldo, con el mismo texto.
import { useState, useTransition } from 'react'
import { Check, Copy, Mail, MessageCircle } from 'lucide-react'
import { enviarInvitacion } from '@/app/(admin)/vendedores/acciones'
import { telWhatsApp, textoInvitacion, type Invitado } from '@/lib/invitacion'

// compacto: solo íconos (en la tabla de Usuarios), con el texto en el tooltip.
export function Invitacion({ id, v, empresa, compacto = false }: { id: string; v: Invitado; empresa?: string; compacto?: boolean }) {
  const [estado, setEstado] = useState<'listo' | 'enviada' | 'error'>('listo')
  const [error, setError] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [enviando, iniciar] = useTransition()
  const texto = () => textoInvitacion(v, empresa, window.location.origin)
  const boton = compacto
    ? 'grid size-8 place-items-center rounded-md border border-borde bg-superficie hover:bg-fondo disabled:opacity-60'
    : 'inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-borde bg-superficie px-2 py-1 text-xs font-medium hover:bg-fondo disabled:opacity-60'

  function enviar() {
    setError(null)
    iniciar(async () => {
      const r = await enviarInvitacion(id)
      if ('ok' in r) setEstado('enviada')
      else { setEstado('error'); setError(r.error) }
    })
  }

  return (
    <div className={compacto ? '' : 'mt-1'}>
      <div className={`flex gap-1 ${compacto ? 'flex-nowrap' : 'flex-wrap'}`} aria-label={`Invitar a ${v.nombre}`}>
        <button type="button" className={`${boton} ${estado === 'enviada' ? 'text-green-700 dark:text-green-300' : ''}`} disabled={enviando}
          title={estado === 'enviada' ? `Invitación enviada a ${v.email}` : `Mandar la invitación a ${v.email}`} aria-label={estado === 'enviada' ? 'Invitación enviada' : 'Enviar invitación'} onClick={enviar}>
          {estado === 'enviada' ? <Check className="size-3.5" aria-hidden /> : <Mail className={`size-3.5 ${enviando ? 'animate-pulse' : ''}`} aria-hidden />}
          {!compacto && (enviando ? 'Enviando…' : estado === 'enviada' ? 'Invitación enviada' : 'Enviar invitación')}
        </button>
        <button type="button" className={boton} title={v.telefono ? `WhatsApp a ${v.telefono}` : 'WhatsApp (elegís el contacto)'} aria-label="Invitar por WhatsApp"
          onClick={() => window.open(`https://wa.me/${telWhatsApp(v.telefono)}?text=${encodeURIComponent(texto())}`, '_blank', 'noopener')}>
          <MessageCircle className="size-3.5" aria-hidden />{!compacto && ' WhatsApp'}
        </button>
        <button type="button" className={boton} title="Copiar el mensaje" aria-label="Copiar el mensaje"
          onClick={() => void navigator.clipboard.writeText(texto()).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000) })}>
          {copiado ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}{!compacto && (copiado ? ' Copiado' : ' Copiar')}
        </button>
      </div>
      {error && <p className="mt-1 max-w-72 text-xs text-red-700 dark:text-red-300" role="alert">{error}</p>}
    </div>
  )
}
