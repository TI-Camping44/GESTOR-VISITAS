'use client'
// Visita médica: el lugar (hospital, consultorio…) con los médicos que atienden ahí.
// Desde acá se registra una visita por cada médico. Una sola dirección (/lugar?c=<id>):
// una copia guardada sirve sin señal para cualquier lugar (ver public/sw.js).
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, MessageCircle, Navigation, Pencil, Phone, Plus, Trash2 } from 'lucide-react'
import { AVISO_SOLO_LECTURA, useVendedor } from '@/components/vendedor/Proveedor'
import { Aviso, Boton, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { guardarCache, leerCache } from '@/lib/offline/db'
import { hace } from '@/lib/fechas'
import { linkComoLlegar, linkTel, linkWhatsApp, mensajeError } from '@/lib/utils'
import { urlVisitaMedico } from '@/lib/rutas'
import { tocaVisitar } from '@/lib/medicos'
import type { Medico } from '@/lib/database.types'

type Lugar = { id: string; razon_social: string; ciudad: string | null; direccion: string | null; lat: number | null; lng: number | null; tipo_lugar?: string | null; telefono?: string | null }

export default function PaginaLugar() {
  const busqueda = useSearchParams()
  const lugarId = busqueda.get('c') ?? ''
  const parada = busqueda.get('parada')
  const { perfil, soloLectura } = useVendedor()
  const [lugar, setLugar] = useState<Lugar | null>(null)
  const [medicos, setMedicos] = useState<Medico[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hoyVisitados, setHoyVisitados] = useState<Set<string>>(new Set())
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
        sb.from('vis_clientes_v').select('id, razon_social, ciudad, direccion, lat, lng, tipo_lugar, telefono').eq('id', lugarId).maybeSingle(),
        sb.from('vis_medicos_v').select('*').order('nombre').limit(3000),
        sb.from('vis_visitas').select('medico_id').eq('vendedor_id', perfil.id).eq('cliente_id', lugarId).gte('fecha_hora', desde.toISOString()),
      ])
      if (!vivo) return
      if (rl.data) setLugar(rl.data as Lugar)
      else if (!guardado) setError(rl.error ? 'Sin señal y este lugar no está guardado en el celular. Abrilo una vez con señal.' : 'No encontramos este lugar.')
      if (rm.data) { setMedicos(rm.data); void guardarCache(`medicos:${perfil.id}`, rm.data) }
      if (rv.data) setHoyVisitados(new Set(rv.data.map((v) => v.medico_id).filter((x): x is string => !!x)))
    })()
    return () => { vivo = false }
  }, [lugarId, perfil.id])

  const deAca = useMemo(() => (medicos ?? []).filter((m) => m.lugares.some((l) => l.lugar_id === lugarId))
    .sort((a, b) => Number(tocaVisitar(b)) - Number(tocaVisitar(a)) || a.nombre.localeCompare(b.nombre, 'es')), [medicos, lugarId])

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
          <Link href={`/medicos/nuevo?lugar=${lugar.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-borde px-3 py-1.5 text-sm font-medium"><Plus className="size-4 text-marca" aria-hidden /> Agregar médico acá</Link>
        </div>
      </div>

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
                  {!visitado && toca && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">toca visita</span>}
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
