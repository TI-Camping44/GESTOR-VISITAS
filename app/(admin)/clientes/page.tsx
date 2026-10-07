'use client'
// Clientes (BRIEF §6 supervisor 4): búsqueda, estado, zona, vendedor, última visita y factura;
// asignación masiva de zona/vendedor; corrección de ubicación (solo en esta app) con historial.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Mapa } from '@/components/map/MapaDinamico'
import { AreaTexto, Aviso, Boton, Entrada, Etiqueta, PuntoEstado, Selector, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtFecha, fmtFechaHora, fmtGuaranies, hace } from '@/lib/fechas'
import { leerCoordenadas } from '@/lib/geo'
import { COLOR_ESTADO } from '@/lib/config'
import { mensajeError } from '@/lib/utils'
import type { ClienteV, EstadoCliente, Vendedor, Zona } from '@/lib/database.types'

const POR_PAGINA = 100
type Hist = { id: number; lat: number; lng: number; origen: string; motivo: string | null; created_at: string; precision_m: number | null; usuario: { nombre: string } | null }

export default function Clientes() {
  const sb = supabaseNavegador()
  const [filas, setFilas] = useState<ClienteV[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState<'' | EstadoCliente>('')
  const [zonaF, setZonaF] = useState('')
  const [vendF, setVendF] = useState('')
  const [zonas, setZonas] = useState<Zona[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [abierto, setAbierto] = useState<ClienteV | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    sb.from('vis_zonas').select('*').order('nombre').then(({ data }) => setZonas(data ?? []))
    sb.from('vis_vendedores').select('*').order('nombre').then(({ data }) => setVendedores(data ?? []))
  }, [sb])

  const cargar = useCallback(async () => {
    let consulta = sb.from('vis_clientes_v').select('*', { count: 'exact' }).order('razon_social').range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1)
    const t = q.trim()
    if (t) consulta = consulta.or(`razon_social.ilike.%${t.replace(/[%,()]/g, ' ')}%,ruc.ilike.%${t.replace(/[%,()]/g, ' ')}%,ciudad.ilike.%${t.replace(/[%,()]/g, ' ')}%`)
    if (estado) consulta = consulta.eq('estado', estado)
    if (zonaF === 'sin') consulta = consulta.is('zona_id', null)
    else if (zonaF) consulta = consulta.eq('zona_id', zonaF)
    if (vendF === 'sin') consulta = consulta.is('vendedor_id', null)
    else if (vendF) consulta = consulta.eq('vendedor_id', vendF)
    const { data, count, error } = await consulta
    if (error) setError(mensajeError(error))
    else { setError(null); setFilas(data ?? []); setTotal(count ?? 0) }
  }, [sb, pagina, q, estado, zonaF, vendF])

  useEffect(() => { const t = setTimeout(() => void cargar(), 250); return () => clearTimeout(t) }, [cargar])
  useEffect(() => { setPagina(0); setSel(new Set()) }, [q, estado, zonaF, vendF])

  const nombreZona = useMemo(() => new Map(zonas.map((z) => [z.id, z.nombre])), [zonas])
  const nombreVend = useMemo(() => new Map(vendedores.map((v) => [v.id, v.nombre])), [vendedores])

  async function asignar(campo: 'zona_id' | 'vendedor_id', valor: string) {
    if (!sel.size) return
    const cambios = campo === 'zona_id' ? { zona_id: valor || null } : { vendedor_id: valor || null }
    const { error } = await sb.from('vis_clientes').update(cambios).in('id', [...sel])
    if (error) return setError(mensajeError(error))
    setAviso(`${sel.size} cliente${sel.size > 1 ? 's' : ''} actualizado${sel.size > 1 ? 's' : ''}.`)
    setSel(new Set())
    void cargar()
  }

  const todosMarcados = filas.length > 0 && filas.every((f) => sel.has(f.id!))
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Clientes</h1>
      <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <Entrada placeholder="Buscar por nombre, RUC o ciudad" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <Selector value={estado} onChange={(e) => setEstado(e.target.value as '' | EstadoCliente)} aria-label="Estado">
          <option value="">Todos los estados</option><option value="activo">Activo</option><option value="potencial">Potencial</option><option value="inactivo">Sin movimiento</option>
        </Selector>
        <Selector value={zonaF} onChange={(e) => setZonaF(e.target.value)} aria-label="Zona">
          <option value="">Todas las zonas</option><option value="sin">Sin zona</option>
          {zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
        </Selector>
        <Selector value={vendF} onChange={(e) => setVendF(e.target.value)} aria-label="Vendedor">
          <option value="">Todos los vendedores</option><option value="sin">Sin vendedor</option>
          {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
        </Selector>
      </div>

      {sel.size > 0 && (
        <Tarjeta className="flex flex-wrap items-center gap-3 p-3">
          <span className="text-sm font-medium">{sel.size} seleccionado{sel.size > 1 ? 's' : ''}:</span>
          <Selector className="w-auto" defaultValue="" onChange={(e) => { if (e.target.value !== '') void asignar('zona_id', e.target.value === 'ninguna' ? '' : e.target.value); e.target.value = '' }} aria-label="Asignar zona">
            <option value="">Asignar zona…</option><option value="ninguna">Quitar zona</option>
            {zonas.filter((z) => z.activo).map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
          </Selector>
          <Selector className="w-auto" defaultValue="" onChange={(e) => { if (e.target.value !== '') void asignar('vendedor_id', e.target.value === 'ninguno' ? '' : e.target.value); e.target.value = '' }} aria-label="Asignar vendedor">
            <option value="">Asignar vendedor…</option><option value="ninguno">Quitar vendedor</option>
            {vendedores.filter((v) => v.activo).map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
          <Boton variante="fantasma" onClick={() => setSel(new Set())}>Cancelar</Boton>
        </Tarjeta>
      )}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}

      <Tarjeta className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Seleccionar todos" checked={todosMarcados} onChange={() => setSel(todosMarcados ? new Set() : new Set(filas.map((f) => f.id!)))} /></th>
              <th className="px-2 py-2 font-medium">Cliente</th><th className="px-2 py-2 font-medium">Ciudad</th><th className="px-2 py-2 font-medium">Zona</th>
              <th className="px-2 py-2 font-medium">Vendedor</th><th className="px-2 py-2 font-medium">Última visita</th><th className="px-2 py-2 font-medium">Última factura</th>
              <th className="px-3 py-2 font-medium">Ubicación</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.id} className="border-b border-borde last:border-0 hover:bg-fondo/60">
                <td className="px-3 py-2"><input type="checkbox" aria-label={`Seleccionar ${c.razon_social}`} checked={sel.has(c.id!)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(c.id!)) n.delete(c.id!); else n.add(c.id!); return n })} /></td>
                <td className="px-2 py-2">
                  <button type="button" className="text-left font-medium hover:text-marca" onClick={() => setAbierto(c)}>{c.razon_social}</button>
                  <div className="flex items-center gap-2"><PuntoEstado estado={c.estado} conTexto />{!c.odoo_partner_id && <span className="text-xs text-tenue">· prospecto</span>}</div>
                </td>
                <td className="px-2 py-2">{c.ciudad ?? '—'}</td>
                <td className="px-2 py-2">{c.zona_id ? nombreZona.get(c.zona_id) : <span className="text-tenue">—</span>}</td>
                <td className="px-2 py-2">{c.vendedor_id ? nombreVend.get(c.vendedor_id) : <span className="text-tenue">—</span>}</td>
                <td className="px-2 py-2">{hace(c.ultima_visita)}</td>
                <td className="px-2 py-2">{fmtFecha(c.ultima_factura_fecha)}</td>
                <td className="px-3 py-2 text-xs">{c.lat == null ? <span className="text-amber-700 dark:text-amber-300">sin ubicación</span> : c.origen_ubicacion === 'odoo' ? 'de Odoo' : c.origen_ubicacion === 'manual' ? 'corregida a mano' : 'GPS en visita'}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-tenue">Sin clientes con estos filtros. Los clientes de Odoo aparecen cuando se conecte la sincronización.</td></tr>}
          </tbody>
        </table>
      </Tarjeta>
      <div className="flex items-center justify-between text-sm text-tenue tabular">
        <span>{total} clientes</span>
        <div className="flex gap-2">
          <Boton variante="secundario" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</Boton>
          <Boton variante="secundario" disabled={(pagina + 1) * POR_PAGINA >= total} onClick={() => setPagina((p) => p + 1)}>Siguiente</Boton>
        </div>
      </div>

      {abierto && <DetalleCliente cliente={abierto} zona={abierto.zona_id ? nombreZona.get(abierto.zona_id) : undefined} alCerrar={(cambio) => { setAbierto(null); if (cambio) void cargar() }} />}
    </div>
  )
}

function DetalleCliente({ cliente: c, zona, alCerrar }: { cliente: ClienteV; zona?: string; alCerrar: (cambio: boolean) => void }) {
  const sb = supabaseNavegador()
  const [hist, setHist] = useState<Hist[]>([])
  const [coords, setCoords] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    sb.from('vis_cliente_ubicaciones_hist').select('id, lat, lng, origen, motivo, created_at, precision_m, usuario:vis_vendedores(nombre)').eq('cliente_id', c.id!).order('created_at', { ascending: false })
      .then(({ data }) => setHist((data ?? []) as unknown as Hist[]))
  }, [c.id, sb])

  const nueva = leerCoordenadas(coords)
  async function guardar() {
    if (!nueva) return setError('Pegá coordenadas válidas, por ejemplo -25.2637, -57.5759 o un link de Google Maps.')
    if (!motivo.trim()) return setError('Indicá el motivo de la corrección.')
    setGuardando(true)
    const { error } = await sb.rpc('vis_actualizar_ubicacion', { p_cliente: c.id!, p_lat: nueva.lat, p_lng: nueva.lng, p_precision: null as never, p_origen: 'manual', p_motivo: motivo })
    setGuardando(false)
    if (error) setError(mensajeError(error))
    else alCerrar(true)
  }

  const puntos = [
    ...(c.lat != null && c.lng != null ? [{ id: 'actual', lat: c.lat, lng: c.lng, color: COLOR_ESTADO[c.estado ?? 'potencial'], titulo: 'Ubicación vigente' }] : []),
    ...(c.lat_odoo != null && c.lng_odoo != null && (c.lat_odoo !== c.lat || c.lng_odoo !== c.lng) ? [{ id: 'odoo', lat: c.lat_odoo, lng: c.lng_odoo, color: '#6b7280', titulo: 'Ubicación en Odoo' }] : []),
    ...(nueva ? [{ id: 'nueva', lat: nueva.lat, lng: nueva.lng, color: '#d97706', titulo: 'Nueva ubicación' }] : []),
  ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label={c.razon_social ?? 'Cliente'} onClick={() => alCerrar(false)}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-superficie p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{c.razon_social}</h2>
            <p className="text-sm text-tenue">{[c.ruc, c.telefono, c.direccion, c.ciudad, zona].filter(Boolean).join(' · ')}</p>
            <div className="mt-1"><PuntoEstado estado={c.estado} conTexto /></div>
          </div>
          <Boton variante="fantasma" onClick={() => alCerrar(false)}>Cerrar</Boton>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-tenue">Última factura</dt><dd>{fmtFecha(c.ultima_factura_fecha)}</dd></div>
          <div><dt className="text-tenue">Ventas 6 meses</dt><dd>{fmtGuaranies(c.ventas_6m_gs)}</dd></div>
          <div><dt className="text-tenue">Última visita</dt><dd>{fmtFechaHora(c.ultima_visita)}</dd></div>
          <div><dt className="text-tenue">Origen</dt><dd>{c.odoo_partner_id ? `Odoo #${c.odoo_partner_id}` : 'Prospecto de la app'}</dd></div>
        </dl>
        {c.notas && <p className="mt-2 rounded-lg bg-fondo p-2 text-sm">{c.notas}</p>}

        <h3 className="mt-5 font-semibold">Ubicación</h3>
        {puntos.length > 0 ? <Mapa puntos={puntos} claveEncuadre={`${c.id}-${nueva?.lat ?? ''}`} className="mt-2 h-64 w-full overflow-hidden rounded-xl border border-borde" />
          : <p className="mt-1 text-sm text-tenue">Sin ubicación cargada.</p>}
        <div className="mt-3 flex flex-col gap-2">
          <Etiqueta htmlFor="coords" className="mb-0">Corregir ubicación (solo en esta app, no en Odoo)</Etiqueta>
          <Entrada id="coords" placeholder="-25.2637, -57.5759 o link de Google Maps" value={coords} onChange={(e) => setCoords(e.target.value)} />
          <AreaTexto placeholder="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="min-h-14" aria-label="Motivo" />
          {error && <Aviso tipo="error">{error}</Aviso>}
          <Boton disabled={guardando || !nueva} onClick={() => void guardar()}>Guardar ubicación</Boton>
        </div>

        <h3 className="mt-5 font-semibold">Historial de ubicaciones</h3>
        {hist.length === 0 ? <p className="text-sm text-tenue">Sin cambios registrados.</p> : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {hist.map((h) => (
              <li key={h.id} className="rounded-lg bg-fondo p-2">
                <p><strong>{fmtFechaHora(h.created_at)}</strong> · {h.origen === 'manual' ? 'a mano' : h.origen === 'gps_visita' ? 'GPS en visita' : 'Odoo'} · {h.usuario?.nombre ?? '—'}</p>
                <p className="text-tenue">{h.lat.toFixed(6)}, {h.lng.toFixed(6)}{h.precision_m != null && ` · ±${h.precision_m} m`}{h.motivo && ` · ${h.motivo}`}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
