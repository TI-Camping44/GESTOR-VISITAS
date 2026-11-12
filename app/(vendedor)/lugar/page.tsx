'use client'
// Visita médica: el lugar (hospital, consultorio…) con los médicos que atienden ahí.
// Desde acá se registra una visita por cada médico. Una sola dirección (/lugar?c=<id>):
// una copia guardada sirve sin señal para cualquier lugar (ver public/sw.js).
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, MapPin, MessageCircle, Navigation, Pencil, Phone, Plus, Search, Stethoscope, Trash2 } from 'lucide-react'
import { leerGps } from '@/lib/gps'
import { distanciaM, fmtDistancia } from '@/lib/geo'
import { fmtSoloHora } from '@/lib/fechas'
import { AVISO_SOLO_LECTURA, useVendedor } from '@/components/vendedor/Proveedor'
import { Aviso, Boton, Entrada, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { guardarCache, leerCache } from '@/lib/offline/db'
import { hace } from '@/lib/fechas'
import { linkComoLlegar, linkTel, linkWhatsApp, mensajeError } from '@/lib/utils'
import { urlVisitaMedico } from '@/lib/rutas'
import { tocaVisitar } from '@/lib/medicos'
import type { Medico } from '@/lib/database.types'

type Lugar = { id: string; razon_social: string; ciudad: string | null; direccion: string | null; lat: number | null; lng: number | null; tipo_lugar?: string | null; telefono?: string | null; notas?: string | null }
type Objetivo = { medico_id: string | null; especialidad: string | null; orden: number }

export default function PaginaLugar() {
  const busqueda = useSearchParams()
  const lugarId = busqueda.get('c') ?? ''
  const parada = busqueda.get('parada')
  const { perfil, soloLectura, esMedica } = useVendedor()
  const [lugar, setLugar] = useState<Lugar | null>(null)
  const [medicos, setMedicos] = useState<Medico[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hoyVisitados, setHoyVisitados] = useState<Set<string>>(new Set())
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  // «Llegué acá»: hora y GPS de la llegada; el lugar se suma a la ruta de hoy y Sergio lo ve en el momento.
  const [llegada, setLlegada] = useState<{ id: string; hora: string; creada: string } | null>(null)
  const [quitandoLl, setQuitandoLl] = useState(false)
  const [llegando, setLlegando] = useState(false)
  const [errorLlegada, setErrorLlegada] = useState<string | null>(null)
  // Sumar acá un médico que ya cargó en otro lugar (el mismo médico, no se carga dos veces).
  const [sumar, setSumar] = useState(false)
  const [sumarId, setSumarId] = useState('')
  const [sumarHorario, setSumarHorario] = useState('')
  const [sumando, setSumando] = useState(false)
  const [errorSumar, setErrorSumar] = useState<string | null>(null)
  const [quitando, setQuitando] = useState(false)
  const [errorQuitar, setErrorQuitar] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (!lugarId) { setError('Falta el lugar.'); return }
      const [cartera, meds] = await Promise.all([
        leerCache<Lugar[]>(`cartera:${perfil.id}`).catch(() => null),
        leerCache<Medico[]>(`medicos:${perfil.id}`).catch(() => null),
      ])
      if (!vivo) return
      const guardado = cartera?.datos.find((c) => c.id === lugarId)
      if (guardado) setLugar(guardado)
      if (meds) setMedicos(meds.datos)
      const sb = supabaseNavegador()
      const desde = new Date(); desde.setHours(0, 0, 0, 0)
      const [rl, rm, rv] = await Promise.all([
        sb.from('vis_clientes_v').select('id, razon_social, ciudad, direccion, lat, lng, tipo_lugar, telefono, notas').eq('id', lugarId).maybeSingle(),
        sb.from('vis_medicos_v').select('*').order('nombre').limit(3000),
        sb.from('vis_visitas').select('medico_id').eq('vendedor_id', perfil.id).eq('cliente_id', lugarId).gte('fecha_hora', desde.toISOString()),
      ])
      void sb.from('vis_llegadas').select('id, fecha_hora, created_at').eq('vendedor_id', perfil.id).eq('lugar_id', lugarId).gte('fecha_hora', desde.toISOString())
        .order('fecha_hora').limit(1).then(({ data }) => { if (vivo && data?.[0]) setLlegada({ id: data[0].id, hora: data[0].fecha_hora, creada: data[0].created_at }) })
      if (!vivo) return
      if (rl.data) setLugar(rl.data as Lugar)
      else if (!guardado) setError(rl.error ? 'Sin señal y este lugar no está guardado en el celular. Abrilo una vez con señal.' : 'No encontramos este lugar.')
      if (rm.data) { setMedicos(rm.data); void guardarCache(`medicos:${perfil.id}`, rm.data) }
      // A quién ir hoy en esta parada (lo arma Sergio en el panel). Sin señal, lo guardado en Hoy.
      if (parada) {
        const ro = await sb.from('vis_parada_objetivos').select('medico_id, especialidad, orden').eq('parada_id', parada).order('orden')
        if (vivo && ro.data) setObjetivos(ro.data)
      }
      if (rv.data) setHoyVisitados(new Set(rv.data.map((v) => v.medico_id).filter((x): x is string => !!x)))
    })()
    return () => { vivo = false }
  }, [lugarId, perfil.id, parada])

  const otros = useMemo(() => (medicos ?? []).filter((m) => !m.lugares.some((l) => l.lugar_id === lugarId)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [medicos, lugarId])
  const objetivoIds = useMemo(() => new Set(objetivos.map((o) => o.medico_id).filter(Boolean)), [objetivos])
  const deAca = useMemo(() => (medicos ?? []).filter((m) => m.lugares.some((l) => l.lugar_id === lugarId))
    .sort((a, b) => Number(objetivoIds.has(b.id)) - Number(objetivoIds.has(a.id)) || Number(tocaVisitar(b)) - Number(tocaVisitar(a)) || a.nombre.localeCompare(b.nombre, 'es')), [medicos, lugarId, objetivoIds])
  // Especialidades a buscar: las de la ruta sin médico, salvo que ya haya uno de esa especialidad acá.
  const esp = (x: string | null | undefined) => (x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const aBuscar = objetivos.filter((o) => !o.medico_id && o.especialidad && !deAca.some((m) => esp(m.especialidad) === esp(o.especialidad)))

  async function marcarLlegada() {
    if (!lugar) return
    if (soloLectura) return setErrorLlegada(AVISO_SOLO_LECTURA)
    if (!navigator.onLine) return setErrorLlegada('Sin señal no se puede marcar la llegada. Registrá la visita al médico igual: se guarda en el celular.')
    setLlegando(true); setErrorLlegada(null)
    const gps = await leerGps(15000).catch(() => null) // sin GPS igual se marca la hora
    // ¿Está lejos del lugar? Puede haber tocado otro sin querer.
    if (gps && lugar.lat != null && lugar.lng != null) {
      const d = distanciaM(gps, { lat: lugar.lat, lng: lugar.lng })
      if (d > 500 && !confirm(`Estás a ${fmtDistancia(d)} de ${lugar.razon_social}. ¿Seguro que llegaste acá?`)) { setLlegando(false); return }
    }
    const { data: res, error: e } = await supabaseNavegador().rpc('vis_marcar_llegada', { p: {
      client_uuid: crypto.randomUUID(), lugar_id: lugar.id, lat: gps?.lat ?? null, lng: gps?.lng ?? null, precision_m: gps ? Math.round(gps.precision) : null,
    } })
    setLlegando(false)
    if (e) return setErrorLlegada(mensajeError(e))
    const ahora = new Date().toISOString()
    setLlegada({ id: (res as { id: string }).id, hora: ahora, creada: ahora })
  }

  // «Me equivoqué, quitar»: dentro de los 30 minutos y sin visitas registradas acá hoy.
  async function quitarLlegada() {
    if (!llegada) return
    if (soloLectura) return setErrorLlegada(AVISO_SOLO_LECTURA)
    if (!confirm('¿Quitar esta llegada? El lugar sale de tu ruta de hoy.')) return
    setQuitandoLl(true); setErrorLlegada(null)
    const { error: e } = await supabaseNavegador().rpc('vis_quitar_llegada', { p_llegada: llegada.id })
    setQuitandoLl(false)
    if (e) return setErrorLlegada(mensajeError(e))
    setLlegada(null)
  }

  async function sumarMedico() {
    if (!lugar || !sumarId) return
    if (soloLectura) return setErrorSumar(AVISO_SOLO_LECTURA)
    if (!navigator.onLine) return setErrorSumar('Necesitás señal para sumar el médico a este lugar.')
    setSumando(true); setErrorSumar(null)
    const { error: e } = await supabaseNavegador().from('vis_medico_lugares').insert({ medico_id: sumarId, lugar_id: lugar.id, horario: sumarHorario.trim() || null })
    setSumando(false)
    if (e) return setErrorSumar(mensajeError(e))
    const nuevos = (medicos ?? []).map((m) => (m.id === sumarId ? { ...m, lugares: [...m.lugares, { lugar_id: lugar.id, nombre: lugar.razon_social, horario: sumarHorario.trim() || null }] } : m))
    setMedicos(nuevos)
    void guardarCache(`medicos:${perfil.id}`, nuevos).catch(() => {})
    setSumar(false); setSumarId(''); setSumarHorario('')
  }

  // Lugar cargado de más o mal: sale de la lista y de las rutas de hoy en adelante (las visitas quedan).
  async function quitarLugar() {
    if (!lugar) return
    if (soloLectura) return setErrorQuitar(AVISO_SOLO_LECTURA)
    if (!navigator.onLine) return setErrorQuitar('Necesitás señal para quitar un lugar.')
    if (!confirm(`¿Quitar «${lugar.razon_social}» de tus lugares? Sale de la lista, de tus rutas y de los médicos que atienden ahí. Las visitas que ya hiciste quedan en el historial.`)) return
    setQuitando(true); setErrorQuitar(null)
    const { error: e } = await supabaseNavegador().rpc('vis_quitar_lugar', { p_lugar: lugar.id })
    if (e) { setQuitando(false); return setErrorQuitar(mensajeError(e)) }
    const cartera = await leerCache<Lugar[]>(`cartera:${perfil.id}`).catch(() => null)
    if (cartera) await guardarCache(`cartera:${perfil.id}`, cartera.datos.filter((c) => c.id !== lugar.id)).catch(() => {})
    router.push('/mapa')
    router.refresh()
  }

  if (error) return <Aviso tipo="error">{error} <Link href="/hoy" className="underline">Volver</Link></Aviso>
  if (!lugar) return <div className="h-40 animate-pulse rounded-xl bg-borde/40" />
  const comoLlegar = linkComoLlegar(lugar)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-tenue">{lugar.tipo_lugar ?? 'Lugar'}</p>
        <h1 className="text-xl font-semibold leading-snug">{lugar.razon_social}</h1>
        <p className="text-sm text-tenue">{[lugar.direccion, lugar.ciudad].filter(Boolean).join(' · ') || 'Sin dirección'}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {comoLlegar && <a href={comoLlegar} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-borde px-3 py-1.5 text-sm font-medium"><Navigation className="size-4 text-marca" aria-hidden /> Cómo llegar</a>}
          <Link href={`/medicos/nuevo?lugar=${lugar.id}${parada ? `&parada=${parada}` : ''}`} className="inline-flex items-center gap-1.5 rounded-lg border border-borde px-3 py-1.5 text-sm font-medium"><Plus className="size-4 text-marca" aria-hidden /> Agregar médico acá</Link>
          {otros.length > 0 && <button type="button" onClick={() => setSumar(!sumar)} className="inline-flex items-center gap-1.5 rounded-lg border border-borde px-3 py-1.5 text-sm font-medium"><Stethoscope className="size-4 text-marca" aria-hidden /> Ya lo tengo cargado</button>}
        </div>
      </div>

      {esMedica && (llegada ? (
        <div className="flex flex-col gap-1.5">
          <Aviso tipo="ok"><CheckCircle2 className="-mt-0.5 mr-1 inline size-4" aria-hidden />Llegaste a las <b>{fmtSoloHora(llegada.hora)}</b>. Está en tu ruta de hoy y tu supervisor ya lo ve.</Aviso>
          {hoyVisitados.size === 0 && Date.now() - Date.parse(llegada.creada) < 30 * 60000 && (
            <button type="button" onClick={() => void quitarLlegada()} disabled={quitandoLl} className="self-start text-sm text-red-700 underline disabled:opacity-50 dark:text-red-300">
              {quitandoLl ? 'Quitando…' : 'Me equivoqué de lugar, quitar'}
            </button>
          )}
          {errorLlegada && <Aviso tipo="error">{errorLlegada}</Aviso>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Boton grande onClick={() => void marcarLlegada()} disabled={llegando}>
            <MapPin className="size-5" aria-hidden /> {llegando ? 'Marcando…' : 'Llegué acá'}
          </Boton>
          <p className="text-xs text-tenue">Marca la hora y tu ubicación de llegada. Si no estaba en tu ruta de hoy, se suma sola.</p>
          {errorLlegada && <Aviso tipo="error">{errorLlegada}</Aviso>}
        </div>
      ))}
      {sumar && (
        <Tarjeta className="flex flex-col gap-2">
          <p className="font-semibold">Sumar un médico que ya cargaste</p>
          <p className="text-xs text-tenue">Es el mismo médico: queda en sus otros lugares y también en este.</p>
          <Selector aria-label="Médico" value={sumarId} onChange={(e) => setSumarId(e.target.value)}>
            <option value="">Elegí el médico…</option>
            {otros.map((m) => <option key={m.id} value={m.id}>{m.nombre}{m.especialidad ? ` · ${m.especialidad}` : ''}</option>)}
          </Selector>
          <Entrada aria-label="Horario en este lugar" placeholder="Horario acá (ej.: mar y jue 9 a 12)" value={sumarHorario} onChange={(e) => setSumarHorario(e.target.value)} />
          {errorSumar && <Aviso tipo="error">{errorSumar}</Aviso>}
          <Boton onClick={() => void sumarMedico()} disabled={!sumarId || sumando}>{sumando ? 'Sumando…' : 'Sumar a este lugar'}</Boton>
        </Tarjeta>
      )}
      {lugar.notas && <Aviso tipo="info">{lugar.notas}</Aviso>}
      {aBuscar.length > 0 && (
        <Tarjeta className="flex flex-col gap-2 border-amber-300 dark:border-amber-800">
          <p className="flex items-center gap-1.5 font-semibold"><Search className="size-4 text-marca" aria-hidden /> Para buscar hoy</p>
          {aBuscar.map((o) => (
            <div key={o.especialidad} className="flex items-center justify-between gap-2 text-sm">
              <span>Médico de <b>{o.especialidad}</b></span>
              <Link href={`/medicos/nuevo?lugar=${lugar.id}${parada ? `&parada=${parada}` : ''}&especialidad=${encodeURIComponent(o.especialidad ?? '')}`} className="shrink-0 font-medium text-marca underline">Cargar médico</Link>
            </div>
          ))}
          <p className="text-xs text-tenue">Preguntá en recepción quién atiende esa especialidad y sus horarios, y cargalo acá.</p>
        </Tarjeta>
      )}

      <h2 className="text-lg font-semibold">Médicos ({deAca.length})</h2>
      {medicos && deAca.length === 0 && (
        <Vacio titulo="Todavía no cargaste médicos en este lugar">Tocá «Agregar médico acá» para cargar al primero.</Vacio>
      )}
      <ul className="flex flex-col gap-3">
        {deAca.map((m) => {
          const visitado = hoyVisitados.has(m.id)
          const toca = tocaVisitar(m)
          const horario = m.lugares.find((l) => l.lugar_id === lugarId)?.horario
          const tel = linkTel(m.telefono)
          const wa = linkWhatsApp(m.telefono_norm)
          return (
            <li key={m.id}>
              <Tarjeta>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{m.nombre}</p>
                    <p className="text-sm text-tenue">{[m.especialidad, horario].filter(Boolean).join(' · ') || 'Sin especialidad'}</p>
                  </div>
                  {objetivoIds.has(m.id) && <span className="shrink-0 rounded-full bg-marca px-2 py-0.5 text-xs font-medium text-white"><Stethoscope className="-mt-0.5 mr-0.5 inline size-3" aria-hidden />hoy</span>}
                  {!visitado && toca && !objetivoIds.has(m.id) && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">toca visita</span>}
                </div>
                <p className="mt-1 text-xs text-tenue">Última visita: {m.ultima_visita ? hace(m.ultima_visita) : 'nunca'} · cada {m.frecuencia_dias} días</p>
                <div className="mt-3 flex gap-2">
                  {visitado ? (
                    <span className="inline-flex flex-1 items-center justify-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400"><CheckCircle2 className="size-4" aria-hidden /> Visitado hoy</span>
                  ) : (
                    <Link href={urlVisitaMedico(lugar.id, m.id, { parada })} className="flex-1"><Boton className="w-full">Registrar visita</Boton></Link>
                  )}
                  {tel && <a href={tel} aria-label={`Llamar a ${m.nombre}`} className="grid size-10 place-items-center rounded-lg border border-borde"><Phone className="size-4" /></a>}
                  {wa && <a href={wa} target="_blank" rel="noreferrer" aria-label={`WhatsApp a ${m.nombre}`} className="grid size-10 place-items-center rounded-lg border border-borde"><MessageCircle className="size-4" /></a>}
                  <Link href={`/medicos/nuevo?id=${m.id}`} aria-label={`Editar a ${m.nombre}`} className="grid size-10 place-items-center rounded-lg border border-borde"><Pencil className="size-4" /></Link>
                </div>
              </Tarjeta>
            </li>
          )
        })}
      </ul>

      {errorQuitar && <Aviso tipo="error">{errorQuitar}</Aviso>}
      <button type="button" disabled={quitando} onClick={() => void quitarLugar()}
        className="mt-4 inline-flex items-center gap-1.5 self-start text-sm text-red-700 underline disabled:opacity-50 dark:text-red-300">
        <Trash2 className="size-4" aria-hidden /> {quitando ? 'Quitando…' : 'Quitar este lugar'}
      </button>
    </div>
  )
}
