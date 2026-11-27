'use client'
import { AvisoSinJornada } from '@/components/admin/AvisoSinJornada'
// Tablero semanal (requerimiento 3): planificado vs. realizado por día y vendedor,
// cumplimiento contra la meta, agrupado por zona/ciudad y en el mapa con clustering.
// TI-0115: no concretadas (con motivo) y cumplimiento por ruta, zona y semana del ciclo.
// Empresas con visitadoras (Vitalica): en Visita médica (arriba de la Actividad, /medica) las visitadoras, con médicos, lugares
// y muestras (cada día lleva a su Actividad); en Ventas, abajo la Actividad del día de cada vendedor.
import { usePanel } from '@/components/admin/PanelModo'
import { ActividadVentas } from '@/components/admin/ActividadVentas'
import { totalMuestras } from '@/components/admin/medica/datos'
import { noLoVio } from '@/lib/medicos'
import type { ProductoVisita } from '@/lib/database.types'
import { useEffect, useMemo, useState } from 'react'
import { useParamUrl } from '@/lib/useParamUrl'
import { SelectorSemana } from '@/components/admin/SelectorSemana'
import { DetalleTablero, type Seleccion } from '@/components/admin/DetalleTablero'
import { Mapa, type PuntoMapa } from '@/components/map/MapaDinamico'
import Link from 'next/link'
import { Aviso, Boton, Tarjeta, Vacio } from '@/components/ui'
import { descargarCsv } from '@/lib/csv'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fechaIso, fmtDia, fmtFechaHora, hoyIso, lunesDe, sumarDias } from '@/lib/fechas'
import { cn, mensajeError } from '@/lib/utils'
import type { FilaTablero, FilaTableroRuta } from '@/lib/database.types'

type VisitaSemana = {
  id: string; vendedor_id: string | null; fecha_hora: string; lat: number | null; lng: number | null; hizo_pedido: boolean
  ruta_parada_id: string | null; cliente_id: string; medico_id: string | null; productos: ProductoVisita[] | null; resultado: { nombre: string } | null; cliente: { razon_social: string; ciudad: string | null } | null; zona: { nombre: string } | null
}

// Paraguay está fijo en UTC−3 desde octubre de 2024.
const inicioDia = (iso: string) => `${iso}T00:00:00-03:00`

function colorCumplimiento(hechas: number, meta: number) {
  if (meta <= 0) return ''
  const r = hechas / meta
  return r >= 1 ? 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200' : r >= 0.7 ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : hechas > 0 ? 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200' : ''
}

export default function Tablero() {
  const { delModo, modo, hayMedica } = usePanel() // con visitadoras: en Ventas no aparecen, en Visita médica solo ellas
  const medica = modo === 'medica'
  // Con la Actividad abajo (Visita médica y Ventas de Vitalica): tocar un día la lleva a ese día y esa persona.
  const [, setDiaUrl] = useParamUrl('dia', hoyIso())
  const [, setVistaUrl] = useParamUrl('vista', 'dia')
  const [, setPersonaUrl] = useParamUrl(medica ? 'visitadora' : 'vendedor', '')
  const [semana, setSemana] = useParamUrl('semana', lunesDe(hoyIso())) // en la URL: se puede pasar el link de esa semana
  const [filas, setFilas] = useState<FilaTablero[] | null>(null)
  const [porRuta, setPorRuta] = useState<FilaTableroRuta[]>([])
  const [visitas, setVisitas] = useState<VisitaSemana[]>([])
  const [llegadas, setLlegadas] = useState<{ vendedor_id: string; lugar_id: string; fecha_hora: string }[]>([])
  const [kmHoras, setKmHoras] = useState<Map<string, { km: number; horas: number }>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<Seleccion | null>(null)

  useEffect(() => {
    let vivo = true
    setFilas(null)
    const sb = supabaseNavegador()
    Promise.all([
      sb.rpc('vis_tablero', { p_semana: semana }),
      sb.from('vis_visitas')
        .select('id, vendedor_id, fecha_hora, lat, lng, hizo_pedido, ruta_parada_id, cliente_id, medico_id, productos, resultado:vis_resultados!vis_visitas_resultado_id_fkey(nombre), cliente:vis_clientes!vis_visitas_cliente_id_fkey(razon_social, ciudad), zona:vis_zonas!vis_visitas_zona_id_fkey(nombre)')
        .eq('origen', 'app').gte('fecha_hora', inicioDia(semana)).lt('fecha_hora', inicioDia(sumarDias(semana, 7))).limit(5000),
      sb.rpc('vis_reporte_vendedores', { p_desde: semana, p_hasta: sumarDias(semana, 6) }),
      sb.rpc('vis_tablero_rutas', { p_semana: semana }),
      // Visita médica: las llegadas cuentan como lugar visitado aunque no haya visto a nadie.
      medica ? sb.from('vis_llegadas').select('vendedor_id, lugar_id, fecha_hora').gte('fecha_hora', inicioDia(semana)).lt('fecha_hora', inicioDia(sumarDias(semana, 7))).limit(5000) : Promise.resolve({ data: [] }),
    ]).then(([t, v, r, pr, ll]) => {
      if (!vivo) return
      setLlegadas((ll.data ?? []) as { vendedor_id: string; lugar_id: string; fecha_hora: string }[])
      if (t.error || v.error) setError(mensajeError(t.error ?? v.error))
      else { setError(null); setFilas(((t.data ?? []) as FilaTablero[]).filter((f) => delModo(f.vendedor_id))); setVisitas(((v.data ?? []) as unknown as VisitaSemana[]).filter((x) => delModo(x.vendedor_id))) }
      const filasR = (r.data ?? []) as unknown as { vendedor_id: string; km: number; horas_jornada: number }[]
      setKmHoras(new Map(filasR.map((f) => [f.vendedor_id, { km: Number(f.km), horas: Number(f.horas_jornada) }])))
      setPorRuta(((pr.data ?? []) as FilaTableroRuta[]).filter((x) => delModo(x.vendedor_id)).map((x) => ({
        ...x, planificadas: Number(x.planificadas), realizadas: Number(x.realizadas), no_concretadas: Number(x.no_concretadas),
        pendientes: Number(x.pendientes), vencidas: Number(x.vencidas),
      })))
    })
    return () => { vivo = false }
  }, [semana, delModo, medica])
  useEffect(() => { setSel(null) }, [semana])

  // Lunes a viernes. El sábado aparece solo si esa semana alguien tuvo paradas o visitas ese día (no se esconde trabajo).
  const dias = useMemo(() => {
    const sabado = sumarDias(semana, 5)
    const conSabado = (filas ?? []).some((f) => f.dia === sabado && (Number(f.planificadas) > 0 || Number(f.realizadas) > 0))
    return Array.from({ length: conSabado ? 6 : 5 }, (_, i) => sumarDias(semana, i))
  }, [semana, filas])
  const porVendedor = useMemo(() => {
    const m = new Map<string, { nombre: string; metaD: number; metaS: number; dias: Map<string, FilaTablero> }>()
    for (const f of filas ?? []) {
      const v = m.get(f.vendedor_id) ?? { nombre: f.vendedor, metaD: f.meta_diaria, metaS: f.meta_semanal, dias: new Map() }
      v.dias.set(f.dia, f)
      m.set(f.vendedor_id, v)
    }
    return [...m.entries()]
  }, [filas])

  const porZona = useMemo(() => {
    const m = new Map<string, { zona: string; ciudad: string; visitas: number; pedidos: number }>()
    for (const v of visitas) {
      const zona = v.zona?.nombre ?? 'Sin zona'
      const ciudad = v.cliente?.ciudad ?? 'Sin ciudad'
      const k = `${zona}|${ciudad}`
      const x = m.get(k) ?? { zona, ciudad, visitas: 0, pedidos: 0 }
      x.visitas++
      if (v.hizo_pedido) x.pedidos++
      m.set(k, x)
    }
    return [...m.values()].sort((a, b) => a.zona.localeCompare(b.zona) || b.visitas - a.visitas)
  }, [visitas])

  const puntos = useMemo<PuntoMapa[]>(() => visitas.filter((v) => v.lat != null && v.lng != null).map((v) => ({
    id: v.id, lat: v.lat!, lng: v.lng!, color: v.hizo_pedido ? '#16a34a' : '#2563eb',
    titulo: v.cliente?.razon_social ?? 'Visita', detalle: `${fmtFechaHora(v.fecha_hora)}${v.hizo_pedido ? ' · con pedido' : ''}${v.ruta_parada_id ? '' : ' · fuera de ruta'}`,
  })), [visitas])

  // Visita médica, por visitadora y día: médicos atendidos (visitas en que lo vio; «No estaba», sin acceso, etc. no
  // cuentan), «no lo vio» y lugares visitados (con visita o «Llegué acá»). La meta se compara con los atendidos.
  const medicaDia = useMemo(() => {
    const m = new Map<string, { atendidos: number; noVio: number; lugares: Set<string> }>()
    const de = (vid: string, d: string) => { const k = `${vid}|${d}`; const x = m.get(k) ?? { atendidos: 0, noVio: 0, lugares: new Set<string>() }; m.set(k, x); return x }
    for (const v of visitas) {
      if (!v.vendedor_id) continue
      const x = de(v.vendedor_id, fechaIso(v.fecha_hora))
      if (noLoVio(v.resultado?.nombre)) x.noVio++
      else x.atendidos++
      x.lugares.add(v.cliente_id)
    }
    for (const l of llegadas) de(l.vendedor_id, fechaIso(l.fecha_hora)).lugares.add(l.lugar_id)
    return m
  }, [visitas, llegadas])
  const medicaSemana = useMemo(() => {
    const m = new Map<string, { medicos: Set<string>; muestras: number }>()
    for (const v of visitas) {
      if (!v.vendedor_id) continue
      const x = m.get(v.vendedor_id) ?? { medicos: new Set<string>(), muestras: 0 }
      if (v.medico_id && !noLoVio(v.resultado?.nombre)) x.medicos.add(v.medico_id)
      x.muestras += totalMuestras(v)
      m.set(v.vendedor_id, x)
    }
    return m
  }, [visitas])
  const hechasDe = (vid: string, d: string, f: FilaTablero | undefined) => (medica ? medicaDia.get(`${vid}|${d}`)?.atendidos ?? 0 : Number(f?.realizadas ?? 0))
  function abrirDia(id: string, nombre: string, desde: string, hasta: string) {
    if (!medica) setSel({ vendedorId: id, nombre, desde, hasta })
    if (!medica && !hayMedica) return
    // La Actividad (debajo, en la misma pantalla) pasa a ese día, o a la semana si se tocó el total; la semana no cambia.
    setPersonaUrl(id)
    setVistaUrl(desde === hasta ? 'dia' : 'semana')
    if (desde === hasta) setDiaUrl(desde)
    if (medica) setTimeout(() => document.getElementById('actividad')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }
  const hoy = hoyIso()
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{medica ? 'Tablero semanal de visita médica' : 'Tablero semanal'}</h1>
        <SelectorSemana semana={semana} alCambiar={setSemana} />
      </div>
      <AvisoSinJornada />
      <p className="-mt-3 text-sm text-tenue">{medica
        ? <>Por día: <b className="font-semibold text-tinta">médicos atendidos</b> contra la meta (no cuentan los que no estaban o no la recibieron) y lugares visitados de los del plan. Tocá un número para ver ese día hora por hora.</>
        : <>Tocá un número (por ejemplo <b className="font-semibold text-tinta">7 / 10</b>) para ver qué clientes visitó y cuáles quedaron sin visitar.</>}</p>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <Tarjeta className="overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm tabular">
          <thead>
            <tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="px-4 py-3 font-medium">{medica ? 'Visitadora' : 'Vendedor'}</th>
              {dias.map((d) => <th key={d} className={cn('px-2 py-3 text-center font-medium', d === hoy && 'text-marca')}>{fmtDia(d)}</th>)}
              <th className="px-3 py-3 text-center font-medium">Semana</th>
              {medica ? <>
                <th className="px-3 py-3 text-center font-medium" title="Médicos diferentes que atendió en la semana">Médicos distintos</th>
                <th className="px-3 py-3 text-center font-medium" title="Fue pero no lo vio: no estaba, sin acceso, pidió volver, ya no atiende ahí u otro motivo">No lo vio</th>
                <th className="px-3 py-3 text-center font-medium" title="Lugares del plan marcados «No pude visitar este lugar»">No pudo visitar</th>
                <th className="px-3 py-3 text-center font-medium">Muestras</th>
              </> : <>
                <th className="px-3 py-3 text-center font-medium">Con pedido</th>
                <th className="px-3 py-3 text-center font-medium">Fuera de ruta</th>
                <th className="px-3 py-3 text-center font-medium">No concretadas</th>
              </>}
              <th className="px-3 py-3 text-center font-medium">Km</th>
              <th className="px-3 py-3 text-center font-medium">Horas</th>
            </tr>
          </thead>
          <tbody>
            {filas === null && <tr><td colSpan={13} className="px-4 py-6 text-center text-tenue">Cargando…</td></tr>}
            {filas && porVendedor.length === 0 && <tr><td colSpan={13} className="px-4 py-6 text-center text-tenue">{medica ? 'No hay visitadoras activas.' : 'No hay vendedores activos. Cargalos en Vendedores.'}</td></tr>}
            {porVendedor.map(([id, v]) => {
              const lista = dias.map((d) => v.dias.get(d))
              const total = lista.reduce((s, f, i) => s + hechasDe(id, dias[i]!, f), 0)
              const lugaresHechos = dias.reduce((s, d) => s + (medicaDia.get(`${id}|${d}`)?.lugares.size ?? 0), 0)
              const noVio = dias.reduce((s, d) => s + (medicaDia.get(`${id}|${d}`)?.noVio ?? 0), 0)
              const plan = lista.reduce((s, f) => s + Number(f?.planificadas ?? 0), 0)
              const pedidos = lista.reduce((s, f) => s + Number(f?.con_pedido ?? 0), 0)
              const fuera = lista.reduce((s, f) => s + Number(f?.fuera_de_ruta ?? 0), 0)
              const noConcretadas = lista.reduce((s, f) => s + Number(f?.no_concretadas ?? 0), 0)
              const pct = v.metaS ? Math.round((total / v.metaS) * 100) : 0
              return (
                <tr key={id} className="border-b border-borde last:border-0">
                  <td className="px-4 py-3 font-medium">{v.nombre}</td>
                  {lista.map((f, i) => (
                    <td key={dias[i]} className="px-1 py-2 text-center">
                      <button type="button" onClick={() => abrirDia(id, v.nombre, dias[i]!, dias[i]!)}
                        className={cn('inline-block min-w-16 rounded-md border border-current/15 px-2 py-1 hover:ring-2 hover:ring-marca/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca', colorCumplimiento(hechasDe(id, dias[i]!, f), v.metaD),
                          sel?.vendedorId === id && sel.desde === dias[i] && sel.hasta === dias[i] && 'ring-2 ring-marca')}
                        title={medica ? `${hechasDe(id, dias[i]!, f)} médicos atendidos de una meta de ${v.metaD} · ${medicaDia.get(`${id}|${dias[i]}`)?.lugares.size ?? 0} de ${f?.planificadas ?? 0} lugares del plan visitados. Tocá para ver el día.` : `${f?.realizadas ?? 0} realizadas de ${f?.planificadas ?? 0} planificadas · meta ${v.metaD}. Tocá para ver los clientes.`}>
                        <strong>{hechasDe(id, dias[i]!, f)}</strong><span className="text-tenue"> / {v.metaD}</span>
                        <span className="block text-xs text-tenue">{medica ? `${medicaDia.get(`${id}|${dias[i]}`)?.lugares.size ?? 0} de ${f?.planificadas ?? 0} lugares` : `plan ${f?.planificadas ?? 0}`}</span>
                      </button>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center">
                    <button type="button" onClick={() => abrirDia(id, v.nombre, dias[0]!, dias.at(-1)!)}
                      className={cn('rounded-md border border-borde px-2 py-0.5 hover:ring-2 hover:ring-marca/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca', sel?.vendedorId === id && sel.desde !== sel.hasta && 'ring-2 ring-marca')}
                      title={medica ? 'Tocá para ver la semana completa' : 'Tocá para ver los clientes de la semana'}>
                      <strong>{total}</strong><span className="text-tenue"> / {v.metaS}</span>
                    </button>
                    <div className="mx-auto mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-fondo" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)} aria-label={`${pct}% de la meta semanal`}>
                      <div className="h-full rounded-full bg-marca" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <span className="text-xs text-tenue">{pct}% · {medica ? `${lugaresHechos} de ${plan} lugares` : `plan ${plan}`}</span>
                  </td>
                  {medica ? <>
                    <td className="px-3 py-2 text-center">{medicaSemana.get(id)?.medicos.size ?? 0}</td>
                    <td className="px-3 py-2 text-center">{noVio > 0 ? <span className="font-medium text-amber-800 dark:text-amber-300">{noVio}</span> : 0}</td>
                    <td className="px-3 py-2 text-center">{noConcretadas > 0 ? <span className="font-medium text-amber-800 dark:text-amber-300">{noConcretadas}</span> : 0}</td>
                    <td className="px-3 py-2 text-center">{medicaSemana.get(id)?.muestras ?? 0}</td>
                  </> : <>
                    <td className="px-3 py-2 text-center">{pedidos}</td>
                    <td className="px-3 py-2 text-center">{fuera}</td>
                    <td className="px-3 py-2 text-center">{noConcretadas > 0 ? <span className="font-medium text-amber-800 dark:text-amber-300">{noConcretadas}</span> : 0}</td>
                  </>}
                  <td className="px-3 py-2 text-center">{kmHoras.get(id)?.km.toLocaleString('es-PY', { maximumFractionDigits: 1 }) ?? '—'}</td>
                  <td className="px-3 py-2 text-center">{kmHoras.get(id)?.horas.toLocaleString('es-PY', { maximumFractionDigits: 1 }) ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Tarjeta>
      <p className="-mt-3 text-xs text-tenue">{medica
        ? 'Tocá el número de un día para ver abajo la Actividad de ese día: llegadas, médicos visitados, productos y muestras.'
        : 'Tocá el número de un día (o el total de la semana) para ver los clientes visitados y los que no visitó.'}</p>

      {sel && <DetalleTablero sel={sel} alCerrar={() => setSel(null)} />}

      {/* Vitalica (Ventas): la Actividad del día de cada vendedor y, abajo, el cumplimiento por ruta. */}
      {!medica && hayMedica && <>
        <ActividadVentas vendedores={porVendedor.map(([id, v]) => ({ id, nombre: v.nombre }))} />
        <CumplimientoRutas filas={porRuta} semana={semana} hoy={hoy} />
      </>}

      {!hayMedica && <CumplimientoRutas filas={porRuta} semana={semana} hoy={hoy} />}

      {!hayMedica && <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Tarjeta className="overflow-x-auto p-0">
          <h2 className="px-4 pt-4 font-semibold">Por zona y ciudad</h2>
          {porZona.length === 0 ? <div className="p-4"><Vacio titulo="Sin visitas esta semana" /></div> : (
            <table className="mt-2 w-full text-sm tabular">
              <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue"><th className="px-4 py-2 font-medium">Zona</th><th className="px-2 py-2 font-medium">Ciudad</th><th className="px-2 py-2 text-right font-medium">Visitas</th><th className="px-4 py-2 text-right font-medium">Con pedido</th></tr></thead>
              <tbody>
                {porZona.map((z) => (
                  <tr key={`${z.zona}|${z.ciudad}`} className="border-b border-borde last:border-0">
                    <td className="px-4 py-2">{z.zona}</td><td className="px-2 py-2">{z.ciudad}</td>
                    <td className="px-2 py-2 text-right">{z.visitas}</td><td className="px-4 py-2 text-right">{z.pedidos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>
        <div>
          <h2 className="mb-2 font-semibold">Visitas de la semana <span className="text-sm font-normal text-tenue">· verde: con pedido</span></h2>
          <Mapa puntos={puntos} agrupar claveEncuadre={`${semana}-${puntos.length > 0}`} className="h-96 w-full overflow-hidden rounded-xl border border-borde" />
        </div>
      </div>}
    </div>
  )
}

// Cumplimiento por ruta de la semana (TI-0115): zona, semana del ciclo, planificadas, realizadas, no concretadas
// (con motivo, ver el detalle) y pendientes (las de días que ya pasaron quedaron sin visitar).
function CumplimientoRutas({ filas, semana, hoy }: { filas: FilaTableroRuta[]; semana: string; hoy: string }) {
  const semanaCiclo = (f: FilaTableroRuta) => (f.ciclo ? `${f.ciclo} · semana ${f.ciclo_semana ?? '—'} de ${f.ciclo_semanas ?? '—'}` : '—')
  const pct = (f: FilaTableroRuta) => (f.planificadas ? Math.round((f.realizadas / f.planificadas) * 100) : 0)
  const terminada = sumarDias(semana, 6) < hoy
  function excel() {
    descargarCsv(`Cumplimiento de rutas semana ${semana}`, [
      { titulo: 'Zona', valor: (f: FilaTableroRuta) => f.zona ?? 'Sin zona' },
      { titulo: 'Ruta', valor: (f: FilaTableroRuta) => f.ruta },
      { titulo: 'Vendedor', valor: (f: FilaTableroRuta) => f.vendedor },
      { titulo: 'Semana del ciclo', valor: semanaCiclo },
      { titulo: 'Planificadas', valor: (f: FilaTableroRuta) => f.planificadas },
      { titulo: 'Realizadas', valor: (f: FilaTableroRuta) => f.realizadas },
      { titulo: 'No concretadas', valor: (f: FilaTableroRuta) => f.no_concretadas },
      { titulo: 'Pendientes', valor: (f: FilaTableroRuta) => f.pendientes },
      { titulo: 'Sin visitar (días pasados)', valor: (f: FilaTableroRuta) => f.vencidas },
      { titulo: 'Cumplimiento %', valor: pct },
    ], filas)
  }
  return (
    <Tarjeta className="overflow-x-auto p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <div>
          <h2 className="font-semibold">Cumplimiento por ruta, zona y semana del ciclo</h2>
          <p className="text-xs text-tenue">Realizadas: paradas con visita ese día. No concretadas: marcadas «No pude visitarlo», con motivo (tocá el día del vendedor arriba para verlo). {terminada ? 'Pendientes: quedaron sin visitar.' : 'Pendientes: todavía por visitar (o sin visitar si el día ya pasó).'}</p>
        </div>
        <Boton variante="secundario" onClick={excel} disabled={!filas.length}>Excel</Boton>
      </div>
      {filas.length === 0 ? <div className="p-4"><Vacio titulo="Sin rutas publicadas esta semana" /></div> : (
        <table className="mt-2 w-full min-w-[860px] text-sm tabular">
          <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
            <th className="px-4 py-2 font-medium">Zona</th><th className="px-2 py-2 font-medium">Ruta</th><th className="px-2 py-2 font-medium">Semana del ciclo</th>
            <th className="px-2 py-2 text-right font-medium">Plan</th><th className="px-2 py-2 text-right font-medium">Realizadas</th>
            <th className="px-2 py-2 text-right font-medium">No concretadas</th><th className="px-2 py-2 text-right font-medium">Pendientes</th>
            <th className="px-4 py-2 text-right font-medium">Cumplimiento</th>
          </tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.ruta_id} className="border-b border-borde last:border-0">
                <td className="px-4 py-2">{f.zona ?? <span className="text-tenue">Sin zona</span>}</td>
                <td className="px-2 py-2"><Link href={`/rutas/${f.ruta_id}`} className="font-medium text-marca hover:underline">{f.ruta}</Link><p className="text-xs text-tenue">{f.vendedor}</p></td>
                <td className="px-2 py-2">{semanaCiclo(f)}</td>
                <td className="px-2 py-2 text-right">{f.planificadas}</td>
                <td className="px-2 py-2 text-right">{f.realizadas}</td>
                <td className="px-2 py-2 text-right">{f.no_concretadas > 0 ? <span className="font-medium text-amber-800 dark:text-amber-300">{f.no_concretadas}</span> : 0}</td>
                <td className="px-2 py-2 text-right">{f.pendientes}{f.vencidas > 0 && <span className="block text-xs text-red-700 dark:text-red-300">{f.vencidas} sin visitar</span>}</td>
                <td className="px-4 py-2 text-right"><span className={cn('rounded-md px-2 py-0.5', colorCumplimiento(f.realizadas, f.planificadas))}>{pct(f)}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Tarjeta>
  )
}
