// GPS en segundo plano: recibe las posiciones de Traccar Client (manual «GPS en segundo plano»).
// El vendedor configura en Traccar esta dirección y su código (pantalla /gps de la app).
// Se guardan solo mientras su jornada está abierta (vis_gps_recibir). Sin sesión: lo autoriza el código.
import { supabaseServicio } from '@/lib/supabase/servicio'
import { leerEnvioGps } from '@/lib/gpsExterno'
import type { Json } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

async function recibir(req: Request) {
  const url = new URL(req.url)
  const params = new URLSearchParams(url.search)
  let cuerpo: unknown = null
  if (req.method === 'POST') {
    const texto = await req.text().catch(() => '')
    if (texto) {
      try { cuerpo = JSON.parse(texto) } catch {
        // OsmAnd por formulario: id=…&lat=…
        new URLSearchParams(texto).forEach((v, k) => { if (!params.has(k)) params.set(k, v) })
      }
    }
  }
  const { codigo, puntos } = leerEnvioGps(params, cuerpo)
  if (!codigo) return new Response('Falta el identificador del dispositivo', { status: 400 })
  if (puntos.length === 0) return new Response('OK') // latido sin posición
  try {
    const { data, error } = await supabaseServicio().rpc('vis_gps_recibir', { p_codigo: codigo, p: puntos as unknown as Json })
    if (error) { console.error('GPS', error.message); return new Response('Error', { status: 500 }) }
    if (data == null) return new Response('Identificador desconocido: revisá el código en la app (Configurar GPS)', { status: 403 })
    return new Response('OK')
  } catch (e) {
    console.error('GPS', e)
    return new Response('Error', { status: 500 })
  }
}

export const GET = recibir
export const POST = recibir
