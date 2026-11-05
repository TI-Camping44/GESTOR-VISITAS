'use client'
// Visita médica (Vitalica): los médicos que cargan las visitadoras, cuándo se los visitó y a cuáles
// les toca visita; las muestras entregadas por producto; y la lista de productos (la carga un admin).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AreaTexto, Aviso, Boton, Entrada, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { descargarCsv } from '@/lib/csv'
import { fmtFecha, hoyIso, sumarDias } from '@/lib/fechas'
import { tocaVisitar } from '@/lib/medicos'
import { RuteoMedico } from '@/components/admin/RuteoMedico'
import { cn, mensajeError } from '@/lib/utils'
import type { Medico, Producto, ProductoVisita } from '@/lib/database.types'

const PERIODOS = [{ dias: 30, texto: 'Últimos 30 días' }, { dias: 60, texto: 'Últimos 60 días' }, { dias: 90, texto: 'Últimos 90 días' }]
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Tipo de lugar por el nombre ("Sanat. Americano" → Sanatorio). Si no se reconoce, queda sin tipo.
function tipoPorNombre(n: string): string | null {
  const t = normal(n)
  if (/\bsanat/.test(t)) return 'Sanatorio'
  if (/\bhosp|\bips\b|ineran|cruz roja|emergencias/.test(t)) return 'Hospital'
  if (/clinica/.test(t)) return 'Clínica'
  if (/consultorio/.test(t)) return 'Consultorio'
  if (/farmacia/.test(t)) return 'Farmacia'
  if (/centro de salud|\busf\b/.test(t)) return 'Centro de salud'
  return null
}
// Un lugar por renglón; la dirección, opcional, después de " - ". Sin repetir.
function leerLugares(texto: string) {
  const vistos = new Set<string>()
  return texto.split('\n').map((l) => l.replace(/^\s*\d+[.)-]?\s+/, '').trim()).filter(Boolean).flatMap((l) => {
    const [nombre, ...resto] = l.split(/\s+-\s+/)
    const n = (nombre ?? '').replace(/^Sanat\.\s*/i, 'Sanatorio ').replace(/^Hosp\.\s*/i, 'Hospital ').trim()
    if (!/[\p{L}\d]/u.test(n) || vistos.has(normal(n))) return [] // renglones vacíos o «—»
    vistos.add(normal(n))
    return [{ nombre: n, tipo_lugar: tipoPorNombre(n), direccion: resto.join(' - ').trim() || null }]
  })
}

export default function VisitaMedica() {
  const sb = supabaseNavegador()
  const [medicos, setMedicos] = useState<Medico[] | null>(null)
  const [visitadoras, setVisitadoras] = useState<{ id: string; nombre: string }[]>([])
  const [visitas, setVisitas] = useState<{ medico_id: string | null; productos: ProductoVisita[] }[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [esAdmin, setEsAdmin] = useState(false)
  const [dias, setDias] = useState(30)
  const [visitadora, setVisitadora] = useState('')
  const [q, setQ] = useState('')
  const [soloToca, setSoloToca] = useState(false)
  const [nuevoProducto, setNuevoProducto] = useState('')
  const [carga, setCarga] = useState({ visitadora: '', ciudad: 'Asunción', texto: '' })
  const [cargando, setCargando] = useState(false)
  const [cargaOk, setCargaOk] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargarProductos = useCallback(async () => {
    const { data } = await sb.from('vis_productos').select('*').order('orden').order('nombre')
    setProductos(data ?? [])
  }, [sb])

  useEffect(() => {
    void (async () => {
      const [m, v, a] = await Promise.all([
        sb.from('vis_medicos_v').select('*').order('nombre').limit(5000),
        sb.from('vis_vendedores').select('id, nombre').eq('tipo', 'medica').order('nombre'),
        sb.rpc('vis_es_admin'),
      ])
      if (m.error) setError(mensajeError(m.error))
      setMedicos(m.data ?? [])
      setVisitadoras(v.data ?? [])
      setEsAdmin(!!a.data)
    })()
    void cargarProductos()
  }, [sb, cargarProductos])

  useEffect(() => {
    const desde = sumarDias(hoyIso(), -dias)
    void sb.from('vis_visitas').select('medico_id, productos').not('medico_id', 'is', null).gte('fecha_hora', `${desde}T00:00:00-03:00`).limit(20000)
      .then(({ data }) => setVisitas((data ?? []) as typeof visitas))
  }, [sb, dias])

  const porMedico = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of visitas) if (v.medico_id) m.set(v.medico_id, (m.get(v.medico_id) ?? 0) + 1)
    return m
  }, [visitas])
  const muestras = useMemo(() => {
    const m = new Map<string, { veces: number; muestras: number }>()
    for (const v of visitas) for (const p of v.productos ?? []) {
      const x = m.get(p.producto) ?? { veces: 0, muestras: 0 }
      x.veces++; x.muestras += Number(p.muestras ?? 0)
      m.set(p.producto, x)
    }
    return [...m].sort((a, b) => b[1].veces - a[1].veces)
  }, [visitas])

  const nombreVisitadora = (id: string | null) => visitadoras.find((v) => v.id === id)?.nombre ?? '—'
  const lista = useMemo(() => {
    const t = normal(q.trim())
    return (medicos ?? [])
      .filter((m) => !visitadora || m.visitadora_id === visitadora)
      .filter((m) => !soloToca || tocaVisitar(m))
      .filter((m) => !t || normal([m.nombre, m.especialidad, ...m.lugares.map((l) => l.nombre)].filter(Boolean).join(' ')).includes(t))
  }, [medicos, visitadora, soloToca, q])
  const visitados = lista.filter((m) => porMedico.has(m.id)).length

  async function agregarProducto(e: React.FormEvent) {
    e.preventDefault()
    const nombre = nuevoProducto.trim()
    if (!nombre) return
    const { data: empresa } = await sb.rpc('vis_mi_empresa')
    const { error } = await sb.from('vis_productos').insert({ empresa_id: empresa!, nombre, orden: productos.length + 1 })
    if (error) return setError(error.code === '23505' ? 'Ese producto ya está.' : mensajeError(error))
    setNuevoProducto('')
    void cargarProductos()
  }
  const aCargar = useMemo(() => leerLugares(carga.texto), [carga.texto])
  async function cargarLugares(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setCargaOk(null)
    const visitadoraId = carga.visitadora || visitadoras[0]?.id
    if (!visitadoraId) return setError('No hay visitadoras: dale acceso en Usuarios con el rol «Visitadora médica».')
    if (!aCargar.length) return setError('Pegá al menos un lugar (uno por renglón).')
    setCargando(true)
    const { data, error } = await sb.rpc('vis_cargar_lugares', { p: { visitadora_id: visitadoraId, ciudad: carga.ciudad, lugares: aCargar } })
    setCargando(false)
    if (error) return setError(mensajeError(error))
    const r = data as { cargados: number; ya_estaban: number }
    setCargaOk(`Se cargaron ${r.cargados} lugares${r.ya_estaban ? ` (${r.ya_estaban} ya estaban)` : ''}. Ahora armá la ruta en Rutas, eligiendo «Cartera de ${nombreVisitadora(visitadoraId)}».`)
    setCarga((c) => ({ ...c, texto: '' }))
  }

  async function cambiarProducto(p: Producto, cambios: Partial<Producto>) {
    const { error } = await sb.from('vis_productos').update(cambios).eq('id', p.id)
    if (error) setError(mensajeError(error))
    void cargarProductos()
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Visita médica</h1>
        <p className="text-sm text-tenue">El ruteo de la semana, los médicos que cargan las visitadoras desde la app y las muestras entregadas.</p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      {visitadoras.length > 0 && <RuteoMedico visitadoras={visitadoras} />}

      <div className="flex flex-wrap items-center gap-2">
        <Selector aria-label="Período" value={dias} onChange={(e) => setDias(Number(e.target.value))} className="w-auto">
          {PERIODOS.map((p) => <option key={p.dias} value={p.dias}>{p.texto}</option>)}
        </Selector>
        {visitadoras.length > 1 && (
          <Selector aria-label="Visitadora" value={visitadora} onChange={(e) => setVisitadora(e.target.value)} className="w-auto">
            <option value="">Todas las visitadoras</option>
            {visitadoras.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
        )}
        <Entrada aria-label="Buscar médico" placeholder="Médico, especialidad o lugar" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={soloToca} onChange={(e) => setSoloToca(e.target.checked)} /> Solo los que les toca visita</label>
        <Boton variante="fantasma" className="ml-auto" disabled={!lista.length} onClick={() => descargarCsv(`medicos_${hoyIso()}`, [
          { titulo: 'Médico', valor: (m: Medico) => m.nombre },
          { titulo: 'Especialidad', valor: (m: Medico) => m.especialidad },
          { titulo: 'Lugares', valor: (m: Medico) => m.lugares.map((l) => l.nombre).join(' / ') },
          { titulo: 'Visitadora', valor: (m: Medico) => nombreVisitadora(m.visitadora_id) },
          { titulo: 'Cada (días)', valor: (m: Medico) => m.frecuencia_dias },
          { titulo: 'Última visita', valor: (m: Medico) => fmtFecha(m.ultima_visita) },
          { titulo: `Visitas (${dias} días)`, valor: (m: Medico) => porMedico.get(m.id) ?? 0 },
        ], lista)}>Excel</Boton>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tarjeta><p className="text-xs uppercase tracking-wide text-tenue">Médicos</p><p className="text-2xl font-semibold tabular">{lista.length}</p></Tarjeta>
        <Tarjeta><p className="text-xs uppercase tracking-wide text-tenue">Visitados en el período</p><p className="text-2xl font-semibold tabular">{visitados}<span className="text-base text-tenue"> · {lista.length ? Math.round((visitados / lista.length) * 100) : 0}%</span></p></Tarjeta>
        <Tarjeta><p className="text-xs uppercase tracking-wide text-tenue">Les toca visita</p><p className="text-2xl font-semibold tabular">{lista.filter((m) => tocaVisitar(m)).length}</p></Tarjeta>
      </div>

      <Tarjeta className="overflow-x-auto p-0">
        {medicos && lista.length === 0 ? <div className="p-4"><Vacio titulo="No hay médicos cargados">Los carga la visitadora desde su app (Médicos → «Médico»).</Vacio></div> : (
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="px-4 py-2 font-medium">Médico</th><th className="px-2 py-2 font-medium">Dónde atiende</th><th className="px-2 py-2 font-medium">Visitadora</th>
              <th className="px-2 py-2 font-medium">Última visita</th><th className="px-2 py-2 text-right font-medium">Visitas</th>
            </tr></thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.id} className="border-b border-borde last:border-0">
                  <td className="px-4 py-2"><p className="font-medium">{m.nombre}</p><p className="text-xs text-tenue">{m.especialidad ?? 'Sin especialidad'} · cada {m.frecuencia_dias} días</p></td>
                  <td className="px-2 py-2">{m.lugares.map((l) => <p key={l.lugar_id}>{l.nombre}{l.horario && <span className="text-xs text-tenue"> · {l.horario}</span>}</p>)}</td>
                  <td className="px-2 py-2">{nombreVisitadora(m.visitadora_id)}</td>
                  <td className="px-2 py-2">
                    {m.ultima_visita ? fmtFecha(m.ultima_visita) : 'Nunca'}
                    {tocaVisitar(m) && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">toca</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular">{porMedico.get(m.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>

      <Tarjeta className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">Cargar lugares</h2>
          <p className="text-sm text-tenue">Para armar la ruta antes de que la visitadora pase: pegá los hospitales, sanatorios o consultorios, uno por renglón (si querés, la dirección después de un guion: «Sanatorio Italiano - Av. Mcal. López 1234»). Quedan sin ubicación: la app se la pide en la primera visita, y mientras tanto «Cómo llegar» los busca por el nombre.</p>
        </div>
        <form onSubmit={cargarLugares} className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <AreaTexto aria-label="Lugares, uno por renglón" className="min-h-40" placeholder={'Centro Médico Bautista\nSanatorio Italiano\nIPS Central'} value={carga.texto} onChange={(e) => setCarga({ ...carga, texto: e.target.value })} />
          <div className="flex flex-col gap-2">
            <Selector aria-label="Visitadora" value={carga.visitadora || visitadoras[0]?.id || ''} onChange={(e) => setCarga({ ...carga, visitadora: e.target.value })}>
              {visitadoras.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Selector>
            <Entrada aria-label="Ciudad" placeholder="Ciudad" value={carga.ciudad} onChange={(e) => setCarga({ ...carga, ciudad: e.target.value })} />
            {aCargar.length > 0 && (
              <ul className="max-h-40 overflow-auto rounded-lg border border-borde p-2 text-xs">
                {aCargar.map((l) => <li key={l.nombre}>{l.nombre}<span className="text-tenue">{l.tipo_lugar ? ` · ${l.tipo_lugar}` : ''}{l.direccion ? ` · ${l.direccion}` : ''}</span></li>)}
              </ul>
            )}
            <Boton type="submit" disabled={cargando || !aCargar.length}>{cargando ? 'Cargando…' : `Cargar ${aCargar.length || ''} lugares`}</Boton>
          </div>
        </form>
        {cargaOk && <Aviso tipo="ok">{cargaOk}</Aviso>}
      </Tarjeta>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta className="flex flex-col gap-2">
          <h2 className="font-semibold">Productos presentados y muestras</h2>
          {muestras.length === 0 ? <p className="text-sm text-tenue">Sin visitas con productos en el período.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue"><th className="py-1 font-medium">Producto</th><th className="py-1 text-right font-medium">Presentado</th><th className="py-1 text-right font-medium">Muestras</th></tr></thead>
              <tbody>{muestras.map(([p, x]) => <tr key={p} className="border-b border-borde last:border-0"><td className="py-1">{p}</td><td className="py-1 text-right tabular">{x.veces}</td><td className="py-1 text-right tabular">{x.muestras}</td></tr>)}</tbody>
            </table>
          )}
        </Tarjeta>
        <Tarjeta className="flex flex-col gap-2">
          <h2 className="font-semibold">Lista de productos</h2>
          <p className="text-sm text-tenue">Llegan solos de Odoo: lo que facturó la empresa en 12 meses, primero lo más vendido (se actualizan con cada sincronización). La visitadora los elige al registrar la visita; los que no se presentan a médicos, ocultalos.</p>
          <ul className="flex flex-col gap-1">
            {productos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 border-b border-borde py-1 last:border-0">
                <span className={cn(!p.activo && 'text-tenue line-through')}>{p.nombre}{p.codigo && <span className="text-xs text-tenue"> · {p.codigo}</span>}</span>
                {esAdmin && <button type="button" className="text-xs text-tenue underline" onClick={() => void cambiarProducto(p, { activo: !p.activo })}>{p.activo ? 'Ocultar' : 'Volver a mostrar'}</button>}
              </li>
            ))}
            {productos.length === 0 && <li className="text-sm text-tenue">Todavía no hay productos.</li>}
          </ul>
          {esAdmin ? (
            <form onSubmit={agregarProducto} className="flex gap-2">
              <Entrada aria-label="Nuevo producto" placeholder="Nombre del producto" value={nuevoProducto} onChange={(e) => setNuevoProducto(e.target.value)} />
              <Boton type="submit" variante="secundario">Agregar</Boton>
            </form>
          ) : <p className="text-xs text-tenue">Los productos los carga un admin.</p>}
        </Tarjeta>
      </div>
    </div>
  )
}
