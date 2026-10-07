'use client'
// Vendedores en vivo (BRIEF §4b): marcador por vendedor en jornada, actualizado por Realtime sobre
// vis_posicion_actual. Color por frescura: verde < 5 min, amarillo 5–15, gris > VIS_SIN_SENAL_MIN.
// Nunca se muestra un punto viejo como si fuera en vivo. Abajo, el recorrido de un día.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Mapa, type LineaMapa, type PuntoMapa } from '@/components/map/MapaDinamico'
import { Aviso, Entrada, Selector, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtFechaHora, fmtSoloHora, hace, hoyIso, lunesDe } from '@/lib/fechas'
import { fmtDistancia } from '@/lib/geo'
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
  const [hoyPorVendedor, setHoyPorVendedor] = useState<Map<string, { hechas: number; meta: number; proxima: string | null }>>(new Map())
  const [ahora, setAhora] = useState(() => Date.now())
  const [conectado, setConectado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargarResumen = useCallback(async (lista: Vendedor[]) => {
    const hoy = hoyIso()
    const { data } = await sb.rpc('vis_tablero', { p_semana: lunesDe(hoy) })
    const filas = ((data ?? []) as FilaTablero[]).filter((f) => f.dia === hoy)
    const m = new Map<string, { hechas: number; meta: number; proxima: string | null }>()
    await Promise.all(lista.map(async (v) => {
      const { data: p } = await sb.rpc('vis_paradas_dia', { p_dia: hoy, p_vendedor: v.id })
      const prox = ((p ?? []) as ParadaDia[]).find((x) => !x.visitada)
      const f = filas.find((x) => x.vendedor_id === v.id)
      m.set(v.id, { hechas: Number(f?.realizadas ?? 0), meta: v.meta_diaria, proxima: prox?.razon_social ?? null })
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

  const enJornada = vendedores.filter((v) => posiciones.get(v.id)?.en_jornada)
  const fuera = vendedores.filter((v) => !posiciones.get(v.id)?.en_jornada)

  const puntos = useMemo<PuntoMapa[]>(() => enJornada.map((v) => {
    const p = posiciones.get(v.id)!
    const f = frescura(p.fecha_hora, ahora)
    const r = hoyPorVendedor.get(v.id)
    return {
      id: v.id, lat: p.lat, lng: p.lng, color: f.color, etiqueta: iniciales(v.nombre), titulo: v.nombre,
      detalle: [`${fmtSoloHora(p.fecha_hora)} · ${f.texto}`, p.bateria_pct != null ? `batería ${p.bateria_pct}%` : null,
        r ? `visitas hoy ${r.hechas} / ${r.meta}` : null, r?.proxima ? `próxima: ${r.proxima}` : null].filter(Boolean).join(' · '),
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
        <Mapa puntos={puntos} claveEncuadre={`vivo-${enJornada.length}`} className="h-[60vh] w-full overflow-hidden rounded-xl border border-borde" />
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

      <Recorrido vendedores={vendedores} />
    </div>
  )
}

// Recorrido de un día: trayecto, visitas numeradas, km y horarios.
function Recorrido({ vendedores }: { vendedores: Vendedor[] }) {
  const sb = supabaseNavegador()
  const [vendedorId, setVendedorId] = useState('')
  const [dia, setDia] = useState(hoyIso())
  const [datos, setDatos] = useState<{ linea: LineaMapa | null; visitas: PuntoMapa[]; inicio: string | null; fin: string | null; km: number | null } | null>(null)

  useEffect(() => {
    if (!vendedorId) { setDatos(null); return }
    const desde = `${dia}T00:00:00-03:00`
    const hasta = new Date(new Date(desde).getTime() + 86400000).toISOString()
    Promise.all([
      sb.from('vis_posiciones').select('fecha_hora, lat, lng').eq('vendedor_id', vendedorId).gte('fecha_hora', desde).lt('fecha_hora', hasta).order('fecha_hora').limit(5000),
      sb.from('vis_visitas').select('id, fecha_hora, lat, lng, hizo_pedido, cliente:vis_clientes!vis_visitas_cliente_id_fkey(razon_social)').eq('vendedor_id', vendedorId).gte('fecha_hora', desde).lt('fecha_hora', hasta).order('fecha_hora'),
      sb.from('vis_jornadas').select('inicio, fin, km_recorridos').eq('vendedor_id', vendedorId).gte('inicio', desde).lt('inicio', hasta).order('inicio'),
    ]).then(([p, v, j]) => {
      const pos = p.data ?? []
      const jornadas = j.data ?? []
      const visitas = ((v.data ?? []) as unknown as { id: string; fecha_hora: string; lat: number | null; lng: number | null; hizo_pedido: boolean; cliente: { razon_social: string } | null }[])
      setDatos({
        linea: pos.length > 1 ? { id: 'recorrido', color: '#2563eb', puntos: pos.map((x) => [x.lng, x.lat]) } : null,
        visitas: visitas.filter((x) => x.lat != null).map((x, i) => ({
          id: x.id, lat: x.lat!, lng: x.lng!, etiqueta: String(i + 1), color: x.hizo_pedido ? '#16a34a' : '#1f6f4a',
          titulo: x.cliente?.razon_social ?? 'Visita', detalle: fmtSoloHora(x.fecha_hora),
        })),
        inicio: jornadas[0]?.inicio ?? null,
        fin: jornadas.at(-1)?.fin ?? null,
        km: jornadas.reduce((s, x) => s + Number(x.km_recorridos ?? 0), 0) || null,
      })
    })
  }, [vendedorId, dia, sb])

  return (
    <Tarjeta className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto font-semibold">Recorrido del día</h2>
        <div>
          <label htmlFor="rec-v" className="mb-1 block text-xs text-tenue">Vendedor</label>
          <Selector id="rec-v" value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
            <option value="">Elegí…</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
        </div>
        <div>
          <label htmlFor="rec-d" className="mb-1 block text-xs text-tenue">Día</label>
          <Entrada id="rec-d" type="date" value={dia} max={hoyIso()} onChange={(e) => setDia(e.target.value)} />
        </div>
      </div>
      {datos && (
        <>
          <p className="text-sm text-tenue tabular">
            Inicio {datos.inicio ? fmtSoloHora(datos.inicio) : '—'} · fin {datos.fin ? fmtSoloHora(datos.fin) : datos.inicio ? 'en curso' : '—'} ·
            {' '}{datos.km != null ? fmtDistancia(datos.km * 1000) : 'km al cerrar la jornada'} · {datos.visitas.length} visitas con GPS
          </p>
          <Mapa puntos={datos.visitas} lineas={datos.linea ? [datos.linea] : []} claveEncuadre={`${vendedorId}-${dia}-${datos.visitas.length}-${datos.linea?.puntos.length ?? 0}`} className="h-96 w-full overflow-hidden rounded-xl border border-borde" />
        </>
      )}
    </Tarjeta>
  )
}
