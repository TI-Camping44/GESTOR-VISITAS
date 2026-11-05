'use client'
// Visita médica: alta de un lugar (hospital, sanatorio, consultorio…), parado ahí: se guarda el GPS.
// Queda de la visitadora y solo lo ve su empresa. Después se le cargan los médicos.
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CapturaGps, useGps } from '@/components/vendedor/CapturaGps'
import { AreaTexto, Aviso, Boton, Entrada, Etiqueta, Selector } from '@/components/ui'
import { AVISO_SOLO_LECTURA, useVendedor } from '@/components/vendedor/Proveedor'
import { supabaseNavegador } from '@/lib/supabase/client'
import { guardarCache } from '@/lib/offline/db'
import { VIS } from '@/lib/config'
import { mensajeError } from '@/lib/utils'
import { TIPOS_LUGAR } from '@/lib/medicos'

export default function NuevoLugar() {
  const router = useRouter()
  const gps = useGps()
  const { perfil, soloLectura } = useVendedor()
  const [ciudades, setCiudades] = useState<string[]>([])
  const [f, setF] = useState({ nombre: '', tipo_lugar: 'Hospital', telefono: '', direccion: '', ciudad: '', notas: '' })
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cambiar = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    supabaseNavegador().from('vis_zonas').select('ciudades').eq('activo', true)
      .then(({ data }) => setCiudades([...new Set((data ?? []).flatMap((z) => z.ciudades))]))
  }, [])
  const lista = useMemo(() => [...ciudades].sort(new Intl.Collator('es').compare), [ciudades])

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (soloLectura) return setError(AVISO_SOLO_LECTURA)
    setError(null)
    if (!f.nombre.trim()) return setError('Falta el nombre del lugar.')
    const l = gps.lectura
    if (!l) return setError('Falta la ubicación GPS. Tocá "Reintentar".')
    if (l.precision > VIS.gpsPrecisionMaxM) return setError(`Precisión actual: ${l.precision} m. Se necesita ${VIS.gpsPrecisionMaxM} m o menos: reintentá al aire libre.`)
    if (!navigator.onLine) return setError('Necesitás señal para cargar un lugar.')
    setEnviando(true)
    const sb = supabaseNavegador()
    const { data, error } = await sb.rpc('vis_crear_lugar', { p: { ...f, lat: l.lat, lng: l.lng, precision_m: l.precision } })
    if (error) { setEnviando(false); return setError(mensajeError(error)) }
    const id = (data as { id: string }).id
    // Que aparezca enseguida en la cartera guardada (lugares y médicos sin señal).
    const { data: cartera } = await sb.from('vis_clientes_v').select('id, razon_social, ciudad, direccion, lat, lng, estado, telefono, telefono_norm, ruc, ultima_visita, ultima_factura_fecha, ventas_6m_gs, tipo_lugar').eq('vendedor_id', perfil.id).limit(3000)
    if (cartera) await guardarCache(`cartera:${perfil.id}`, cartera).catch(() => {})
    router.push(`/medicos/nuevo?lugar=${id}`)
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Nuevo lugar</h1>
        <p className="text-sm text-tenue">Hospital, sanatorio o consultorio. Cargalo parado ahí: se guarda la ubicación del GPS. Después cargás sus médicos.</p>
      </div>
      <CapturaGps gps={gps} />
      <div>
        <Etiqueta htmlFor="nombre">Nombre *</Etiqueta>
        <Entrada id="nombre" value={f.nombre} onChange={cambiar('nombre')} placeholder="Hospital de Clínicas" autoComplete="off" />
      </div>
      <div>
        <Etiqueta htmlFor="tipo">Tipo</Etiqueta>
        <Selector id="tipo" value={f.tipo_lugar} onChange={cambiar('tipo_lugar')}>
          {TIPOS_LUGAR.map((t) => <option key={t} value={t}>{t}</option>)}
        </Selector>
      </div>
      <div>
        <Etiqueta htmlFor="ciudad">Ciudad</Etiqueta>
        <Entrada id="ciudad" list="ciudades" value={f.ciudad} onChange={cambiar('ciudad')} autoComplete="off" />
        <datalist id="ciudades">{lista.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div>
        <Etiqueta htmlFor="dir">Dirección</Etiqueta>
        <Entrada id="dir" value={f.direccion} onChange={cambiar('direccion')} />
      </div>
      <div>
        <Etiqueta htmlFor="tel">Teléfono</Etiqueta>
        <Entrada id="tel" type="tel" inputMode="tel" value={f.telefono} onChange={cambiar('telefono')} />
      </div>
      <div>
        <Etiqueta htmlFor="notas">Notas</Etiqueta>
        <AreaTexto id="notas" value={f.notas} onChange={cambiar('notas')} placeholder="Piso, recepción, horario de visitadores…" />
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <Boton type="submit" grande disabled={enviando || gps.leyendo}>{enviando ? 'Guardando…' : 'Guardar lugar'}</Boton>
    </form>
  )
}
