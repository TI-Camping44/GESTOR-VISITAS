'use client'
// Botón grande de jornada arriba de todo (BRIEF §6 pantalla 0) y el aviso de ubicación del primer uso.
import { useState } from 'react'
import { MapPin, WifiOff, CloudUpload } from 'lucide-react'
import { useVendedor } from './Proveedor'
import { Aviso, Boton } from '@/components/ui'
import { fmtSoloHora } from '@/lib/fechas'

export function BarraJornada() {
  const { perfil, jornada, cargandoJornada, pendientes, enLinea, erroresSubida, iniciarJornada, terminarJornada, aceptarAviso } = useVendedor()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mostrarAviso, setMostrarAviso] = useState(false)
  const [confirmarFin, setConfirmarFin] = useState(false)

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
    <div className="sticky top-0 z-20 border-b border-borde bg-superficie/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] backdrop-blur">
      {!enLinea && (
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">
          <WifiOff className="size-4" aria-hidden /> Sin señal: lo que cargues se guarda y se sube solo.
        </p>
      )}
      {cargandoJornada ? (
        <div className="h-14 animate-pulse rounded-lg bg-borde/50" />
      ) : jornada ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-marca">
            <MapPin className="size-4" aria-hidden /> Ubicación compartida con tu supervisor · desde las {fmtSoloHora(jornada.inicio)}
          </p>
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
    </div>
  )
}
