'use client'
// Vendedores en vivo (BRIEF §4b): marcador por vendedor en jornada, actualizado por Realtime sobre
// vis_posicion_actual. Color por frescura: verde < 5 min, amarillo 5–15, gris > VIS_SIN_SENAL_MIN.
// Nunca se muestra un punto viejo como si fuera en vivo. Abajo, el recorrido de un día.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mapa, type PuntoMapa } from '@/components/map/MapaDinamico'
import { RecorridoDia } from '@/components/admin/RecorridoDia'
import { Aviso, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtFechaHora, fmtSoloHora, hace, hoyIso, lunesDe } from '@/lib/fechas'
import { VIS } from '@/lib/config'
import { mensajeError } from '@/lib/utils'
import type { FilaTablero, ParadaDia, PosicionActual, Vendedor } from '@/lib/database.types'

type Frescura = { color: string; texto: string; nivel: 0 | 1 | 2 }
function frescura(fecha: string, ahora: number): Frescura {
  const min = (ahora - new Date(fecha).getTime()) / 60000
  if (min < 5) return { color: '#16a34a', texto: 'en vivo', nivel: 0 }
  if (min < VIS.sinSenalMin) return { color: '#d97706', texto: `hace ${Math.round(min)} min`, nivel: 1 }
  return { color: '#6b7280', texto: `sin señal ${hace(fecha, ahora)}`, nivel: 2 }
}
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')

export default function EnVivo() {
  const sb = supabaseNavegador()
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [posiciones, setPosiciones] = useState<Map<string, PosicionActual>>(new Map())
  const [hoyPorVendedor, setHoyPorVendedor] = useState<Map<string, { hechas: number; meta: number; proxima: string | null; llegada: { lugar: string; hora: string } | null }>>(new Map())
  const [ahora, setAhora] = useState(() => Date.now())
  const [conectado, setConectado] = useState(false)
  const [pedirResumen, setPedirResumen] = useState(0)
  const refresco = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargarResumen = useCallback(async (lista: Vendedor[]) => {
    const hoy = hoyIso()
    const { data } = await sb.rpc('vis_tablero', { p_semana: lunesDe(hoy) })
    const filas = ((data ?? []) as FilaTablero[]).filter((f) => f.dia === hoy)
    const m = new Map<string, { hechas: number; meta: number; proxima: string | null; llegada: { lugar: string; hora: string } | null }>()
    // Última llegada de hoy (visitadora: «Llegué acá» o alta de un lugar).
    const { data: ll } = await sb.from('vis_llegadas').select('vendedor_id, fecha_hora, lugar:vis_clientes!vis_llegadas_lugar_id_fkey(razon_social)')
      .gte('fecha_hora', new Date(`${hoy}T00:00:00-03:00`).toISOString()).order('fecha_hora', { ascending: false })
    const ultimaLlegada = new Map<string, { lugar: string; hora: string }>()
    for (const x of (ll ?? []) as unknown as { vendedor_id: string; fecha_hora: string; lugar: { razon_social: string } | null }[]) {
      if (!ultimaLlegada.has(x.vendedor_id)) ultimaLlegada.set(x.vendedor_id, { lugar: x.lugar?.razon_social ?? 'un lugar', hora: x.fecha_hora })
    }
    await Promise.all(lista.map(async (v) => {
      const { data: p } = await sb.rpc('vis_paradas_dia', { p_dia: hoy, p_vendedor: v.id })
      const prox = ((p ?? []) as ParadaDia[]).find((x) => !x.visitada)
      const f = filas.find((x) => x.vendedor_id === v.id)
      m.set(v.id, { hechas: Number(f?.realizadas ?? 0), meta: v.meta_diaria, proxima: prox?.razon_social ?? null, llegada: ultimaLlegada.get(v.id) ?? null })
    }))
    setHoyPorVendedor(m)
  }, [sb])

  useEffect(() => {
    ;(async () => {
      const [v, p] = await Promise.all([
        sb.from('vis_vendedores').select('*').eq('activo', true).order('nombre'),
        sb.from('vis_posicion_actual').select('*'),
      ])
      if (v.error || p.error) return setError(mensajeError(v.error ?? p.error))
      setVendedores(v.data ?? [])
      setPosiciones(new Map((p.data ?? []).map((x) => [x.vendedor_id, x])))
      void cargarResumen(v.data ?? [])
    })()
    const canal = sb.channel('vis-en-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vis_posicion_actual' }, (cambio) => {
        const fila = cambio.new as PosicionActual
        if (fila?.vendedor_id) setPosiciones((m) => new Map(m).set(fila.vendedor_id, fila))
        // Una llegada o una visita mueven el punto: se actualiza el resumen (sin pedirlo más de una vez cada 5 s).
        if (refresco.current) clearTimeout(refresco.current)
        refresco.current = setTimeout(() => setPedirResumen((n) => n + 1), 5000)
      })
      .subscribe((estado) => setConectado(estado === 'SUBSCRIBED'))
    const reloj = setInterval(() => setAhora(Date.now()), 30_000)
    return () => { void sb.removeChannel(canal); clearInterval(reloj) }
  }, [sb, cargarResumen])

  useEffect(() => {
    if (!vendedores.length) return
    const t = setInterval(() => void cargarResumen(vendedores), 60_000)
    return () => clearInterval(t)
  }, [vendedores, cargarResumen])

  useEffect(() => { if (pedirResumen && vendedores.length) void cargarResumen(vendedores) }, [pedirResumen, vendedores, cargarResumen])

  const enJornada = vendedores.filter((v) => posiciones.get(v.id)?.en_jornada)
  const fuera = vendedores.filter((v) => !posiciones.get(v.id)?.en_jornada)

  const puntos = useMemo<PuntoMapa[]>(() => enJornada.map((v) => {
    const p = posiciones.get(v.id)!
    const f = frescura(p.fecha_hora, ahora)
    const r = hoyPorVendedor.get(v.id)
    return {
      id: v.id, lat: p.lat, lng: p.lng, color: f.color, etiqueta: iniciales(v.nombre), titulo: v.nombre,
      detalle: [`${fmtSoloHora(p.fecha_hora)} · ${f.texto}`, p.bateria_pct != null ? `batería ${p.bateria_pct}%` : null,
        r ? `visitas hoy ${r.hechas} / ${r.meta}` : null, r?.llegada ? `en ${r.llegada.lugar} desde ${fmtSoloHora(r.llegada.hora)}` : null, r?.proxima ? `próxima: ${r.proxima}` : null].filter(Boolean).join(' · '),
    }
  }), [enJornada, posiciones, ahora, hoyPorVendedor])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Vendedores en vivo</h1>
        <p className="flex items-center gap-2 text-sm text-tenue">
          <span className={`size-2 rounded-full ${conectado ? 'bg-green-500' : 'bg-gray-400'}`} aria-hidden />
          {conectado ? 'Actualizando en tiempo real' : 'Conectando…'}
        </p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex flex-wrap gap-4 text-xs text-tenue">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#16a34a]" />menos de 5 min</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#d97706]" />5 a {VIS.sinSenalMin} min</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#6b7280]" />sin señal</span>
        <span>Con el celular en el bolsillo hay huecos: el punto se actualiza al registrar visitas o al abrir la app.</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Mapa puntos={puntos} claveEncuadre="vivo" className="h-[60vh] w-full overflow-hidden rounded-xl border border-borde" />
        <Tarjeta className="flex flex-col gap-3 p-3">
          <h2 className="font-semibold">En jornada ({enJornada.length})</h2>
          {enJornada.length === 0 && <p className="text-sm text-tenue">Nadie inició jornada todavía.</p>}
          <ul className="flex flex-col gap-2">
            {enJornada.map((v) => {
              const p = posiciones.get(v.id)!
              const f = frescura(p.fecha_hora, ahora)
              const r = hoyPorVendedor.get(v.id)
              return (
                <li key={v.id} className="rounded-lg bg-fondo p-2">
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-full text-xs font-semibold text-white" style={{ background: f.color }}>{iniciales(v.nombre)}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{v.nombre}</p>
                      <p className="text-xs text-tenue">{f.texto}{p.bateria_pct != null && ` · ${p.bateria_pct}%`}{r && ` · ${r.hechas}/${r.meta} hoy`}</p>
                    </div>
                  </div>
                  {r?.llegada && <p className="mt-1 truncate text-xs font-medium text-green-700 dark:text-green-400" title={`Marcó «Llegué acá» a las ${fmtSoloHora(r.llegada.hora)}`}>En {r.llegada.lugar} desde {fmtSoloHora(r.llegada.hora)}</p>}
                  {r?.proxima && <p className="mt-1 truncate text-xs text-tenue">Próxima: {r.proxima}</p>}
                </li>
              )
            })}
          </ul>
          {fuera.length > 0 && <>
            <h2 className="mt-2 font-semibold">Fuera de jornada</h2>
            <ul className="text-sm text-tenue">
              {fuera.map((v) => {
                const p = posiciones.get(v.id)
                return <li key={v.id}>{v.nombre}{p ? ` · última vez ${fmtFechaHora(p.fecha_hora)}` : ''}</li>
              })}
            </ul>
          </>}
        </Tarjeta>
      </div>

      <RecorridoDia vendedores={vendedores} />
    </div>
  )
}
