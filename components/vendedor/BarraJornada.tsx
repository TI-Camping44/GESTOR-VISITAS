'use client'
// Botón grande de jornada arriba de todo (BRIEF §6 pantalla 0) y el aviso de ubicación del primer uso.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabaseNavegador } from '@/lib/supabase/client'
import { MapPin, WifiOff, CloudUpload } from 'lucide-react'
import { useVendedor } from './Proveedor'
import { Aviso, Boton } from '@/components/ui'
import { fmtSoloHora } from '@/lib/fechas'

export function BarraJornada() {
  const { perfil, jornada, cargandoJornada, pendientes, enLinea, erroresSubida, iniciarJornada, terminarJornada, aceptarAviso, soloLectura } = useVendedor()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mostrarAviso, setMostrarAviso] = useState(false)
  const [confirmarFin, setConfirmarFin] = useState(false)
  // GPS en segundo plano (Traccar): con la jornada abierta, avisa si no está mandando.
  const [segundoPlano, setSegundoPlano] = useState<'ok' | 'falta' | null>(null)
  useEffect(() => {
    if (!jornada || soloLectura) { setSegundoPlano(null); return }
    let vivo = true
    const revisar = () => void supabaseNavegador().from('vis_gps_dispositivos').select('ultima_recibida_el').eq('vendedor_id', perfil.id).maybeSingle()
      .then(({ data, error: e }) => { if (vivo && !e) setSegundoPlano(data?.ultima_recibida_el && Date.now() - Date.parse(data.ultima_recibida_el) < 15 * 60000 ? 'ok' : 'falta') })
    revisar()
    const t = setInterval(revisar, 5 * 60000)
    return () => { vivo = false; clearInterval(t) }
  }, [jornada, soloLectura, perfil.id])

  const correr = async (fn: () => Promise<void>) => {
    setOcupado(true)
    setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }

  const alIniciar = () => {
    if (!perfil.tracking_aceptado_el) setMostrarAviso(true)
    else void correr(iniciarJornada)
  }

  const totalPend = pendientes.visitas + pendientes.posiciones

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-borde bg-superficie/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] backdrop-blur">
        {!enLinea && (
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">
            <WifiOff className="size-4" aria-hidden /> Sin señal: lo que cargues se guarda y se sube solo.
          </p>
        )}
        {soloLectura ? (
          <p className="text-sm text-tenue">La jornada la inicia {perfil.nombre} desde su celular. En esta vista no se inicia ni se comparte ubicación.</p>
        ) : cargandoJornada ? (
          <div className="h-14 animate-pulse rounded-lg bg-borde/50" />
        ) : jornada ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-marca">
              <MapPin className="size-4" aria-hidden /> Ubicación compartida con tu supervisor · desde las {fmtSoloHora(jornada.inicio)}
            </p>
            {segundoPlano === 'falta' && <Link href="/gps" className="text-sm font-medium text-amber-700 underline dark:text-amber-300">Activá el GPS en segundo plano (Traccar) →</Link>}
            {segundoPlano === 'ok' && <p className="text-xs text-tenue">GPS en segundo plano: activo</p>}
            {confirmarFin ? (
              <div className="flex gap-2">
                <Boton variante="peligro" grande className="flex-1" disabled={ocupado} onClick={() => void correr(async () => { await terminarJornada(); setConfirmarFin(false) })}>
                  {ocupado ? 'Terminando…' : 'Sí, terminar'}
                </Boton>
                <Boton variante="secundario" grande onClick={() => setConfirmarFin(false)}>Cancelar</Boton>
              </div>
            ) : (
              <Boton variante="secundario" grande onClick={() => setConfirmarFin(true)}>Terminar jornada</Boton>
            )}
          </div>
        ) : (
          <Boton variante="exito" grande className="w-full" disabled={ocupado} onClick={alIniciar}>
            {ocupado ? 'Iniciando…' : 'Iniciar jornada'}
          </Boton>
        )}
        {totalPend > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-tenue tabular">
            <CloudUpload className="size-3.5" aria-hidden />
            Pendientes de subir: {pendientes.visitas > 0 && `${pendientes.visitas} visita${pendientes.visitas === 1 ? '' : 's'}`}
            {pendientes.visitas > 0 && pendientes.posiciones > 0 && ' · '}
            {pendientes.posiciones > 0 && `${pendientes.posiciones} posiciones`}
          </p>
        )}
        {erroresSubida.length > 0 && (
          <Aviso tipo="error" className="mt-2">
            No se pudieron subir: {erroresSubida.join(' · ')}. Avisale a tu supervisor.
          </Aviso>
        )}
        {error && <Aviso tipo="error" className="mt-2">{error}</Aviso>}
      </div>

        {/* Fuera de la barra: su backdrop-blur hace que "fixed" quede dentro de ella y el aviso salga cortado. */}
        {mostrarAviso && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="aviso-titulo">
            <div className="w-full max-w-md rounded-2xl bg-superficie p-5 shadow-xl">
              <h2 id="aviso-titulo" className="text-lg font-semibold">Antes de empezar</h2>
              <div className="mt-2 space-y-2 text-sm text-tinta">
                <p>Mientras la jornada esté iniciada, la app <strong>registra tu ubicación</strong> y tu supervisor la ve en un mapa.</p>
                <p>Se registra <strong>solo entre “Iniciar jornada” y “Terminar jornada”</strong>. Fuera de ese horario no se guarda nada.</p>
                <p>Si te olvidás de terminarla, se cierra sola a las 20:00.</p>
              </div>
              <div className="mt-4 flex gap-2">
                <Boton className="flex-1" disabled={ocupado} onClick={() => void correr(async () => { await aceptarAviso(); setMostrarAviso(false); await iniciarJornada() })}>
                  Entendido, iniciar
                </Boton>
                <Boton variante="secundario" onClick={() => setMostrarAviso(false)}>Ahora no</Boton>
              </div>
            </div>
          </div>
        )}
    </>
  )
}
