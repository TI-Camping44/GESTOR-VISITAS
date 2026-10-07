'use client'
// Planificador de una ruta (BRIEF §6 supervisor 1): clientes de la zona → días Lun–Sáb,
// orden de paradas (vecino más cercano + 2-opt), publicar, duplicar a otra semana y,
// al costado, lo hecho en la zona en los últimos 60 días (requerimiento 2).
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { Mapa, type PuntoMapa } from '@/components/map/MapaDinamico'
import { Aviso, Boton, Entrada, Insignia, PuntoEstado, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtDia, fmtFecha, hace, hoyIso, lunesDe, semanaIso, sumarDias } from '@/lib/fechas'
import { ordenarParadas } from '@/lib/geo'
import { COLOR_ESTADO, VIS } from '@/lib/config'
import { COLOR_ESTADO_RUTA, ETIQUETA_ESTADO_RUTA, renombrarSemana } from '@/lib/rutas'
import { repartirEnDias, type Asignacion } from '@/lib/sugerencia'
import { cn, mensajeError } from '@/lib/utils'
import type { EstadoCliente, EstadoRuta, HistorialZona, Parada, ProximaVisita, Ruta, Sugerida, Vendedor, Zona } from '@/lib/database.types'

type Cand = { id: string; razon_social: string; ciudad: string | null; lat: number | null; lng: number | null; estado: EstadoCliente; ultima_visita: string | null; zona_id: string | null }
const LETRA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const CAMPOS_CAND = 'id, razon_social, ciudad, lat, lng, estado, ultima_visita, zona_id'

export default function Planificador({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const sb = supabaseNavegador()
  const [ruta, setRuta] = useState<Ruta | null>(null)
  const [vendedor, setVendedor] = useState<Vendedor | null>(null)
  const [baseDeposito, setBaseDeposito] = useState<{ lat: number; lng: number } | null>(VIS.base)
  const [zona, setZona] = useState<Zona | null>(null)
  const [paradas, setParadas] = useState<Parada[]>([])
  const [base, setBase] = useState<Cand[]>([])
  const [extras, setExtras] = useState<Cand[]>([])
  const [historial, setHistorial] = useState<HistorialZona[] | null>(null)
  const [todasZonas, setTodasZonas] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [diaSel, setDiaSel] = useState(0)
  const [destinoDup, setDestinoDup] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [proximas, setProximas] = useState<Map<string, string>>(new Map())
  const [sugerencia, setSugerencia] = useState<Asignacion<Sugerida>[] | null>(null)
  const [conSabado, setConSabado] = useState(false)

  const cargarParadas = useCallback(async () => {
    const { data, error } = await sb.from('vis_ruta_paradas').select('*').eq('ruta_id', id).order('dia').order('orden')
    if (error) setError(mensajeError(error))
    else setParadas(data ?? [])
  }, [id, sb])

  useEffect(() => {
    ;(async () => {
      const { data: r, error } = await sb.from('vis_rutas').select('*').eq('id', id).maybeSingle()
      if (error || !r) { setError(error ? mensajeError(error) : 'Ruta inexistente.'); return }
      setRuta(r)
      setDestinoDup(sumarDias(r.semana_inicio, 7))
      const idxHoy = LETRA.findIndex((_, i) => sumarDias(r.semana_inicio, i) === hoyIso())
      if (idxHoy >= 0) setDiaSel(idxHoy)
      const [v, z] = await Promise.all([
        sb.from('vis_vendedores').select('*').eq('id', r.vendedor_id).single(),
        r.zona_id ? sb.from('vis_zonas').select('*').eq('id', r.zona_id).single() : Promise.resolve({ data: null }),
      ])
      setVendedor(v.data)
      setZona(z.data)
      const { data: cfg } = await sb.from('vis_config').select('base_lat, base_lng').maybeSingle()
      if (cfg?.base_lat != null && cfg.base_lng != null) setBaseDeposito({ lat: cfg.base_lat, lng: cfg.base_lng })
      if (r.zona_id) {
        const { data } = await sb.rpc('vis_zona_historial', { p_zona: r.zona_id, p_dias: 60 })
        setHistorial((data ?? []) as HistorialZona[])
      } else setHistorial([])
      await cargarParadas()
      const { data: pv } = await sb.rpc('vis_proximas_visitas', { p_hasta: sumarDias(r.semana_inicio, 6) })
      setProximas(new Map(((pv ?? []) as ProximaVisita[]).map((x) => [x.cliente_id, x.proxima_visita])))
    })()
  }, [id, sb, cargarParadas])

  // Candidatos: clientes de la zona de la ruta (o todos), más los que ya están en paradas.
  useEffect(() => {
    if (!ruta) return
    let q = sb.from('vis_clientes_v').select(CAMPOS_CAND).order('razon_social').limit(3000)
    if (ruta.zona_id && !todasZonas) q = q.eq('zona_id', ruta.zona_id)
    q.then(({ data, error }) => { if (error) setError(mensajeError(error)); else setBase((data ?? []) as Cand[]) })
  }, [ruta, todasZonas, sb])

  useEffect(() => {
    const conocidos = new Set([...base, ...extras].map((c) => c.id))
    const faltan = [...new Set(paradas.map((p) => p.cliente_id))].filter((cid) => !conocidos.has(cid))
    if (!faltan.length) return
    sb.from('vis_clientes_v').select(CAMPOS_CAND).in('id', faltan)
      .then(({ data }) => setExtras((e) => [...e, ...((data ?? []) as Cand[])]))
  }, [paradas, base, extras, sb])

  const cands = useMemo(() => {
    const ids = new Set(base.map((c) => c.id))
    return [...base, ...extras.filter((c) => !ids.has(c.id))]
  }, [base, extras])

  const dias = useMemo(() => (ruta ? LETRA.map((_, i) => sumarDias(ruta.semana_inicio, i)) : []), [ruta])
  const porId = useMemo(() => new Map(cands.map((c) => [c.id, c])), [cands])
  const delDia = (dia: string) => paradas.filter((p) => p.dia === dia).sort((a, b) => a.orden - b.orden)
  const diasDe = (cid: string) => new Set(paradas.filter((p) => p.cliente_id === cid).map((p) => p.dia))
  const origen = vendedor?.base_lat != null && vendedor.base_lng != null ? { lat: vendedor.base_lat, lng: vendedor.base_lng } : baseDeposito

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    return t ? cands.filter((c) => c.razon_social.toLowerCase().includes(t) || (c.ciudad ?? '').toLowerCase().includes(t)) : cands
  }, [cands, busqueda])

  async function hacer(fn: () => Promise<{ error: unknown } | void>) {
    setOcupado(true)
    setError(null)
    try {
      const r = await fn()
      if (r && r.error) setError(mensajeError(r.error))
      await cargarParadas()
    } finally { setOcupado(false) }
  }

  const alternarDia = (cid: string, dia: string) => hacer(async () => {
    const ya = paradas.find((p) => p.cliente_id === cid && p.dia === dia)
    if (ya) return sb.from('vis_ruta_paradas').delete().eq('id', ya.id)
    const orden = Math.max(0, ...delDia(dia).map((p) => p.orden)) + 1
    return sb.from('vis_ruta_paradas').insert({ ruta_id: id, cliente_id: cid, dia, orden })
  })

  const mover = (p: Parada, delta: -1 | 1) => hacer(async () => {
    const lista = delDia(p.dia)
    const i = lista.findIndex((x) => x.id === p.id)
    const otro = lista[i + delta]
    if (!otro) return
    const r1 = await sb.from('vis_ruta_paradas').update({ orden: otro.orden }).eq('id', p.id)
    if (r1.error) return r1
    return sb.from('vis_ruta_paradas').update({ orden: p.orden === otro.orden ? p.orden + delta : p.orden }).eq('id', otro.id)
  })

  const ordenarDia = (dia: string) => hacer(async () => {
    const lista = delDia(dia)
    const conUbic = lista.filter((p) => porId.get(p.cliente_id)?.lat != null).map((p) => ({ p, lat: porId.get(p.cliente_id)!.lat!, lng: porId.get(p.cliente_id)!.lng! }))
    const sinUbic = lista.filter((p) => porId.get(p.cliente_id)?.lat == null)
    const orden = [...ordenarParadas(conUbic, origen).map((x) => x.p), ...sinUbic]
    const res = await Promise.all(orden.map((p, i) => sb.from('vis_ruta_paradas').update({ orden: i + 1 }).eq('id', p.id)))
    return res.find((r) => r.error) ?? undefined
  })

  const cambiarEstado = (estado: EstadoRuta) => hacer(async () => {
    const r = await sb.from('vis_rutas').update({ estado }).eq('id', id).select('*').single()
    if (!r.error) setRuta(r.data)
    return r
  })

  async function duplicar() {
    if (!ruta || !destinoDup) return
    const lunes = lunesDe(destinoDup)
    const desfase = Math.round((new Date(`${lunes}T12:00:00Z`).getTime() - new Date(`${ruta.semana_inicio}T12:00:00Z`).getTime()) / 86400000)
    setOcupado(true)
    setError(null)
    const { data: yo } = await sb.rpc('vis_mi_id')
    const nueva = await sb.from('vis_rutas').insert({
      nombre: renombrarSemana(ruta.nombre, semanaIso(lunes)), vendedor_id: ruta.vendedor_id, zona_id: ruta.zona_id,
      semana_inicio: lunes, notas: ruta.notas, creado_por: yo ?? null,
    }).select('id').single()
    if (nueva.error) { setOcupado(false); setError(nueva.error.code === '23505' ? 'Ya existe una ruta con ese nombre en esa semana.' : mensajeError(nueva.error)); return }
    if (paradas.length) {
      const { error } = await sb.from('vis_ruta_paradas').insert(paradas.map((p) => ({ ruta_id: nueva.data.id, cliente_id: p.cliente_id, dia: sumarDias(p.dia, desfase), orden: p.orden })))
      if (error) { setOcupado(false); setError(mensajeError(error)); return }
    }
    router.push(`/rutas/${nueva.data.id}`)
  }

  async function sugerir() {
    if (!ruta) return
    setOcupado(true)
    setError(null)
    const { data, error } = await sb.rpc('vis_sugerir_paradas', { p_ruta: id })
    setOcupado(false)
    if (error) return setError(mensajeError(error))
    const meta = vendedor?.meta_diaria ?? 10
    // Solo días que todavía no pasaron.
    const capacidad = dias.slice(0, conSabado ? 6 : 5).filter((d) => d >= hoyIso()).map((d) => ({ dia: d, libres: Math.max(0, meta - delDia(d).length) }))
    const lista = ((data ?? []) as Sugerida[]).map((x) => ({ ...x, puntaje: Number(x.puntaje) }))
    const r = repartirEnDias(lista, capacidad, origen)
    if (!r.length) setError(!capacidad.length ? 'Los días de esta ruta ya pasaron.' : lista.length ? 'Los días que quedan ya están completos según la meta diaria del vendedor.' : 'No hay clientes para sugerir en esta zona (o ya se visitaron en las últimas 2 semanas).')
    setSugerencia(r.length ? r : null)
  }

  async function aplicarSugerencia() {
    if (!sugerencia?.length) return
    await hacer(async () => {
      const filas = sugerencia.map((a) => ({ ruta_id: id, cliente_id: a.c.cliente_id, dia: a.dia, orden: Math.max(0, ...delDia(a.dia).map((p) => p.orden)) + a.orden }))
      const r = await sb.from('vis_ruta_paradas').insert(filas)
      if (!r.error) setSugerencia(null)
      return r
    })
  }

  const diaActivo = dias[diaSel] ?? ''
  const puntos = useMemo<PuntoMapa[]>(() => {
    const paradasDia = paradas.filter((p) => p.dia === diaActivo).sort((a, b) => a.orden - b.orden)
    const enDia = new Map(paradasDia.map((p, i) => [p.cliente_id, i + 1]))
    return cands.filter((c) => c.lat != null && c.lng != null).map((c) => ({
      id: c.id, lat: c.lat!, lng: c.lng!, color: enDia.has(c.id) ? '#1f6f4a' : COLOR_ESTADO[c.estado],
      etiqueta: enDia.has(c.id) ? String(enDia.get(c.id)) : undefined,
      titulo: c.razon_social, detalle: enDia.has(c.id) ? `Parada ${enDia.get(c.id)} del ${fmtDia(diaActivo)}` : `Tocá para sumar al ${fmtDia(diaActivo)}`,
    }))
  }, [cands, paradas, diaActivo])

  if (error && !ruta) return <Aviso tipo="error">{error}</Aviso>
  if (!ruta) return <div className="h-40 animate-pulse rounded-xl bg-borde/40" />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/rutas" className="text-sm text-marca">← Rutas</Link>
          <h1 className="text-2xl font-semibold">{ruta.nombre}</h1>
          <p className="text-sm text-tenue">
            {vendedor?.nombre} · {zona?.nombre ?? 'Sin zona'} · semana del {fmtFecha(ruta.semana_inicio)} · {paradas.length} paradas
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Insignia className={COLOR_ESTADO_RUTA[ruta.estado]}>{ETIQUETA_ESTADO_RUTA[ruta.estado]}</Insignia>
          <label className="flex items-center gap-1.5 text-xs text-tenue"><input type="checkbox" checked={conSabado} onChange={(e) => setConSabado(e.target.checked)} /> con sábado</label>
          <Boton variante="secundario" disabled={ocupado} onClick={() => void sugerir()}><Sparkles className="size-4" aria-hidden /> Sugerir paradas</Boton>
          {ruta.estado === 'borrador' && <Boton disabled={ocupado || !paradas.length} onClick={() => void cambiarEstado('publicada')}>Publicar</Boton>}
          {ruta.estado === 'publicada' && <>
            <Boton variante="secundario" disabled={ocupado} onClick={() => void cambiarEstado('borrador')}>Volver a borrador</Boton>
            <Boton variante="secundario" disabled={ocupado} onClick={() => void cambiarEstado('cerrada')}>Cerrar</Boton>
          </>}
          {ruta.estado === 'cerrada' && <Boton variante="secundario" disabled={ocupado} onClick={() => void cambiarEstado('publicada')}>Reabrir</Boton>}
        </div>
      </div>
      {!origen && <Aviso tipo="alerta">Sin punto de salida: “Ordenar” arranca desde la primera parada. Cargá el del vendedor o el del depósito en Vendedores.</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}

      {sugerencia && (
        <Tarjeta className="flex flex-col gap-3 border-marca">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">Sugerencia: {sugerencia.length} clientes en {new Set(sugerencia.map((a) => a.dia)).size} días</h2>
              <p className="text-sm text-tenue">
                Prioriza próximas visitas, clientes sin movimiento, los que más compran y los que hace más tiempo no se visitan.
                Agrupa por ciudad y ordena desde el punto de salida. Hasta {vendedor?.meta_diaria ?? 10} por día. Sacá los que no quieras.
              </p>
            </div>
            <div className="flex gap-2">
              <Boton disabled={ocupado} onClick={() => void aplicarSugerencia()}>Agregar a la ruta</Boton>
              <Boton variante="secundario" onClick={() => setSugerencia(null)}>Descartar</Boton>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[...new Set(sugerencia.map((a) => a.dia))].map((d) => (
              <div key={d} className="rounded-lg bg-fondo p-2">
                <p className="mb-1 text-sm font-semibold">{fmtDia(d)} <span className="font-normal text-tenue">· {sugerencia.filter((a) => a.dia === d).length}</span></p>
                <ol className="flex flex-col gap-1">
                  {sugerencia.filter((a) => a.dia === d).map((a) => (
                    <li key={a.c.cliente_id} className="flex items-start gap-2 rounded-md bg-superficie px-2 py-1.5">
                      <span className="mt-0.5 text-xs font-semibold text-tenue tabular">{a.orden}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5"><PuntoEstado estado={a.c.estado} /><p className="truncate text-sm font-medium">{a.c.razon_social}</p></div>
                        <p className="truncate text-xs text-tenue">{a.c.ciudad ?? 'Sin ciudad'}{a.c.motivos.length ? ` · ${a.c.motivos.join(' · ')}` : ''}</p>
                      </div>
                      <button type="button" aria-label={`Sacar ${a.c.razon_social}`} className="rounded p-0.5 text-tenue hover:text-red-600"
                        onClick={() => setSugerencia((s) => { const n = (s ?? []).filter((x) => x.c.cliente_id !== a.c.cliente_id); return n.length ? n : null })}>
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
        {/* Clientes candidatos */}
        <Tarjeta className="flex max-h-[80vh] flex-col gap-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Clientes {zona && !todasZonas ? `de ${zona.nombre}` : ''}</h2>
            {zona && (
              <label className="flex items-center gap-1.5 text-xs text-tenue">
                <input type="checkbox" checked={todasZonas} onChange={(e) => setTodasZonas(e.target.checked)} /> todas las zonas
              </label>
            )}
          </div>
          <Entrada placeholder="Buscar por nombre o ciudad" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar cliente" />
          <ul className="-mx-1 flex-1 overflow-y-auto">
            {filtrados.length === 0 && <li className="px-1 py-4 text-center text-sm text-tenue">{cands.length ? 'Sin coincidencias.' : 'No hay clientes en esta zona. Asignalos en Clientes.'}</li>}
            {filtrados.slice(0, 400).map((c) => {
              const enDias = diasDe(c.id)
              return (
                <li key={c.id} className="border-b border-borde px-1 py-2 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.razon_social}</p>
                      <div className="flex items-center gap-2"><PuntoEstado estado={c.estado} /><span className="truncate text-xs text-tenue">{c.ciudad ?? '—'} · {hace(c.ultima_visita)}</span></div>
                      {proximas.has(c.id) && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Próxima visita: {fmtFecha(proximas.get(c.id)!)}</p>}
                    </div>
                  </div>
                  <div className="mt-1.5 flex gap-1" role="group" aria-label={`Días para ${c.razon_social}`}>
                    {dias.map((d, i) => (
                      <button key={d} type="button" disabled={ocupado} aria-pressed={enDias.has(d)} onClick={() => void alternarDia(c.id, d)}
                        className={cn('flex-1 rounded-md border px-1 py-1 text-xs font-medium', enDias.has(d) ? 'border-marca bg-marca text-white' : 'border-borde hover:border-marca')}>
                        {LETRA[i]}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
          {filtrados.length > 400 && <p className="text-xs text-tenue">Mostrando 400 de {filtrados.length}. Afiná la búsqueda.</p>}
        </Tarjeta>

        <div className="flex min-w-0 flex-col gap-4">
          {/* Días */}
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Día">
            {dias.map((d, i) => (
              <button key={d} role="tab" aria-selected={diaSel === i} onClick={() => setDiaSel(i)}
                className={cn('shrink-0 rounded-lg px-3 py-2 text-sm font-medium', diaSel === i ? 'bg-marca text-white' : 'bg-superficie text-tinta border border-borde')}>
                {fmtDia(d)} <span className="tabular opacity-80">({delDia(d).length})</span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <Tarjeta className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">Paradas del {fmtDia(diaActivo)}</h2>
                <Boton variante="secundario" disabled={ocupado || delDia(diaActivo).length < 2} onClick={() => void ordenarDia(diaActivo)}>
                  <Wand2 className="size-4" aria-hidden /> Ordenar
                </Boton>
              </div>
              {delDia(diaActivo).length === 0 ? <Vacio titulo="Sin paradas este día">Sumá clientes desde la lista, tocándolos en el mapa o con “Sugerir paradas”.</Vacio> : (
                <ol className="flex flex-col gap-1">
                  {delDia(diaActivo).map((p, i, arr) => {
                    const c = porId.get(p.cliente_id)
                    return (
                      <li key={p.id} className="flex items-center gap-2 rounded-lg bg-fondo px-2 py-1.5">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-marca text-xs font-semibold text-white">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{c?.razon_social ?? '…'}</p>
                          <p className="truncate text-xs text-tenue">{c?.ciudad ?? ''}{c && c.lat == null ? ' · sin ubicación' : ''}</p>
                        </div>
                        <button type="button" aria-label="Subir" disabled={ocupado || i === 0} onClick={() => void mover(p, -1)} className="rounded p-1 disabled:opacity-30"><ArrowUp className="size-4" /></button>
                        <button type="button" aria-label="Bajar" disabled={ocupado || i === arr.length - 1} onClick={() => void mover(p, 1)} className="rounded p-1 disabled:opacity-30"><ArrowDown className="size-4" /></button>
                        <button type="button" aria-label="Quitar" disabled={ocupado} onClick={() => void hacer(async () => sb.from('vis_ruta_paradas').delete().eq('id', p.id))} className="rounded p-1 text-red-600"><Trash2 className="size-4" /></button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Tarjeta>
            <Mapa puntos={puntos} claveEncuadre={`${id}-${cands.length > 0}-${todasZonas}`}
              alClicPunto={(cid) => { if (!delDia(diaActivo).some((p) => p.cliente_id === cid)) void alternarDia(cid, diaActivo) }}
              className="h-96 w-full overflow-hidden rounded-xl border border-borde" />
          </div>

          {/* Lo hecho en la zona */}
          <Tarjeta className="overflow-x-auto p-0">
            <h2 className="px-4 pt-4 font-semibold">Lo hecho en {zona?.nombre ?? 'esta zona'} en los últimos 60 días</h2>
            {!ruta.zona_id ? <p className="px-4 pb-4 pt-1 text-sm text-tenue">La ruta no tiene zona asignada.</p> : historial === null ? <p className="p-4 text-sm text-tenue">Cargando…</p> : historial.length === 0 ? (
              <p className="px-4 pb-4 pt-1 text-sm text-tenue">Sin visitas registradas en la zona en los últimos 60 días.</p>
            ) : (
              <table className="mt-2 w-full min-w-[720px] text-sm">
                <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
                  <th className="px-4 py-2 font-medium">Cliente</th><th className="px-2 py-2 font-medium">Visitas</th><th className="px-2 py-2 font-medium">Última</th>
                  <th className="px-2 py-2 font-medium">Resultado</th><th className="px-2 py-2 font-medium">Última observación</th><th className="px-4 py-2 font-medium">Quién fue</th>
                </tr></thead>
                <tbody>
                  {historial.map((h) => (
                    <tr key={h.cliente_id} className="border-b border-borde align-top last:border-0">
                      <td className="px-4 py-2"><div className="flex items-center gap-2"><PuntoEstado estado={h.estado} /><span className="font-medium">{h.razon_social}</span></div><span className="text-xs text-tenue">{h.ciudad}</span></td>
                      <td className="px-2 py-2 tabular">{h.visitas}{h.hizo_pedido > 0 && <span className="text-xs text-green-700 dark:text-green-400"> · {h.hizo_pedido} pedido{h.hizo_pedido > 1 ? 's' : ''}</span>}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{fmtFecha(h.ultima_visita)}</td>
                      <td className="px-2 py-2">{h.ultimo_resultado ?? '—'}</td>
                      <td className="px-2 py-2">{h.ultima_observacion ?? '—'}</td>
                      <td className="px-4 py-2">{h.ultimo_vendedor ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Tarjeta>

          <Tarjeta className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="dup" className="mb-1 block text-sm font-medium">Duplicar esta ruta a la semana del</label>
              <Selector id="dup" value={destinoDup} onChange={(e) => setDestinoDup(e.target.value)}>
                {[1, 2, 3, 4].map((n) => { const l = sumarDias(ruta.semana_inicio, 7 * n); return <option key={l} value={l}>Sem {semanaIso(l)} · {fmtFecha(l)}</option> })}
              </Selector>
            </div>
            <Boton variante="secundario" disabled={ocupado} onClick={() => void duplicar()}>Duplicar</Boton>
            <p className="text-xs text-tenue">Copia las paradas en los mismos días de la semana, como borrador.</p>
          </Tarjeta>
        </div>
      </div>
    </div>
  )
}
