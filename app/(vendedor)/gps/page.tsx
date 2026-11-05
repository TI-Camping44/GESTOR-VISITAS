'use client'
// GPS en segundo plano: cómo instalar y configurar Traccar Client para que el recorrido de la jornada
// se registre completo aunque el celular esté bloqueado. Solo se guarda con la jornada abierta.
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Copy, Satellite } from 'lucide-react'
import { useVendedor } from '@/components/vendedor/Proveedor'
import { Aviso, Boton, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { hace } from '@/lib/fechas'
import { mensajeError } from '@/lib/utils'

type Gps = { codigo?: string; ultima_recibida_el: string | null; ultima_posicion_el: string | null }
const PLAY = 'https://play.google.com/store/apps/details?id=org.traccar.client'
const APPLE = 'https://apps.apple.com/app/traccar-client/id843156974'

function Copiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-borde bg-fondo px-3 py-2 text-sm">{texto}</code>
      <button type="button" aria-label={`Copiar ${etiqueta}`} className="grid size-10 shrink-0 place-items-center rounded-lg border border-borde"
        onClick={() => { void navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) }) }}>
        {ok ? <CheckCircle2 className="size-4 text-green-600" /> : <Copy className="size-4" />}
      </button>
    </div>
  )
}

export default function PaginaGps() {
  const { perfil, soloLectura } = useVendedor()
  const [gps, setGps] = useState<Gps | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [servidor, setServidor] = useState('')

  const cargar = useCallback(async (nuevo = false) => {
    const sb = supabaseNavegador()
    // Mirando la app de otro: solo el estado, sin crear ni mostrar códigos.
    if (soloLectura) {
      const { data } = await sb.from('vis_gps_dispositivos').select('ultima_recibida_el, ultima_posicion_el').eq('vendedor_id', perfil.id).maybeSingle()
      return setGps(data ?? { ultima_recibida_el: null, ultima_posicion_el: null })
    }
    const { data, error: e } = await sb.rpc('vis_mi_gps', { p_nuevo: nuevo })
    if (e) return setError(navigator.onLine ? mensajeError(e) : 'Necesitás señal para ver tu código.')
    setGps(data as Gps)
  }, [perfil.id, soloLectura])
  useEffect(() => { setServidor(`${location.origin}/api/gps`); void cargar() }, [cargar])

  const activo = gps?.ultima_recibida_el && Date.now() - Date.parse(gps.ultima_recibida_el) < 15 * 60000
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Satellite className="size-5 text-marca" aria-hidden /> GPS en segundo plano</h1>
        <p className="text-sm text-tenue">Con el celular bloqueado, esta app deja de registrar tu recorrido. La app gratuita <b>Traccar Client</b> lo registra igual. Solo se guarda <b>mientras tu jornada está abierta</b>, igual que el resto, y Traccar muestra un aviso fijo en la barra del celular mientras está prendido.</p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {gps && (
        <Aviso tipo={activo ? 'ok' : 'alerta'}>
          {gps.ultima_recibida_el ? <>Último envío de Traccar: <b>{hace(gps.ultima_recibida_el)}</b>.{!activo && ' Revisá que Traccar esté prendido.'}</> : 'Todavía no llegó nada de Traccar a este celular.'}
        </Aviso>
      )}
      {!soloLectura && gps?.codigo && (
        <>
          <Tarjeta className="flex flex-col gap-2">
            <p className="font-semibold">1. Instalá Traccar Client</p>
            <div className="flex flex-wrap gap-2">
              <a href={PLAY} target="_blank" rel="noreferrer"><Boton variante="secundario">Android (Play Store)</Boton></a>
              <a href={APPLE} target="_blank" rel="noreferrer"><Boton variante="secundario">iPhone (App Store)</Boton></a>
            </div>
          </Tarjeta>
          <Tarjeta className="flex flex-col gap-3">
            <p className="font-semibold">2. En Traccar, completá</p>
            <div className="flex flex-col gap-1"><p className="text-sm">Identificador del dispositivo:</p><Copiar texto={gps.codigo} etiqueta="identificador" /></div>
            <div className="flex flex-col gap-1"><p className="text-sm">URL del servidor:</p><Copiar texto={servidor} etiqueta="dirección del servidor" /></div>
            <ul className="list-disc pl-5 text-sm">
              <li>Precisión: <b>alta</b>.</li>
              <li>Frecuencia (intervalo): <b>60</b> segundos.</li>
            </ul>
          </Tarjeta>
          <Tarjeta className="flex flex-col gap-2">
            <p className="font-semibold">3. Permisos y encendido</p>
            <ul className="list-disc pl-5 text-sm">
              <li>Ubicación: <b>Permitir todo el tiempo</b>.</li>
              <li>Batería: elegí <b>Sin restricciones</b> (o «No optimizar») para Traccar, así Android no la cierra.</li>
              <li>Prendé el <b>servicio</b> (el interruptor de arriba en Traccar) y dejalo prendido.</li>
            </ul>
            <p className="text-sm text-tenue">Listo: volvé acá con la jornada iniciada y en un par de minutos tiene que decir «Último envío de Traccar: recién».</p>
          </Tarjeta>
          <button type="button" className="self-start text-sm text-tenue underline" onClick={() => { if (confirm('¿Cambiar el código? El anterior deja de funcionar y hay que cargar el nuevo en Traccar.')) void cargar(true) }}>Cambiar el código</button>
        </>
      )}
    </div>
  )
}
