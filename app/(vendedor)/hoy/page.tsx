'use client'
// Hoy: la ruta del día con contador, mapa y acciones por parada (BRIEF §6 vendedor 1).
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Phone, MessageCircle, Navigation, CheckCircle2, SkipForward, Undo2, Stethoscope, Clock } from 'lucide-react'
import { useVendedor } from '@/components/vendedor/Proveedor'
import { Mapa, type PuntoMapa } from '@/components/map/MapaDinamico'
import { Aviso, Boton, PuntoEstado, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { guardarCache, leerCache } from '@/lib/offline/db'
import { fmtFecha, hace, hoyIso, lunesDe } from '@/lib/fechas'
import { linksGoogleMaps } from '@/lib/geo'
import { fmtMin, horasEstimadas } from '@/lib/ruteo'
import { urlParaVisitar } from '@/lib/rutas'
import { BuscarCliente } from '@/components/vendedor/BuscarCliente'
import { COLOR_ESTADO } from '@/lib/config'
import { linkComoLlegar, linkTel, linkWhatsApp, mensajeError } from '@/lib/utils'
import type { FilaTablero, ParadaDia, ProximaVisita } from '@/lib/database.types'

// Visita médica: a qué médico ir o qué especialidad buscar en cada parada (lo arma Sergio en el panel).
type Objetivo = { parada_id: string; especialidad: string | null; orden: number; medico: { id: string; nombre: string; especialidad: string | null } | null }
type Datos = { paradas: ParadaDia[]; hoy: number; semana: number; pendientes?: ProximaVisita[]; objetivos?: Objetivo[]; base?: { lat: number | null; lng: number | null } | null }

export default function Hoy() {
  const { perfil, pendientes, esMedica, jornada } = useVendedor()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [guardadoEl, setGuardadoEl] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hoy = hoyIso()
  const clave = `hoy:${perfil.id}:${hoy}`

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const cache = await leerCache<Datos>(clave).catch(() => null)
      if (cache && vivo) { setDatos(cache.datos); setGuardadoEl(cache.guardado) }
      const sb = supabaseNavegador()
      const [p, t, pv] = await Promise.all([
        sb.rpc('vis_paradas_dia', { p_dia: hoy, p_vendedor: perfil.id }),
        sb.rpc('vis_tablero', { p_semana: lunesDe(hoy), p_vendedor: perfil.id }),
        sb.rpc('vis_proximas_visitas', { p_hasta: hoy }),
      ])
      if (!vivo) return
      if (p.error || t.error) {
        if (!cache) setError(mensajeError(p.error ?? t.error))
        return
      }
      const filas = (t.data ?? []) as FilaTablero[]
      const paradas = (p.data ?? []) as ParadaDia[]
      let objetivos: Objetivo[] = []
      let base: Datos['base'] = null
      if (esMedica) {
        const [o, b, c] = await Promise.all([
          paradas.length ? sb.from('vis_parada_objetivos').select('parada_id, especialidad, orden, medico:vis_medicos(id, nombre, especialidad)').in('parada_id', paradas.map((x) => x.parada_id)) : Promise.resolve({ data: [] }),
          sb.from('vis_vendedores').select('base_lat, base_lng').eq('id', perfil.id).maybeSingle(),
          sb.from('vis_config').select('base_lat, base_lng').maybeSingle(),
        ])
        if (!vivo) return
        objetivos = ((o.data ?? []) as Objetivo[]).sort((a, z) => a.orden - z.orden)
        base = b.data?.base_lat != null ? { lat: b.data.base_lat, lng: b.data.base_lng } : c.data ? { lat: c.data.base_lat, lng: c.data.base_lng } : null
      }
      const nuevo: Datos = {
        paradas,
        objetivos,
        base,
        hoy: filas.find((f) => f.dia === hoy)?.realizadas ?? 0,
        semana: filas.reduce((s, f) => s + Number(f.realizadas), 0),
        // Los de otros vendedores no: solo los míos (o los que dejé yo en la última visita).
        pendientes: ((pv.data ?? []) as ProximaVisita[]).filter((x) => x.vendedor_id === perfil.id || perfil.rol === 'vendedor'),
      }
      setDatos(nuevo)
      setGuardadoEl(null)
      setError(null)
      await guardarCache(clave, nuevo).catch(() => {})
    })()
    return () => { vivo = false }
  }, [clave, hoy, perfil.id, perfil.rol, esMedica])

  // Paradas que el vendedor decide saltar hoy: salen del recorrido de Google Maps y del mapa.
  // Quedan en el celular solo por el día (el tablero igual muestra planificadas vs. hechas).
  const claveSaltadas = `saltadas:${perfil.id}:${hoy}`
  const [saltadas, setSaltadas] = useState<Set<string>>(new Set())
  useEffect(() => {
    try { setSaltadas(new Set(JSON.parse(localStorage.getItem(claveSaltadas) ?? '[]') as string[])) } catch { /* sin almacenamiento */ }
  }, [claveSaltadas])
  function saltar(paradaId: string, si: boolean) {
    setSaltadas((s) => {
      const n = new Set(s)
      if (si) n.add(paradaId)
      else n.delete(paradaId)
      try { localStorage.setItem(claveSaltadas, JSON.stringify([...n])) } catch { /* nada */ }
      return n
    })
  }

  const puntos = useMemo<PuntoMapa[]>(() => (datos?.paradas ?? [])
    .filter((p) => p.lat != null && p.lng != null && !saltadas.has(p.parada_id))
    .map((p, i) => ({
      id: p.parada_id, lat: p.lat!, lng: p.lng!, etiqueta: String(i + 1),
      color: p.visitada ? '#6b7280' : COLOR_ESTADO[p.estado],
      titulo: p.razon_social, detalle: p.visitada ? 'Ya visitado' : (p.ciudad ?? ''),
      href: urlParaVisitar(esMedica, p.cliente_id, { parada: p.parada_id }), textoLink: esMedica ? 'Ver médicos' : 'Registrar visita',
    })), [datos, saltadas, esMedica])

  const pendientesHoy = useMemo(() => (datos?.paradas ?? []).filter((p) => !p.visitada && !saltadas.has(p.parada_id) && p.lat != null && p.lng != null), [datos, saltadas])
  const links = useMemo(() => linksGoogleMaps(null, pendientesHoy.map((p) => ({ lat: p.lat!, lng: p.lng! }))), [pendientesHoy])

  // Hora aproximada de llegada (visita médica): desde que inició la jornada, o desde las 8:00.
  const horas = useMemo(() => {
    if (!esMedica || !datos) return new Map<string, string>()
    const enOrden = datos.paradas.filter((p) => !saltadas.has(p.parada_id))
    const ini = jornada ? (() => { const d = new Date(jornada.inicio); return Math.max(d.getHours() * 60 + d.getMinutes(), 0) })() : 8 * 60
    const h = horasEstimadas(datos.base ?? null, enOrden, { inicioMin: ini })
    return new Map(enOrden.map((p, i) => [p.parada_id, fmtMin(h[i]!.llegada)]))
  }, [esMedica, datos, saltadas, jornada])
  const objetivosDe = (id: string) => (datos?.objetivos ?? []).filter((o) => o.parada_id === id)

  const extra = pendientes.visitas
  const enRuta = new Set((datos?.paradas ?? []).map((p) => p.cliente_id))
  const proximas = (datos?.pendientes ?? []).filter((x) => !enRuta.has(x.cliente_id))
  const paradasPorCliente = useMemo(() => new Map((datos?.paradas ?? []).map((p) => [p.cliente_id, p.parada_id])), [datos])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Hoy · {fmtFecha(hoy)}</h1>
      </div>

      <Tarjeta className="grid grid-cols-2 gap-2 text-center tabular">
        <div>
          <p className="text-3xl font-semibold">{datos ? datos.hoy + extra : '–'}<span className="text-lg text-tenue"> / {perfil.meta_diaria}</span></p>
          <p className="text-xs text-tenue">visitas hoy</p>
        </div>
        <div>
          <p className="text-3xl font-semibold">{datos ? datos.semana + extra : '–'}<span className="text-lg text-tenue"> / {perfil.meta_semanal}</span></p>
          <p className="text-xs text-tenue">esta semana</p>
        </div>
        {extra > 0 && <p className="col-span-2 text-xs text-tenue">Incluye {extra} sin subir todavía</p>}
      </Tarjeta>

      <BuscarCliente paradas={paradasPorCliente} />

      {guardadoEl && <Aviso tipo="alerta">Sin conexión: mostrando la ruta guardada {hace(new Date(guardadoEl))}.</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}

      {datos && datos.paradas.length === 0 && (
        <Vacio titulo="No tenés paradas para hoy">
          {esMedica ? <>Buscá el lugar arriba o en <Link href="/mapa" className="font-medium text-marca underline">Lugares</Link>, o cargalo en <Link href="/lugar/nuevo" className="font-medium text-marca underline">Nuevo lugar</Link>.</> : <>
          Si visitás a alguien igual, buscalo arriba o en <Link href="/mapa" className="font-medium text-marca underline">Mapa</Link>, o
          dalo de alta en <Link href="/prospecto/nuevo" className="font-medium text-marca underline">Nuevo cliente</Link>.</>}
        </Vacio>
      )}

      {puntos.length > 0 && <Mapa puntos={puntos} claveEncuadre={hoy} />}

      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-borde bg-superficie px-3 text-sm font-medium">
              <Navigation className="size-4 text-marca" aria-hidden />
              {links.length === 1 ? 'Abrir en Google Maps' : `Google Maps · tramo ${i + 1}`}
            </a>
          ))}
        </div>
      )}

      <ol className="flex flex-col gap-3">
        {datos?.paradas.map((p, i) => {
          const tel = linkTel(p.telefono)
          const wa = linkWhatsApp(p.telefono_norm)
          const salteada = !p.visitada && saltadas.has(p.parada_id)
          const comoLlegar = linkComoLlegar(p)
          return (
            <li key={p.parada_id}>
              <Tarjeta className={p.visitada || salteada ? 'opacity-70' : undefined}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: p.visitada ? '#6b7280' : COLOR_ESTADO[p.estado] }}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug">{p.razon_social}</p>
                    <p className="text-sm text-tenue">{[p.direccion, p.ciudad].filter(Boolean).join(' · ') || 'Sin dirección'}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <PuntoEstado estado={p.estado} conTexto />
                      <span className="text-xs text-tenue">Última visita: {hace(p.ultima_visita)}</span>
                    </div>
                    {(p.ultimo_resultado || p.ultima_observacion) && (
                      <p className="mt-1 text-sm text-tinta">
                        {p.ultimo_resultado && <strong>{p.ultimo_resultado}. </strong>}
                        {p.ultima_observacion}
                      </p>
                    )}
                    {esMedica && objetivosDe(p.parada_id).length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1 rounded-lg bg-fondo px-2.5 py-2 text-sm">
                        {objetivosDe(p.parada_id).map((o, k) => (
                          <li key={k} className="flex items-start gap-1.5">
                            <Stethoscope className="mt-0.5 size-3.5 shrink-0 text-marca" aria-hidden />
                            {o.medico ? <span><b>{o.medico.nombre}</b>{(o.especialidad ?? o.medico.especialidad) && <span className="text-tenue"> · {o.especialidad ?? o.medico.especialidad}</span>}</span>
                              : <span>Buscar médico de <b>{o.especialidad}</b></span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {esMedica && !p.visitada && horas.get(p.parada_id) && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-tenue"><Clock className="size-3.5" aria-hidden /> Llegada aprox. {horas.get(p.parada_id)}</p>
                    )}
                    {p.lat == null && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Sin ubicación cargada: al registrar la visita se puede guardar.</p>}
                    {salteada && <p className="mt-1 text-xs font-medium text-tenue">Salteada hoy: no está en el recorrido.</p>}
                  </div>
                </div>
                {!p.visitada && (
                  <div className="mt-3 flex gap-2">
                    {comoLlegar && (
                      <a href={comoLlegar} target="_blank" rel="noreferrer" className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-borde text-sm font-medium">
                        <Navigation className="size-4 text-marca" aria-hidden /> Cómo llegar
                      </a>
                    )}
                    <button type="button" onClick={() => saltar(p.parada_id, !salteada)} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-borde text-sm font-medium">
                      {salteada ? <><Undo2 className="size-4" aria-hidden /> Volver a incluir</> : <><SkipForward className="size-4" aria-hidden /> Saltar</>}
                    </button>
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  {p.visitada ? (
                    <span className="inline-flex flex-1 items-center justify-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400">
                      <CheckCircle2 className="size-4" aria-hidden /> Visitado
                    </span>
                  ) : (
                    <Link href={urlParaVisitar(esMedica, p.cliente_id, { parada: p.parada_id })} className="flex-1">
                      <Boton className="w-full">{esMedica ? 'Llegué · Ver médicos' : 'Llegué · Registrar visita'}</Boton>
                    </Link>
                  )}
                  {tel && <a href={tel} aria-label={`Llamar a ${p.razon_social}`} className="grid size-10 place-items-center rounded-lg border border-borde"><Phone className="size-4" /></a>}
                  {wa && <a href={wa} target="_blank" rel="noreferrer" aria-label={`WhatsApp a ${p.razon_social}`} className="grid size-10 place-items-center rounded-lg border border-borde"><MessageCircle className="size-4" /></a>}
                </div>
              </Tarjeta>
            </li>
          )
        })}
      </ol>

      {proximas.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="pendientes-titulo">
          <div>
            <h2 id="pendientes-titulo" className="text-lg font-semibold">Visitas pendientes</h2>
            <p className="text-sm text-tenue">Clientes a los que quedaste en volver y no están en la ruta de hoy.</p>
          </div>
          <ul className="flex flex-col gap-3">
            {proximas.map((x) => {
              const tel = linkTel(x.telefono)
              const wa = linkWhatsApp(x.telefono_norm)
              return (
                <li key={x.cliente_id}>
                  <Tarjeta className={x.dias_vencida > 0 ? 'border-amber-300 dark:border-amber-800' : undefined}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold leading-snug">{x.razon_social}</p>
                        <p className="text-sm text-tenue">{[x.direccion, x.ciudad].filter(Boolean).join(' · ') || 'Sin dirección'}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${x.dias_vencida > 0 ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'bg-fondo text-tenue'}`}>
                        {x.dias_vencida > 0 ? `vencida hace ${x.dias_vencida} día${x.dias_vencida > 1 ? 's' : ''}` : 'para hoy'}
                      </span>
                    </div>
                    {x.ultima_observacion && <p className="mt-1 text-sm">{x.ultima_observacion}</p>}
                    <p className="mt-1 text-xs text-tenue">Última visita {fmtFecha(x.ultima_visita)} · quedaste en volver el {fmtFecha(x.proxima_visita)}</p>
                    <div className="mt-3 flex gap-2">
                      <Link href={urlParaVisitar(esMedica, x.cliente_id)} className="flex-1"><Boton variante="secundario" className="w-full">{esMedica ? 'Ver médicos' : 'Registrar visita'}</Boton></Link>
                      {tel && <a href={tel} aria-label={`Llamar a ${x.razon_social}`} className="grid size-10 place-items-center rounded-lg border border-borde"><Phone className="size-4" /></a>}
                      {wa && <a href={wa} target="_blank" rel="noreferrer" aria-label={`WhatsApp a ${x.razon_social}`} className="grid size-10 place-items-center rounded-lg border border-borde"><MessageCircle className="size-4" /></a>}
                    </div>
                  </Tarjeta>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
