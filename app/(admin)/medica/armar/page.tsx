'use client'
// Visita médica → Armar el día (pedido de Sergio): el supervisor arma, desde el panel y sin planilla, a qué
// lugares va la visitadora cada día y, en cada lugar, a qué médicos ver y en qué orden. La visitadora lo ve en
// Hoy y en el lugar («Para ver hoy», con «Registrar visita» y «No está» en cada médico).
// Una ruta por semana y visitadora (como «Llegué acá» y la planilla); se crea publicada al agregar el primer lugar.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Copy, Plus, Search, Trash2, UserPlus } from 'lucide-react'
import { Aviso, Boton, Entrada, Selector, Tarjeta, Vacio } from '@/components/ui'
import { SelectorSemana } from '@/components/admin/SelectorSemana'
import { ChipsDias } from '@/components/admin/medica/ChipsDias'
import { useLugares, useMedicos, useVisitadoras } from '@/components/admin/medica/datos'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtDia, hoyIso, lunesDe, semanaIso, sumarDias } from '@/lib/fechas'
import { DIAS_SEMANA, diasDeHorario, tocaVisitar } from '@/lib/medicos'
import { useParamUrl } from '@/lib/useParamUrl'
import { cn, mensajeError } from '@/lib/utils'
import type { Medico } from '@/lib/database.types'

type Parada = { id: string; ruta_id: string; cliente_id: string; dia: string; orden: number; hora_pactada: string | null }
type Objetivo = { id: string; parada_id: string; medico_id: string | null; especialidad: string | null; orden: number }
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function ArmarDia() {
  const sb = supabaseNavegador()
  const visitadoras = useVisitadoras()
  const lugares = useLugares()
  const { medicos } = useMedicos()
  const [semana, setSemana] = useParamUrl('semana', lunesDe(hoyIso()))
  const [quienUrl, setQuien] = useParamUrl('visitadora', '')
  const activas = visitadoras.filter((v) => v.activo)
  const quien = quienUrl || activas[0]?.id || ''
  const dias = useMemo(() => Array.from({ length: 6 }, (_, i) => sumarDias(semana, i)), [semana])
  const [diaUrl, setDia] = useParamUrl('dia', '')
  const dia = dias.includes(diaUrl) ? diaUrl : (dias.includes(hoyIso()) ? hoyIso() : dias[0]!)
  const [paradas, setParadas] = useState<Parada[] | null>(null)
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  const [buscar, setBuscar] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!quien) return
    const { data: rutas, error: e1 } = await sb.from('vis_rutas').select('id').eq('vendedor_id', quien).eq('semana_inicio', semana)
    if (e1) return setError(mensajeError(e1))
    const ids = (rutas ?? []).map((r) => r.id)
    if (!ids.length) { setParadas([]); setObjetivos([]); return }
    const { data: ps, error: e2 } = await sb.from('vis_ruta_paradas').select('id, ruta_id, cliente_id, dia, orden, hora_pactada').in('ruta_id', ids).order('dia').order('orden')
    if (e2) return setError(mensajeError(e2))
    setParadas((ps ?? []) as Parada[])
    const pids = (ps ?? []).map((p) => p.id)
    const { data: os } = pids.length ? await sb.from('vis_parada_objetivos').select('id, parada_id, medico_id, especialidad, orden').in('parada_id', pids).order('orden') : { data: [] }
    setObjetivos((os ?? []) as Objetivo[])
  }, [sb, quien, semana])
  useEffect(() => { setParadas(null); void cargar() }, [cargar])

  const hacer = async (fn: () => Promise<{ error: unknown } | void>, ok?: string) => {
    setOcupado(true); setError(null); setAviso(null)
    try {
      const r = await fn()
      if (r && r.error) throw r.error
      if (ok) setAviso(ok)
    } catch (e) { setError(mensajeError(e)) } finally { setOcupado(false); void cargar() }
  }

  const deLaVisitadora = useMemo(() => (lugares ?? []).filter((l) => l.vendedor_id === quien), [lugares, quien])
  const nombreLugar = (id: string) => (lugares ?? []).find((l) => l.id === id)?.razon_social ?? '…'
  const delDia = (paradas ?? []).filter((p) => p.dia === dia).sort((a, b) => a.orden - b.orden)
  const enDia = new Set(delDia.map((p) => p.cliente_id))
  const cuantos = (d: string) => (paradas ?? []).filter((p) => p.dia === d).length
  const medicosDe = (lugarId: string) => (medicos ?? []).filter((m) => m.lugares.some((l) => l.lugar_id === lugarId))
  const objetivosDe = (paradaId: string) => objetivos.filter((o) => o.parada_id === paradaId).sort((a, b) => a.orden - b.orden)
  const candidatos = useMemo(() => {
    const t = normal(buscar.trim())
    return deLaVisitadora.filter((l) => !t || normal([l.razon_social, l.direccion, l.ciudad].filter(Boolean).join(' ')).includes(t))
  }, [deLaVisitadora, buscar])

  // La ruta de esa semana (una por visitadora); si no hay, se crea publicada.
  async function rutaDeLaSemana(): Promise<string> {
    const { data } = await sb.from('vis_rutas').select('id, estado').eq('vendedor_id', quien).eq('semana_inicio', semana).order('created_at').limit(1)
    if (data?.[0]) {
      if (data[0].estado === 'borrador') await sb.from('vis_rutas').update({ estado: 'publicada' }).eq('id', data[0].id)
      return data[0].id
    }
    const { data: yo } = await sb.rpc('vis_mi_id')
    const nombre = visitadoras.find((v) => v.id === quien)?.nombre.split(' ')[0] ?? ''
    const { data: nueva, error } = await sb.from('vis_rutas').insert({ nombre: `Visita médica – Sem ${semanaIso(semana)} – ${nombre}`, vendedor_id: quien, semana_inicio: semana, estado: 'publicada', creado_por: yo as string }).select('id').single()
    if (error) throw error
    return nueva.id
  }

  async function agregarLugar(lugarId: string, d = dia, orden?: number, hora: string | null = null) {
    const ruta = await rutaDeLaSemana()
    const o = orden ?? Math.max(0, ...(paradas ?? []).filter((p) => p.dia === d).map((p) => p.orden)) + 1
    return sb.from('vis_ruta_paradas').insert({ ruta_id: ruta, cliente_id: lugarId, dia: d, orden: o, hora_pactada: hora }).select('id').single()
  }
  // Agrega médicos (o una especialidad a buscar) al final de la lista del lugar, en el orden dado.
  async function agregarObjetivos(paradaId: string, items: { medico_id: string | null; especialidad: string | null }[]) {
    let orden = Math.max(0, ...objetivosDe(paradaId).map((o) => o.orden))
    return sb.from('vis_parada_objetivos').insert(items.map((x) => ({ parada_id: paradaId, ...x, orden: ++orden })))
  }
  async function mover<T extends { id: string; orden: number }>(tabla: 'vis_ruta_paradas' | 'vis_parada_objetivos', lista: T[], i: number, delta: number) {
    const a = lista[i], b = lista[i + delta]
    if (!a || !b) return
    const r1 = await sb.from(tabla).update({ orden: b.orden === a.orden ? a.orden + delta : b.orden }).eq('id', a.id)
    if (r1.error) return r1
    return sb.from(tabla).update({ orden: a.orden }).eq('id', b.id)
  }
  async function quitarParada(p: Parada) {
    const { count } = await sb.from('vis_visitas').select('id', { count: 'exact', head: true }).eq('ruta_parada_id', p.id)
    if (count) throw new Error('Ese lugar ya tiene visitas ese día: no se puede sacar del día.')
    return sb.from('vis_ruta_paradas').delete().eq('id', p.id)
  }
  // Copia los lugares y médicos del día a otro día de la semana (los que ya estén ahí no se repiten).
  async function copiarDia(destino: string) {
    let orden = Math.max(0, ...(paradas ?? []).filter((x) => x.dia === destino).map((x) => x.orden))
    for (const p of delDia) {
      const ya = (paradas ?? []).find((x) => x.dia === destino && x.cliente_id === p.cliente_id)
      let id = ya?.id
      if (!id) {
        const r = await agregarLugar(p.cliente_id, destino, ++orden, p.hora_pactada)
        if (r.error) return r
        id = r.data.id
      }
      const yaObj = objetivosDe(id)
      const items = objetivosDe(p.id).filter((o) => !yaObj.some((y) => (o.medico_id ? y.medico_id === o.medico_id : y.especialidad === o.especialidad)))
        .map((o) => ({ medico_id: o.medico_id, especialidad: o.especialidad }))
      if (items.length) { const r = await agregarObjetivos(id, items); if (r.error) return r }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Armar el día</h1>
        <p className="text-sm text-tenue">Elegí el día, sumá los lugares y, en cada lugar, los médicos que tiene que ver en orden. La visitadora lo ve en Hoy y en cada lugar («Para ver hoy»), donde marca «Registrar visita» o «No está».</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {activas.length > 1 && (
          <Selector aria-label="Visitadora" value={quien} onChange={(e) => setQuien(e.target.value)} className="w-auto">
            {activas.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
        )}
        <SelectorSemana semana={semana} alCambiar={setSemana} />
        <Link href="/medica/ruteo" className="ml-auto text-sm text-marca underline">Ver cómo le fue (Ruteo de la semana)</Link>
      </div>

      <div role="group" aria-label="Día" className="flex flex-wrap gap-1.5">
        {dias.map((d) => (
          <button key={d} type="button" aria-pressed={d === dia} onClick={() => setDia(d)}
            className={cn('rounded-lg border px-3 py-2 text-sm font-medium capitalize', d === dia ? 'border-marca bg-marca text-sobre-marca' : 'border-borde bg-superficie hover:border-marca', d === hoyIso() && d !== dia && 'ring-2 ring-marca/30')}>
            {fmtDia(d)} <span className={cn('tabular', d === dia ? 'opacity-90' : 'text-tenue')}>({paradas ? cuantos(d) : '–'})</span>
          </button>
        ))}
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {!quien && <Vacio titulo="No hay visitadoras activas">Dales acceso en Usuarios con la app «Visitadora médica».</Vacio>}

      {quien && (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Tarjeta className="flex h-fit max-h-[80vh] flex-col gap-3 p-3 lg:sticky lg:top-4">
            <h2 className="font-semibold">Lugares de la visitadora</h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
              <Entrada aria-label="Buscar lugar" placeholder="Buscar lugar…" value={buscar} onChange={(e) => setBuscar(e.target.value)} className="pl-9" />
            </div>
            <ul className="-mx-1 flex-1 overflow-y-auto">
              {lugares === null && <li className="h-24 animate-pulse rounded-lg bg-borde/40" />}
              {lugares && candidatos.length === 0 && <li className="px-1 py-4 text-center text-sm text-tenue">Sin lugares. Cargalos en <Link href="/medica/lugares" className="underline">Consultorios y lugares</Link>.</li>}
              {candidatos.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 border-b border-borde px-1 py-2 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{l.razon_social}</p>
                    <p className="truncate text-xs text-tenue">{[l.tipo_lugar, `${medicosDe(l.id).length} médicos`].filter(Boolean).join(' · ')}</p>
                  </div>
                  {enDia.has(l.id) ? <span className="shrink-0 text-xs font-medium text-green-700 dark:text-green-400">En el día</span> : (
                    <Boton variante="secundario" className="min-h-9 shrink-0 px-2.5" disabled={ocupado} onClick={() => void hacer(async () => agregarLugar(l.id))}>
                      <Plus className="size-4" aria-hidden /> Agregar
                    </Boton>
                  )}
                </li>
              ))}
            </ul>
          </Tarjeta>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold"><span className="capitalize">{fmtDia(dia)}</span>: {delDia.length} {delDia.length === 1 ? 'lugar' : 'lugares'}</h2>
              {delDia.length > 0 && (
                <div className="flex items-center gap-2">
                  <Copy className="size-4 text-tenue" aria-hidden />
                  <Selector aria-label="Copiar este día a" value="" className="w-auto py-1.5 text-sm" disabled={ocupado}
                    onChange={(e) => { const d = e.target.value; if (d && confirm(`¿Copiar los lugares y médicos del ${fmtDia(dia)} al ${fmtDia(d)}?`)) void hacer(() => copiarDia(d), `Copiado al ${fmtDia(d)}.`) }}>
                    <option value="">Copiar este día a…</option>
                    {dias.filter((d) => d !== dia).map((d) => <option key={d} value={d}>{fmtDia(d)}</option>)}
                  </Selector>
                </div>
              )}
            </div>
            {paradas === null && <div className="h-40 animate-pulse rounded-xl bg-borde/40" />}
            {paradas && delDia.length === 0 && <Vacio titulo="Todavía no hay lugares este día">Agregalos desde la lista de la izquierda.</Vacio>}
            <ol className="flex flex-col gap-3">
              {delDia.map((p, i) => (
                <li key={p.id}>
                  <TarjetaParada
                    p={p} i={i} total={delDia.length} nombre={nombreLugar(p.cliente_id)} ocupado={ocupado}
                    objetivos={objetivosDe(p.id)} medicosLugar={medicosDe(p.cliente_id)} todos={medicos ?? []} visitadora={quien}
                    onMover={(delta) => void hacer(async () => mover('vis_ruta_paradas', delDia, i, delta))}
                    onHora={(hora) => { if ((p.hora_pactada?.slice(0, 5) ?? '') !== hora) void hacer(async () => sb.from('vis_ruta_paradas').update({ hora_pactada: hora || null }).eq('id', p.id)) }}
                    onQuitar={() => { if (confirm(`¿Sacar «${nombreLugar(p.cliente_id)}» del ${fmtDia(dia)}?`)) void hacer(() => quitarParada(p)) }}
                    onAgregar={(medicoId, especialidad) => void hacer(async () => agregarObjetivos(p.id, [{ medico_id: medicoId, especialidad }]))}
                    onAgregarTodos={(ids) => void hacer(async () => agregarObjetivos(p.id, ids.map((id) => ({ medico_id: id, especialidad: null }))))}
                    onMoverObjetivo={(lista, j, delta) => void hacer(async () => mover('vis_parada_objetivos', lista, j, delta))}
                    onQuitarObjetivo={(o) => void hacer(async () => sb.from('vis_parada_objetivos').delete().eq('id', o.id))}
                    onCrearMedico={(datos) => void hacer(async () => {
                      const { data: yo } = await sb.rpc('vis_mi_id')
                      const { data: emp } = await sb.rpc('vis_mi_empresa')
                      const { data: m, error } = await sb.from('vis_medicos').insert({ empresa_id: emp as string, nombre: datos.nombre, especialidad: datos.especialidad || null, visitadora_id: quien, creado_por: yo as string }).select('id').single()
                      if (error) return { error }
                      const r = await sb.from('vis_medico_lugares').insert({ medico_id: m.id, lugar_id: p.cliente_id, horario: datos.horario || null })
                      if (r.error) return r
                      return agregarObjetivos(p.id, [{ medico_id: m.id, especialidad: null }])
                    }, `${datos.nombre} quedó cargado en ${nombreLugar(p.cliente_id)}.`)}
                  />
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  )
}

function TarjetaParada({ p, i, total, nombre, ocupado, objetivos, medicosLugar, todos, onMover, onHora, onQuitar, onAgregar, onAgregarTodos, onMoverObjetivo, onQuitarObjetivo, onCrearMedico }: {
  p: Parada; i: number; total: number; nombre: string; ocupado: boolean; objetivos: Objetivo[]; medicosLugar: Medico[]; todos: Medico[]; visitadora: string
  onMover: (delta: number) => void; onHora: (hora: string) => void; onQuitar: () => void; onAgregar: (medicoId: string | null, especialidad: string | null) => void; onAgregarTodos: (ids: string[]) => void
  onMoverObjetivo: (lista: Objetivo[], j: number, delta: number) => void; onQuitarObjetivo: (o: Objetivo) => void
  onCrearMedico: (d: { nombre: string; especialidad: string; horario: string }) => void
}) {
  const [elegido, setElegido] = useState('')
  const [nuevo, setNuevo] = useState<{ nombre: string; especialidad: string; horario: string } | null>(null)
  const ya = new Set(objetivos.map((o) => o.medico_id).filter(Boolean))
  const disponibles = medicosLugar.filter((m) => !ya.has(m.id)).sort((a, b) => Number(tocaVisitar(b)) - Number(tocaVisitar(a)) || a.nombre.localeCompare(b.nombre, 'es'))
  const medico = (id: string | null) => todos.find((m) => m.id === id)
  const horarioAca = (m: Medico | undefined) => m?.lugares.find((l) => l.lugar_id === p.cliente_id)?.horario ?? null
  const diaSemana = new Date(`${p.dia}T12:00:00Z`).getUTCDay() || 7
  const btn = 'grid size-8 place-items-center rounded-lg hover:bg-fondo disabled:opacity-30'
  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-marca text-sm font-semibold text-sobre-marca">{i + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{nombre}</p>
          <p className="text-xs text-tenue">{objetivos.length ? `${objetivos.length} para ver` : 'Sin médicos elegidos: la visitadora ve todos los del lugar'}</p>
        </div>
        {/* Hora pactada: la ve la visitadora en Hoy (en vez de la aproximada) y el panel la compara con la llegada. */}
        <label className="flex shrink-0 flex-col text-xs text-tenue">Hora pactada
          <input type="time" defaultValue={p.hora_pactada?.slice(0, 5) ?? ''} key={p.hora_pactada ?? ''} disabled={ocupado}
            onBlur={(e) => onHora(e.target.value)} aria-label={`Hora pactada en ${nombre}`}
            className="mt-0.5 min-h-8 w-28 rounded-md border border-borde bg-superficie px-1.5 text-sm text-tinta" />
        </label>
        <button type="button" className={btn} aria-label={`Subir ${nombre}`} disabled={ocupado || i === 0} onClick={() => onMover(-1)}><ArrowUp className="size-4" aria-hidden /></button>
        <button type="button" className={btn} aria-label={`Bajar ${nombre}`} disabled={ocupado || i === total - 1} onClick={() => onMover(1)}><ArrowDown className="size-4" aria-hidden /></button>
        <button type="button" className={cn(btn, 'text-red-600 dark:text-red-400')} aria-label={`Sacar ${nombre} del día`} disabled={ocupado} onClick={onQuitar}><Trash2 className="size-4" aria-hidden /></button>
      </div>

      {objetivos.length > 0 && (
        <ol className="flex flex-col gap-1.5 pl-11">
          {objetivos.map((o, j) => {
            const m = medico(o.medico_id)
            const dias = diasDeHorario(horarioAca(m))
            return (
              <li key={o.id} className="flex items-center gap-2 rounded-lg bg-fondo px-2.5 py-1.5">
                <span className="w-5 text-sm font-semibold tabular text-tenue">{j + 1}.</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m ? m.nombre : <>Buscar médico de <b>{o.especialidad}</b></>}</p>
                  {m && <div className="flex flex-wrap items-center gap-1.5 text-xs text-tenue">
                    {m.especialidad && <span>{m.especialidad}</span>}
                    <ChipsDias dias={dias} />
                    {dias.length > 0 && !dias.includes(diaSemana) && <span className="font-medium text-amber-700 dark:text-amber-300">no atiende este día</span>}
                  </div>}
                </div>
                <button type="button" className={btn} aria-label="Subir" disabled={ocupado || j === 0} onClick={() => onMoverObjetivo(objetivos, j, -1)}><ArrowUp className="size-4" aria-hidden /></button>
                <button type="button" className={btn} aria-label="Bajar" disabled={ocupado || j === objetivos.length - 1} onClick={() => onMoverObjetivo(objetivos, j, 1)}><ArrowDown className="size-4" aria-hidden /></button>
                <button type="button" className={cn(btn, 'text-red-600 dark:text-red-400')} aria-label={`Quitar ${m?.nombre ?? o.especialidad}`} disabled={ocupado} onClick={() => onQuitarObjetivo(o)}><Trash2 className="size-4" aria-hidden /></button>
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2 pl-11">
        <Selector aria-label={`Médico para ver en ${nombre}`} value={elegido} onChange={(e) => setElegido(e.target.value)} className="w-auto min-w-64 py-1.5 text-sm">
          <option value="">Agregar médico…</option>
          {disponibles.map((m) => {
            const d = diasDeHorario(horarioAca(m))
            return <option key={m.id} value={m.id}>{m.nombre}{m.especialidad ? ` · ${m.especialidad}` : ''}{d.length ? ` · ${d.map((n) => DIAS_SEMANA[n - 1]!.corto).join(' ')}` : ''}{tocaVisitar(m) ? ' · le toca' : ''}</option>
          })}
          <option value="__esp">Buscar por especialidad (todavía no sé el médico)…</option>
        </Selector>
        <Boton variante="secundario" className="min-h-9" disabled={ocupado || !elegido} onClick={() => {
          if (elegido === '__esp') { const e = prompt('¿Qué especialidad tiene que buscar?'); if (e?.trim()) onAgregar(null, e.trim()) } else onAgregar(elegido, null)
          setElegido('')
        }}>Agregar</Boton>
        {disponibles.length > 1 && <Boton variante="fantasma" className="min-h-9" disabled={ocupado} onClick={() => onAgregarTodos(disponibles.map((m) => m.id))}>Agregar todos ({disponibles.length})</Boton>}
        <Boton variante="fantasma" className="min-h-9" onClick={() => setNuevo(nuevo ? null : { nombre: '', especialidad: '', horario: '' })}><UserPlus className="size-4" aria-hidden /> Médico nuevo</Boton>
      </div>
      {nuevo && (
        <form className="ml-11 grid gap-2 rounded-lg border border-borde p-3 sm:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); if (!nuevo.nombre.trim()) return; onCrearMedico({ nombre: nuevo.nombre.trim(), especialidad: nuevo.especialidad.trim(), horario: nuevo.horario.trim() }); setNuevo(null) }}>
          <Entrada aria-label="Nombre del médico" placeholder="Nombre (Dra. Ana Gómez)…" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} autoComplete="off" required />
          <Entrada aria-label="Especialidad" placeholder="Especialidad…" value={nuevo.especialidad} onChange={(e) => setNuevo({ ...nuevo, especialidad: e.target.value })} autoComplete="off" />
          <Entrada aria-label="Horario en este lugar" placeholder="Horario (Martes y Jueves 17 Hs)…" value={nuevo.horario} onChange={(e) => setNuevo({ ...nuevo, horario: e.target.value })} autoComplete="off" />
          <Boton type="submit" disabled={ocupado || !nuevo.nombre.trim()}>Cargar y agregar</Boton>
        </form>
      )}
    </Tarjeta>
  )
}
