'use client'
// «No pude visitar este lugar» (visitadora médica): fue al hospital o consultorio y no pudo ver a nadie
// (no había médicos, no la dejaron pasar, estaba cerrado…). Queda con hora, GPS, motivo y observación;
// el supervisor lo ve en Actividad y en el Ruteo. Se puede deshacer dentro de los 30 minutos.
// En la venta (`venta`, TI-0115): en Hoy, sobre una parada de su ruta, con motivos de venta; el supervisor la ve
// en el tablero como «no concretada».
import { useEffect, useState } from 'react'
import { CircleMinus } from 'lucide-react'
import { AreaTexto, Aviso, Boton, Tarjeta } from '@/components/ui'
import { AVISO_SOLO_LECTURA } from '@/components/vendedor/Proveedor'
import { leerGps } from '@/lib/gps'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtSoloHora } from '@/lib/fechas'
import { MOTIVOS_NO_VISITA, MOTIVOS_NO_VISITA_VENTA, textoMotivo } from '@/lib/medicos'
import { cn, mensajeError } from '@/lib/utils'
import type { MotivoNoVisita } from '@/lib/database.types'

type Registro = { id: string; hora: string; creado: string; motivo: MotivoNoVisita; observaciones: string | null }

export function NoPudeVisitar({ lugarId, vendedorId, soloLectura, venta = false, nombre }: {
  lugarId: string; vendedorId: string; soloLectura: boolean
  /** Venta: motivos de venta y textos de cliente. En Hoy no lee lo de hoy (ya lo trae la pantalla). */
  venta?: boolean; nombre?: string
}) {
  const [registros, setRegistros] = useState<Registro[]>([])
  const motivos = venta ? MOTIVOS_NO_VISITA_VENTA : MOTIVOS_NO_VISITA
  const idRadio = `motivo-no-visita-${lugarId}`
  const idObs = `obs-no-visita-${lugarId}`
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState<MotivoNoVisita | ''>('')
  const [obs, setObs] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (venta) return
    let vivo = true
    const desde = new Date(); desde.setHours(0, 0, 0, 0)
    void supabaseNavegador().from('vis_no_visitados').select('id, fecha_hora, created_at, motivo, observaciones')
      .eq('vendedor_id', vendedorId).eq('lugar_id', lugarId).gte('fecha_hora', desde.toISOString()).order('fecha_hora')
      .then(({ data }) => { if (vivo && data) setRegistros(data.map((x) => ({ id: x.id, hora: x.fecha_hora, creado: x.created_at, motivo: x.motivo, observaciones: x.observaciones }))) })
    return () => { vivo = false }
  }, [lugarId, vendedorId, venta])

  async function guardar() {
    if (soloLectura) return setError(AVISO_SOLO_LECTURA)
    if (!motivo) return setError('Elegí el motivo.')
    if (motivo === 'otro' && !obs.trim()) return setError('Escribí qué pasó.')
    if (!navigator.onLine) return setError('Sin señal no se puede guardar. Probá de nuevo cuando tengas señal.')
    setGuardando(true); setError(null)
    const gps = await leerGps(15000).catch(() => null) // sin GPS igual se guarda la hora
    const { data, error: e } = await supabaseNavegador().rpc('vis_marcar_no_visitado', { p: {
      client_uuid: crypto.randomUUID(), lugar_id: lugarId, motivo, observaciones: obs.trim() || null,
      lat: gps?.lat ?? null, lng: gps?.lng ?? null, precision_m: gps ? Math.round(gps.precision) : null,
    } })
    setGuardando(false)
    if (e) return setError(mensajeError(e))
    const ahora = new Date().toISOString()
    setRegistros((r) => [...r, { id: (data as { id: string }).id, hora: ahora, creado: ahora, motivo, observaciones: obs.trim() || null }])
    setAbierto(false); setMotivo(''); setObs('')
  }

  async function deshacer(r: Registro) {
    if (soloLectura) return setError(AVISO_SOLO_LECTURA)
    if (!confirm('¿Deshacer «No pude visitar»?')) return
    const { error: e } = await supabaseNavegador().rpc('vis_quitar_no_visitado', { p_id: r.id })
    if (e) return setError(mensajeError(e))
    setRegistros((x) => x.filter((y) => y.id !== r.id))
  }

  return (
    <div className="flex flex-col gap-2">
      {registros.map((r) => (
        <Aviso key={r.id} tipo="alerta">
          <p><CircleMinus className="-mt-0.5 mr-1 inline size-4" aria-hidden /><b>{venta ? 'No concretada' : 'No pudiste visitar'}</b> ({fmtSoloHora(r.hora)}): {textoMotivo(r.motivo)}.{r.observaciones && <> «{r.observaciones}»</>} Tu supervisor ya lo ve.</p>
          {Date.now() - Date.parse(r.creado) < 30 * 60000 && (
            <button type="button" onClick={() => void deshacer(r)} className="mt-1 text-sm font-medium underline">Deshacer (si al final pudiste visitar)</button>
          )}
        </Aviso>
      ))}
      {!abierto ? (
        <button type="button" onClick={() => { setAbierto(true); setError(null) }}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-borde px-3 py-2 text-sm font-medium text-tinta hover:bg-fondo">
          <CircleMinus className="size-4 text-amber-700 dark:text-amber-300" aria-hidden /> {venta ? 'No pude visitarlo' : 'No pude visitar este lugar'}
        </button>
      ) : (
        <Tarjeta className="flex flex-col gap-3">
          <div>
            <p className="font-semibold">¿Por qué no pudiste visitar{venta && nombre ? ` a ${nombre}` : ''}?</p>
            <p className="text-xs text-tenue">{venta ? 'Queda la hora y tu ubicación. La parada sigue en tu ruta: si después lo visitás, registrás la visita igual.' : 'Queda la hora y tu ubicación. Si después aparece un médico, registrás la visita igual.'}</p>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="sr-only">Motivo</legend>
            {motivos.map((m) => (
              <label key={m.valor} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5 text-base', motivo === m.valor ? 'border-marca bg-fondo' : 'border-borde')}>
                <input type="radio" name={idRadio} className="size-5 accent-[var(--c-marca)]" checked={motivo === m.valor} onChange={() => { setMotivo(m.valor); setError(null) }} />
                {m.texto}
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor={idObs} className="mb-1 block text-sm font-medium">Observación{motivo === 'otro' ? ' *' : ' (opcional)'}</label>
            <AreaTexto id={idObs} value={obs} onChange={(e) => setObs(e.target.value)} placeholder={venta ? 'Ej.: pasar el jueves a la tarde, el encargado vuelve el lunes…' : 'Ej.: vuelven el lunes, hay congreso, la secretaria dijo que pase a las 15…'} />
          </div>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <div className="flex gap-2">
            <Boton className="flex-1" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</Boton>
            <Boton variante="secundario" onClick={() => { setAbierto(false); setError(null) }}>Cancelar</Boton>
          </div>
        </Tarjeta>
      )}
      {!abierto && error && <Aviso tipo="error">{error}</Aviso>}
    </div>
  )
}
