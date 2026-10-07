'use client'
// Alta de cliente/prospecto con geolocalización condicionada (requerimiento 1):
// no se guarda sin razón social y teléfono, con GPS peor que el umbral, ni si parece
// repetido (mismo RUC, mismo teléfono o a menos de 30 m con nombre parecido) salvo que
// el vendedor confirme que es otro.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CapturaGps, useGps } from '@/components/vendedor/CapturaGps'
import { AreaTexto, Aviso, Boton, Entrada, Etiqueta, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtDistancia } from '@/lib/geo'
import { VIS } from '@/lib/config'
import { mensajeError } from '@/lib/utils'
import type { Duplicado } from '@/lib/database.types'

export default function NuevoProspecto() {
  const router = useRouter()
  const gps = useGps()
  const [f, setF] = useState({ razon_social: '', telefono: '', ruc: '', direccion: '', ciudad: '', notas: '' })
  const [duplicados, setDuplicados] = useState<Duplicado[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cambiar = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setF((x) => ({ ...x, [k]: e.target.value }))
    setDuplicados(null)
  }

  async function guardar(forzar: boolean) {
    setError(null)
    if (!f.razon_social.trim()) return setError('Falta la razón social.')
    if (f.telefono.replace(/\D/g, '').length < 9) return setError('Falta el teléfono o está incompleto.')
    const l = gps.lectura
    if (!l) return setError('Falta la ubicación GPS. Tocá "Reintentar".')
    if (l.precision > VIS.gpsPrecisionMaxM) return setError(`Precisión actual: ${l.precision} m. Se necesita ${VIS.gpsPrecisionMaxM} m o menos: reintentá al aire libre.`)
    if (!navigator.onLine) return setError('Necesitás señal para dar de alta un cliente: hay que verificar que no esté repetido.')

    setEnviando(true)
    const { data, error } = await supabaseNavegador().rpc('vis_crear_prospecto', {
      p: { ...f, lat: l.lat, lng: l.lng, precision_m: l.precision, forzar },
    })
    setEnviando(false)
    if (error) return setError(mensajeError(error))
    const r = data as { ok: boolean; id?: string; duplicados?: Duplicado[] }
    if (r.ok && r.id) router.push(`/visita/${r.id}`)
    else setDuplicados(r.duplicados ?? [])
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void guardar(false) }} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Nuevo cliente</h1>
        <p className="text-sm text-tenue">Hacé el alta parado en el local: se guarda la ubicación del GPS.</p>
      </div>

      <CapturaGps gps={gps} />

      <div>
        <Etiqueta htmlFor="razon">Razón social *</Etiqueta>
        <Entrada id="razon" required value={f.razon_social} onChange={cambiar('razon_social')} autoComplete="organization" />
      </div>
      <div>
        <Etiqueta htmlFor="tel">Teléfono *</Etiqueta>
        <Entrada id="tel" required type="tel" inputMode="tel" placeholder="0981 123 456" value={f.telefono} onChange={cambiar('telefono')} />
      </div>
      <div>
        <Etiqueta htmlFor="ruc">RUC</Etiqueta>
        <Entrada id="ruc" value={f.ruc} onChange={cambiar('ruc')} placeholder="80012345-6" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Etiqueta htmlFor="dir">Dirección</Etiqueta>
          <Entrada id="dir" value={f.direccion} onChange={cambiar('direccion')} />
        </div>
        <div>
          <Etiqueta htmlFor="ciudad">Ciudad</Etiqueta>
          <Entrada id="ciudad" value={f.ciudad} onChange={cambiar('ciudad')} />
        </div>
      </div>
      <div>
        <Etiqueta htmlFor="notas">Notas</Etiqueta>
        <AreaTexto id="notas" value={f.notas} onChange={cambiar('notas')} placeholder="Rubro, a quién preguntar, horario…" />
      </div>

      {duplicados && (
        <Tarjeta className="flex flex-col gap-3 border-amber-300">
          <p className="font-medium">Puede que este cliente ya exista:</p>
          <ul className="flex flex-col gap-2">
            {duplicados.map((d) => (
              <li key={d.id} className="rounded-lg bg-fondo p-3">
                <p className="font-medium">{d.razon_social}</p>
                <p className="text-sm text-tenue">
                  {d.motivo}{d.distancia_m != null && ` · a ${fmtDistancia(d.distancia_m)}`}{d.ciudad && ` · ${d.ciudad}`}{d.telefono && ` · ${d.telefono}`}
                </p>
                <Boton type="button" variante="secundario" className="mt-2" onClick={() => router.push(`/visita/${d.id}`)}>Es este</Boton>
              </li>
            ))}
          </ul>
          <Boton type="button" disabled={enviando} onClick={() => void guardar(true)}>No, es otro: crear igual</Boton>
        </Tarjeta>
      )}

      {error && <Aviso tipo="error">{error}</Aviso>}
      {!duplicados && (
        <Boton type="submit" grande disabled={enviando || gps.leyendo}>{enviando ? 'Verificando…' : 'Guardar cliente'}</Boton>
      )}
    </form>
  )
}
