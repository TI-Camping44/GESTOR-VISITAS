'use client'
// Visita médica → Actividad: qué hizo cada visitadora en el día, hora por hora (jornada, llegadas a
// lugares y visitas a médicos con resultado, productos, muestras y observaciones), y los últimos 7 días.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, LogIn, LogOut, MapPin, Stethoscope } from 'lucide-react'
import { Aviso, Boton, Entrada, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { descargarCsv } from '@/lib/csv'
import { fechaIso, fmtDia, fmtFecha, fmtSoloHora, hoyIso, sumarDias } from '@/lib/fechas'
import { useParamUrl } from '@/lib/useParamUrl'
import { cn } from '@/lib/utils'
import { leerLlegadas, leerVisitas, textoProductos, totalMuestras, useVisitadoras, type Llegada, type VisitaMedica } from '@/components/admin/medica/datos'

type Jornada = { vendedor_id: string; inicio: string; fin: string | null }
type Evento =
  | { tipo: 'inicio' | 'fin'; hora: string; vendedor_id: string }
  | { tipo: 'llegada'; hora: string; vendedor_id: string; l: Llegada }
  | { tipo: 'visita'; hora: string; vendedor_id: string; v: VisitaMedica }

export default function Actividad() {
  const visitadoras = useVisitadoras()
  const [dia, setDia] = useParamUrl('dia', hoyIso())
  const [quien, setQuien] = useParamUrl('visitadora', '')
  const [datos, setDatos] = useState<{ visitas: VisitaMedica[]; llegadas: Llegada[]; jornadas: Jornada[] } | null>(null)
  const [semana, setSemana] = useState<{ visitas: VisitaMedica[]; llegadas: Llegada[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ids = useMemo(() => visitadoras.filter((v) => !quien || v.id === quien).map((v) => v.id), [visitadoras, quien])
  const nombre = (id: string) => visitadoras.find((v) => v.id === id)?.nombre ?? '—'

  useEffect(() => {
    if (!visitadoras.length) return
    let vivo = true
    setDatos(null)
    const ini = new Date(`${dia}T00:00:00-03:00`).toISOString()
    const fin = new Date(new Date(`${dia}T00:00:00-03:00`).getTime() + 86_400_000).toISOString()
    Promise.all([
      leerVisitas(ids, dia, dia), leerLlegadas(ids, dia, dia),
      supabaseNavegador().from('vis_jornadas').select('vendedor_id, inicio, fin').in('vendedor_id', ids).gte('inicio', ini).lt('inicio', fin),
    ]).then(([visitas, llegadas, j]) => {
      if (!vivo) return
      setError(null)
      setDatos({ visitas, llegadas, jornadas: (j.data ?? []) as Jornada[] })
    }).catch((e: Error) => { if (vivo) { setError(e.message); setDatos({ visitas: [], llegadas: [], jornadas: [] }) } })
    return () => { vivo = false }
  }, [ids, dia, visitadoras.length])

  // Últimos 7 días hasta el día elegido (para ver de un vistazo cómo viene la semana).
  useEffect(() => {
    if (!visitadoras.length) return
    let vivo = true
    Promise.all([leerVisitas(ids, sumarDias(dia, -6), dia), leerLlegadas(ids, sumarDias(dia, -6), dia)])
      .then(([visitas, llegadas]) => { if (vivo) setSemana({ visitas, llegadas }) }).catch(() => {})
    return () => { vivo = false }
  }, [ids, dia, visitadoras.length])

  const eventos = useMemo<Evento[]>(() => {
    if (!datos) return []
    const e: Evento[] = [
      ...datos.jornadas.flatMap((j) => [
        { tipo: 'inicio' as const, hora: j.inicio, vendedor_id: j.vendedor_id },
        ...(j.fin ? [{ tipo: 'fin' as const, hora: j.fin, vendedor_id: j.vendedor_id }] : []),
      ]),
      ...datos.llegadas.map((l) => ({ tipo: 'llegada' as const, hora: l.fecha_hora, vendedor_id: l.vendedor_id, l })),
      ...datos.visitas.map((v) => ({ tipo: 'visita' as const, hora: v.fecha_hora, vendedor_id: v.vendedor_id, v })),
    ]
    return e.sort((a, b) => a.hora.localeCompare(b.hora))
  }, [datos])
  const porVisitadora = useMemo(() => {
    const m = new Map<string, Evento[]>()
    for (const e of eventos) m.set(e.vendedor_id, [...(m.get(e.vendedor_id) ?? []), e])
    return [...m]
  }, [eventos])

  const resumen = datos && {
    lugares: new Set([...datos.llegadas.map((l) => l.lugar_id), ...datos.visitas.map((v) => v.cliente_id)]).size,
    medicos: new Set(datos.visitas.map((v) => v.medico_id).filter(Boolean)).size,
    visitas: datos.visitas.length,
    muestras: datos.visitas.reduce((s, v) => s + totalMuestras(v), 0),
  }
  const dias7 = Array.from({ length: 7 }, (_, i) => sumarDias(dia, i - 6))
  const delDia = (d: string, x: { fecha_hora: string }[]) => x.filter((y) => fechaIso(y.fecha_hora) === d)

  function excel() {
    if (!datos) return
    descargarCsv(`actividad_medica_${dia}`, [
      { titulo: 'Visitadora', valor: (e: Evento) => nombre(e.vendedor_id) },
      { titulo: 'Hora', valor: (e: Evento) => fmtSoloHora(e.hora) },
      { titulo: 'Qué', valor: (e: Evento) => (e.tipo === 'inicio' ? 'Inició la jornada' : e.tipo === 'fin' ? 'Terminó la jornada' : e.tipo === 'llegada' ? 'Llegó' : 'Visita') },
      { titulo: 'Lugar', valor: (e: Evento) => (e.tipo === 'llegada' ? e.l.lugar?.razon_social : e.tipo === 'visita' ? e.v.lugar?.razon_social : '') ?? '' },
      { titulo: 'Médico', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.medico?.nombre ?? '' : '') },
      { titulo: 'Especialidad', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.medico?.especialidad ?? '' : '') },
      { titulo: 'Resultado', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.resultado?.nombre ?? '' : '') },
      { titulo: 'Productos (muestras)', valor: (e: Evento) => (e.tipo === 'visita' ? textoProductos(e.v) : '') },
      { titulo: 'Observaciones', valor: (e: Evento) => (e.tipo === 'visita' ? e.v.observaciones ?? '' : '') },
      { titulo: 'Próxima visita', valor: (e: Evento) => (e.tipo === 'visita' && e.v.proxima_visita ? fmtFecha(e.v.proxima_visita) : '') },
    ], eventos)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Actividad de visita médica</h1>
        <p className="text-sm text-tenue">Qué hizo cada visitadora en el día: a qué hora llegó a cada lugar, a qué médicos vio y qué dejó.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Día anterior" className="grid size-10 place-items-center rounded-lg border border-borde hover:bg-fondo" onClick={() => setDia(sumarDias(dia, -1))}><ChevronLeft className="size-4" aria-hidden /></button>
          <Entrada type="date" aria-label="Día" value={dia} max={hoyIso()} onChange={(e) => e.target.value && setDia(e.target.value)} className="w-44" />
          <button type="button" aria-label="Día siguiente" disabled={dia >= hoyIso()} className="grid size-10 place-items-center rounded-lg border border-borde hover:bg-fondo disabled:opacity-40" onClick={() => setDia(sumarDias(dia, 1))}><ChevronRight className="size-4" aria-hidden /></button>
        </div>
        {dia !== hoyIso() && <Boton variante="fantasma" onClick={() => setDia(hoyIso())}>Hoy</Boton>}
        {visitadoras.length > 1 && (
          <Selector aria-label="Visitadora" value={quien} onChange={(e) => setQuien(e.target.value)} className="w-auto">
            <option value="">Todas las visitadoras</option>
            {visitadoras.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
        )}
        <Boton variante="secundario" className="ml-auto" disabled={!eventos.length} onClick={excel}>Excel del día</Boton>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Lugares', resumen?.lugares], ['Médicos visitados', resumen?.medicos], ['Visitas', resumen?.visitas], ['Muestras entregadas', resumen?.muestras]].map(([t, n]) => (
          <Tarjeta key={t as string}><p className="text-xs uppercase tracking-wide text-tenue">{t}</p><p className="text-2xl font-semibold tabular">{n ?? '–'}</p></Tarjeta>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          {datos === null && <div className="h-40 animate-pulse rounded-xl bg-borde/40" />}
          {datos && porVisitadora.length === 0 && (
            <Vacio titulo={`Sin actividad el ${fmtFecha(dia)}`}>No marcó llegadas ni registró visitas ese día.</Vacio>
          )}
          {porVisitadora.map(([id, lista]) => (
            <Tarjeta key={id} className="flex flex-col gap-1">
              <h2 className="mb-2 font-semibold">{nombre(id)}</h2>
              <ol className="relative flex flex-col gap-3 border-l-2 border-borde pl-5">
                {lista.map((e, i) => <EventoFila key={i} e={e} />)}
              </ol>
            </Tarjeta>
          ))}
        </div>

        <Tarjeta className="flex h-fit flex-col gap-2">
          <h2 className="font-semibold">Últimos 7 días</h2>
          <table className="w-full text-sm tabular">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="py-1.5 font-medium">Día</th><th className="py-1.5 text-right font-medium">Lugares</th><th className="py-1.5 text-right font-medium">Médicos</th><th className="py-1.5 text-right font-medium">Muestras</th>
            </tr></thead>
            <tbody>
              {dias7.map((d) => {
                const v = semana ? delDia(d, semana.visitas) as VisitaMedica[] : []
                const l = semana ? delDia(d, semana.llegadas) as Llegada[] : []
                const lugares = new Set([...l.map((x) => x.lugar_id), ...v.map((x) => x.cliente_id)]).size
                return (
                  <tr key={d} className={cn('border-b border-borde last:border-0', d === dia && 'font-semibold')}>
                    <td className="py-1.5"><button type="button" className="capitalize underline-offset-2 hover:underline" onClick={() => setDia(d)}>{fmtDia(d)}</button></td>
                    <td className="py-1.5 text-right">{semana ? lugares : '–'}</td>
                    <td className="py-1.5 text-right">{semana ? new Set(v.map((x) => x.medico_id).filter(Boolean)).size : '–'}</td>
                    <td className="py-1.5 text-right">{semana ? v.reduce((s, x) => s + totalMuestras(x), 0) : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-xs text-tenue">Tocá un día para ver su detalle. El recorrido en el mapa está en <Link href="/medica/en-vivo" className="underline">En vivo</Link>.</p>
        </Tarjeta>
      </div>
    </div>
  )
}

function EventoFila({ e }: { e: Evento }) {
  const punto = (Icono: typeof MapPin, clase: string) => (
    <span className={cn('absolute -left-[33px] -top-0.5 grid size-6 place-items-center rounded-full border-2 border-superficie', clase)}><Icono className="size-3.5" aria-hidden /></span>
  )
  const hora = <span className="mr-2 font-semibold tabular">{fmtSoloHora(e.hora)}</span>
  if (e.tipo === 'inicio' || e.tipo === 'fin') return (
    <li className="relative text-sm text-tenue">{punto(e.tipo === 'inicio' ? LogIn : LogOut, 'bg-fondo text-tenue')}{hora}{e.tipo === 'inicio' ? 'Inició la jornada' : 'Terminó la jornada'}</li>
  )
  if (e.tipo === 'llegada') return (
    <li className="relative text-sm">{punto(MapPin, 'bg-green-700 text-white')}{hora}Llegó a <b>{e.l.lugar?.razon_social ?? 'un lugar'}</b></li>
  )
  if (e.tipo !== 'visita') return null
  const v = e.v
  return (
    <li className="relative text-sm">
      {punto(Stethoscope, 'bg-marca text-sobre-marca')}
      <p>{hora}<b>{v.medico?.nombre ?? 'Visita'}</b>{v.medico?.especialidad && <span className="text-tenue"> · {v.medico.especialidad}</span>}<span className="text-tenue"> · {v.lugar?.razon_social}</span></p>
      <div className="mt-1 flex flex-col gap-0.5 rounded-lg bg-fondo px-3 py-2">
        {v.resultado && <p><span className="text-tenue">Resultado:</span> {v.resultado.nombre}</p>}
        {(v.productos ?? []).length > 0 && <p><span className="text-tenue">Productos:</span> {textoProductos(v)}</p>}
        {v.observaciones && <p className="break-words"><span className="text-tenue">Observaciones:</span> {v.observaciones}</p>}
        {v.proxima_visita && <p><span className="text-tenue">Próxima visita:</span> {fmtFecha(v.proxima_visita)}</p>}
      </div>
    </li>
  )
}
