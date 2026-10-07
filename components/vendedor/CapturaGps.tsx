'use client'
// Captura GPS al abrir la pantalla, con precisión visible y botón para reintentar.
import { useCallback, useEffect, useState } from 'react'
import { LocateFixed, RefreshCw } from 'lucide-react'
import type { Lectura } from '@/lib/gps'
import { ubicacionRapida } from '@/lib/tracking/tracker'
import { distanciaM, fmtDistancia, type Punto } from '@/lib/geo'
import { VIS } from '@/lib/config'
import { cn } from '@/lib/utils'

export function useGps(auto = true) {
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const leer = useCallback(async () => {
    setLeyendo(true)
    setError(null)
    try { setLectura(await ubicacionRapida()) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLeyendo(false) }
  }, [])
  useEffect(() => { if (auto) void leer() }, [auto, leer])
  return { lectura, error, leyendo, leer, precisionOk: lectura != null && lectura.precision <= VIS.gpsPrecisionMaxM }
}

export function CapturaGps({ gps, destino, nombreDestino }: { gps: ReturnType<typeof useGps>; destino?: Punto | null; nombreDestino?: string }) {
  const { lectura, error, leyendo, leer, precisionOk } = gps
  const dist = lectura && destino ? distanciaM(lectura, destino) : null
  return (
    <div className={cn('rounded-xl border p-3', precisionOk ? 'border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950' : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950')}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <LocateFixed className="size-4" aria-hidden />
          {leyendo ? 'Buscando tu ubicación…' : lectura ? `Precisión actual: ${lectura.precision} m` : 'Sin ubicación'}
        </p>
        <button type="button" onClick={() => void leer()} disabled={leyendo} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-marca disabled:opacity-50">
          <RefreshCw className={cn('size-4', leyendo && 'animate-spin')} aria-hidden /> Reintentar
        </button>
      </div>
      {lectura && !precisionOk && !leyendo && (
        <p className="mt-1 text-sm">Se necesita {VIS.gpsPrecisionMaxM} m o menos: reintentá al aire libre, lejos de techos.</p>
      )}
      {dist != null && (
        <p className="mt-1 text-sm">Estás a <strong>{fmtDistancia(dist)}</strong> de la ubicación registrada{nombreDestino ? ` de ${nombreDestino}` : ''}.</p>
      )}
      {error && <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </div>
  )
}
