'use client'
// Mi semana: los lugares de cada día de la semana (los que armó el supervisor), con los médicos a ver y la hora
// pactada. La visitadora anticipa los próximos días y los reorganiza: cambia el orden de un día o pasa un lugar
// a otro día de la misma semana (0046). Lo que ya tiene visita, llegada o «no pude visitar» queda donde está.
import { textoRecupera } from '@/lib/medicos'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, MapPin, Navigation, Stethoscope } from 'lucide-react'
import { AVISO_SOLO_LECTURA, useVendedor } from '@/components/vendedor/Proveedor'
import { Aviso, Selector, Tarjeta, claseBoton } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtDia, fmtFecha, hoyIso, lunesDe, semanaIso, sumarDias } from '@/lib/fechas'
import { useParamUrl } from '@/lib/useParamUrl'
import { urlLugar } from '@/lib/rutas'
import { cn, linkComoLlegar, mensajeError } from '@/lib/utils'

type Parada = {
  id: string; dia: string; orden: number; hora_pactada: string | null; dia_anterior: string | null; cliente_id: string
  cliente: { razon_social: string; direccion: string | null; ciudad: string | null; lat: number | null; lng: number | null } | null
}
type Objetivo = { parada_id: string; orden: number; especialidad: string | null; hora_pactada: string | null; recupera_dia?: string | null; recupera_motivo?: string | null; medico: { nombre: string; especialidad: string | null } | null }
type Hecho = { visitas: number; llego: boolean; noPudo: boolean }

export default function MiSemana() {
  const { perfil, soloLectura } = useVendedor()
  const hoy = hoyIso()
  const [semana, setSemana] = useParamUrl('semana', lunesDe(hoy))
  const [paradas, setParadas] = useState<Parada[] | null>(null)
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  const [hechos, setHechos] = useState<Map<string, Hecho>>(new Map())
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const puedeMover = perfil.tipo === 'medica'

  const cargar = useCallback(async () => {
    const sb = supabaseNavegador()
    setError(null)
    const { data: rutas, error: e1 } = await sb.from('vis_rutas').select('id').eq('vendedor_id', perfil.id).eq('semana_inicio', semana).in('estado', ['publicada', 'cerrada'])
    if (e1) { setError(mensajeError(e1)); setParadas([]); return }
    const ids = (rutas ?? []).map((r) => r.id)
    if (!ids.length) { setParadas([]); setObjetivos([]); setHechos(new Map()); return }
    const { data: ps, error: e2 } = await sb.from('vis_ruta_paradas')
      .select('id, dia, orden, hora_pactada, dia_anterior, cliente_id, cliente:vis_clientes!vis_ruta_paradas_cliente_id_fkey(razon_social, direccion, ciudad, lat, lng)')
      .in('ruta_id', ids).order('dia').order('orden')
    if (e2) { setError(mensajeError(e2)); setParadas([]); return }
    const lista = (ps ?? []) as unknown as Parada[]
    const pids = lista.map((p) => p.id)
    const desde = new Date(`${semana}T00:00:00-03:00`).toISOString()
    const hasta = new Date(`${sumarDias(semana, 7)}T00:00:00-03:00`).toISOString()
    const [ro, rv, rl, rn] = await Promise.all([
      pids.length ? sb.from('vis_parada_objetivos').select('parada_id, orden, especialidad, hora_pactada, recupera_dia, recupera_motivo, medico:vis_medicos(nombre, especialidad)').in('parada_id', pids).order('orden') : Promise.resolve({ data: [] }),
      sb.from('vis_visitas').select('cliente_id, fecha_hora, ruta_parada_id').eq('vendedor_id', perfil.id).gte('fecha_hora', desde).lt('fecha_hora', hasta),
      sb.from('vis_llegadas').select('lugar_id, fecha_hora, parada_id').eq('vendedor_id', perfil.id).gte('fecha_hora', desde).lt('fecha_hora', hasta),
      sb.from('vis_no_visitados').select('lugar_id, fecha_hora, parada_id').eq('vendedor_id', perfil.id).gte('fecha_hora', desde).lt('fecha_hora', hasta),
    ])
    // Qué pasó en cada parada: por la parada o por el mismo lugar ese día.
    const dia = (f: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date(f))
    const m = new Map<string, Hecho>()
    for (const p of lista) {
      const de = <T extends { fecha_hora: string; parada_id?: string | null; ruta_parada_id?: string | null }>(xs: T[], lugar: (x: T) => string) =>
        xs.filter((x) => (x.parada_id ?? x.ruta_parada_id) === p.id || (lugar(x) === p.cliente_id && dia(x.fecha_hora) === p.dia))
      m.set(p.id, {
        visitas: de(rv.data ?? [], (x) => x.cliente_id).length,
        llego: de(rl.data ?? [], (x) => x.lugar_id).length > 0,
        noPudo: de(rn.data ?? [], (x) => x.lugar_id).length > 0,
      })
    }
    setParadas(lista); setObjetivos((ro.data ?? []) as unknown as Objetivo[]); setHechos(m)
  }, [perfil.id, semana])
  useEffect(() => { setParadas(null); void cargar() }, [cargar])

  const dias = useMemo(() => {
    const todos = Array.from({ length: 6 }, (_, i) => sumarDias(semana, i))
    // Lunes a viernes; el sábado solo si tiene algo.
    return todos.filter((d, i) => i < 5 || (paradas ?? []).some((p) => p.dia === d))
  }, [semana, paradas])
  const movible = (p: Parada) => {
    const h = hechos.get(p.id)
    return puedeMover && p.dia >= hoy && !h?.visitas && !h?.llego && !h?.noPudo
  }

  async function hacer(fn: () => PromiseLike<{ error: unknown }>, msg: string) {
    if (soloLectura) return setError(AVISO_SOLO_LECTURA)
    if (!navigator.onLine) return setError('Necesitás señal para reorganizar la semana.')
    setOcupado(true); setError(null); setOk(null)
    const { error: e } = await fn()
    setOcupado(false)
    if (e) return setError(mensajeError(e))
    setOk(msg)
    await cargar()
  }
  function pasarA(p: Parada, d: string) {
    if (!d || d === p.dia) return
    void hacer(() => supabaseNavegador().rpc('vis_mover_parada', { p_parada: p.id, p_dia: d }), `${p.cliente?.razon_social ?? 'El lugar'} pasó al ${fmtDia(d)}, con sus médicos.`)
  }
  function mover(delDia: Parada[], p: Parada, delta: number) {
    const libres = delDia.filter(movible)
    const i = libres.findIndex((x) => x.id === p.id)
    const otro = libres[i + delta]
    if (!otro) return
    const nuevos = [...libres]; nuevos[i] = otro; nuevos[i + delta] = p
    void hacer(() => supabaseNavegador().rpc('vis_ordenar_paradas', { p_paradas: nuevos.map((x) => x.id) }), 'Orden guardado.')
  }

  const lunesHoy = lunesDe(hoy)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Mi semana</h1>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Semana anterior" onClick={() => setSemana(sumarDias(semana, -7))} className="grid size-10 place-items-center rounded-lg border border-borde"><ChevronLeft className="size-4" aria-hidden /></button>
          <span className="min-w-36 text-center text-sm font-medium tabular">Sem {semanaIso(semana)} · {fmtFecha(semana).slice(0, 5)} al {fmtFecha(sumarDias(semana, 5)).slice(0, 5)}</span>
          <button type="button" aria-label="Semana siguiente" onClick={() => setSemana(sumarDias(semana, 7))} className="grid size-10 place-items-center rounded-lg border border-borde"><ChevronRight className="size-4" aria-hidden /></button>
        </div>
      </div>
      {semana !== lunesHoy && <button type="button" className="self-start text-sm underline" onClick={() => setSemana(lunesHoy)}>Volver a esta semana</button>}
      {puedeMover && <p className="text-sm text-tenue">Podés cambiar el orden de un día con las flechas o pasar un lugar a otro día de la semana con «Pasar a…». Los médicos del plan van con el lugar y tu supervisor ve el cambio.</p>}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}

      {paradas === null ? <div className="h-40 animate-pulse rounded-xl bg-borde/40" /> : paradas.length === 0 ? (
        <Aviso tipo="info">Todavía no hay lugares armados para esta semana.</Aviso>
      ) : dias.map((d) => {
        const delDia = paradas.filter((p) => p.dia === d)
        const pasado = d < hoy
        const libres = delDia.filter(movible)
        return (
          <Tarjeta key={d} className={cn('flex flex-col gap-2', d === hoy && 'border-marca', pasado && 'opacity-75')}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-semibold capitalize">{fmtDia(d)}{d === hoy && <span className="ml-2 rounded-full bg-marca px-2 py-0.5 text-xs font-medium normal-case text-sobre-marca">hoy</span>}</h2>
              <span className="text-xs text-tenue">{delDia.length ? `${delDia.length} lugar${delDia.length === 1 ? '' : 'es'}` : 'Sin lugares'}</span>
            </div>
            {d === hoy && <Link href="/hoy" className="text-sm underline">Ir a Hoy</Link>}
            <ol className="flex flex-col divide-y divide-borde">
              {delDia.map((p, i) => {
                const h = hechos.get(p.id)
                const objs = objetivos.filter((o) => o.parada_id === p.id)
                const puede = movible(p)
                const j = libres.findIndex((x) => x.id === p.id)
                const comoLlegar = p.cliente ? linkComoLlegar({ ...p.cliente }) : null
                return (
                  <li key={p.id} className="flex flex-col gap-1.5 py-2.5">
                    <div className="flex items-start gap-2">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-fondo text-xs font-semibold tabular">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{p.cliente?.razon_social ?? 'Lugar'}</p>
                        <p className="text-xs text-tenue">
                          {[p.hora_pactada ? `Hora pactada ${p.hora_pactada.slice(0, 5)}` : null, p.cliente?.direccion].filter(Boolean).join(' · ')}
                          {p.dia_anterior && p.dia_anterior !== p.dia && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">pasado del {fmtDia(p.dia_anterior)}</span>}
                        </p>
                        {h?.visitas ? <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400"><CheckCircle2 className="size-3.5" aria-hidden /> {h.visitas} visita{h.visitas === 1 ? '' : 's'}</p>
                          : h?.noPudo ? <p className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">No pudiste visitarlo</p>
                          : h?.llego ? <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-300"><MapPin className="size-3.5" aria-hidden /> Llegaste</p>
                          : pasado ? <p className="mt-0.5 text-xs font-medium text-red-700 dark:text-red-400">No fuiste</p> : null}
                      </div>
                      {puede && (
                        <div className="flex shrink-0">
                          <button type="button" aria-label={`Subir ${p.cliente?.razon_social}`} disabled={ocupado || j <= 0} onClick={() => mover(delDia, p, -1)} className="grid size-9 place-items-center rounded-lg hover:bg-fondo disabled:opacity-30"><ArrowUp className="size-4" aria-hidden /></button>
                          <button type="button" aria-label={`Bajar ${p.cliente?.razon_social}`} disabled={ocupado || j === libres.length - 1} onClick={() => mover(delDia, p, 1)} className="grid size-9 place-items-center rounded-lg hover:bg-fondo disabled:opacity-30"><ArrowDown className="size-4" aria-hidden /></button>
                        </div>
                      )}
                    </div>
                    {objs.length > 0 && (
                      <ul className="ml-8 flex flex-col gap-0.5 text-sm">
                        {objs.map((o, k) => (
                          <li key={k} className="flex items-start gap-1.5">
                            <Stethoscope className="mt-0.5 size-3.5 shrink-0 text-marca" aria-hidden />
                            <span>{o.hora_pactada && <span className="tabular text-tenue">{o.hora_pactada.slice(0, 5)} · </span>}{o.medico ? o.medico.nombre : `Buscar médico de ${o.especialidad}`}{o.medico?.especialidad && <span className="text-tenue"> · {o.medico.especialidad}</span>}{textoRecupera(o) && <span className="block text-xs font-medium text-sky-800 dark:text-sky-300">↻ {textoRecupera(o)}</span>}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="ml-8 flex flex-wrap items-center gap-2">
                      {puede && (
                        <Selector aria-label={`Pasar ${p.cliente?.razon_social} a otro día`} className="w-auto py-1.5 text-sm" value="" disabled={ocupado} onChange={(e) => pasarA(p, e.target.value)}>
                          <option value="">Pasar a…</option>
                          {Array.from({ length: 6 }, (_, k) => sumarDias(semana, k)).filter((x) => x >= hoy && x !== p.dia).map((x) => <option key={x} value={x}>{fmtDia(x)}</option>)}
                        </Selector>
                      )}
                      {!pasado && <Link href={urlLugar(p.cliente_id, { parada: p.id })} className={claseBoton({ variante: 'secundario', className: 'min-h-9 px-2.5 text-sm' })}>Ver lugar</Link>}
                      {!pasado && comoLlegar && <a href={comoLlegar} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline"><Navigation className="size-3.5" aria-hidden /> Cómo llegar</a>}
                      {!puede && !pasado && puedeMover && (h?.visitas || h?.llego || h?.noPudo) && <span className="text-xs text-tenue">Ya empezado: queda en este día.</span>}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Tarjeta>
        )
      })}
    </div>
  )
}
