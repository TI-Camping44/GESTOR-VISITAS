'use client'
// Invitación para entrar a la app: llega por correo (desde la cuenta de envío de la empresa).
// WhatsApp y Copiar quedan como respaldo, con el mismo texto.
import { useState, useTransition } from 'react'
import { Check, Copy, Mail, MessageCircle } from 'lucide-react'
import { enviarInvitacion } from '@/app/(admin)/vendedores/acciones'
import { telWhatsApp, textoInvitacion, type Invitado } from '@/lib/invitacion'

export function Invitacion({ id, v, empresa }: { id: string; v: Invitado; empresa?: string }) {
  const [estado, setEstado] = useState<'listo' | 'enviada' | 'error'>('listo')
  const [error, setError] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [enviando, iniciar] = useTransition()
  const texto = () => textoInvitacion(v, empresa, window.location.origin)
  const boton = 'inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-borde bg-superficie px-2 py-1 text-xs font-medium hover:bg-fondo disabled:opacity-60'

  function enviar() {
    setError(null)
    iniciar(async () => {
      const r = await enviarInvitacion(id)
      if ('ok' in r) setEstado('enviada')
      else { setEstado('error'); setError(r.error) }
    })
  }

  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-1" aria-label={`Invitar a ${v.nombre}`}>
        <button type="button" className={`${boton} ${estado === 'enviada' ? 'text-green-700 dark:text-green-300' : ''}`} disabled={enviando}
          title={`Mandar la invitación a ${v.email}`} onClick={enviar}>
          {estado === 'enviada' ? <Check className="size-3.5" aria-hidden /> : <Mail className="size-3.5" aria-hidden />}
          {enviando ? 'Enviando…' : estado === 'enviada' ? 'Invitación enviada' : 'Enviar invitación'}
        </button>
        <button type="button" className={boton} title={v.telefono ? `WhatsApp a ${v.telefono}` : 'WhatsApp (elegís el contacto)'}
          onClick={() => window.open(`https://wa.me/${telWhatsApp(v.telefono)}?text=${encodeURIComponent(texto())}`, '_blank', 'noopener')}>
          <MessageCircle className="size-3.5" aria-hidden /> WhatsApp
        </button>
        <button type="button" className={boton} title="Copiar el mensaje"
          onClick={() => void navigator.clipboard.writeText(texto()).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000) })}>
          {copiado ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />} {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      {error && <p className="mt-1 max-w-72 text-xs text-red-700 dark:text-red-300" role="alert">{error}</p>}
    </div>
  )
}
