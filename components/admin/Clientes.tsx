'use client'
// Clientes (BRIEF §6 supervisor 4): búsqueda, estado, zona, vendedor, última visita y factura;
// asignación masiva de zona/vendedor; corrección de ubicación (solo en esta app) con historial.
// Editar, borrar (solo en esta app: queda inactivo, en la papelera; Odoo no se toca), restaurar y alta de clientes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Mapa } from '@/components/map/MapaDinamico'
import { AreaTexto, Aviso, Boton, Entrada, Etiqueta, PuntoEstado, Selector, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtFecha, fmtFechaHora, fmtGuaranies, hace, hoyIso } from '@/lib/fechas'
import { leerCoordenadas } from '@/lib/geo'
import { COLOR_ESTADO } from '@/lib/config'
import { mensajeError } from '@/lib/utils'
import { useParamUrl } from '@/lib/useParamUrl'
import { useDialogo } from '@/lib/useDialogo'
import type { ClienteV, EstadoCliente, Vendedor, Zona } from '@/lib/database.types'

const POR_PAGINA = 100
type Hist = { id: number; lat: number; lng: number; origen: string; motivo: string | null; created_at: string; precision_m: number | null; usuario: { nombre: string } | null }

export type ModoClientes = 'clientes' | 'sucursales'
type Padre = { id: string; razon_social: string }

export function ListaClientes({ modo }: { modo: ModoClientes }) {
  const esSuc = modo === 'sucursales'
  const sb = supabaseNavegador()
  const [filas, setFilas] = useState<ClienteV[]>([])
  const [total, setTotal] = useState(0)
  // Filtros y página en la URL: se puede recargar, volver o pasar el link.
  const [paginaTxt, setPaginaTxt] = useParamUrl('pagina', '1')
  const pagina = Math.max(0, (Number(paginaTxt) || 1) - 1)
  const setPagina = (n: number) => setPaginaTxt(String(n + 1))
  const [qUrl, setQUrl] = useParamUrl('q', '')
  // El texto del buscador vive en el estado (escribir rápido no pierde letras) y se copia a la URL.
  const [q, setQLocal] = useState(qUrl)
  const [estado, setEstadoUrl] = useParamUrl<'' | EstadoCliente>('estado', '')
  const [zonaF, setZonaUrl] = useParamUrl('zona', '')
  const [vendF, setVendUrl] = useParamUrl('vendedor', '')
  // Sucursales: filtro por casa matriz. Clientes: cuántas sucursales tiene cada uno.
  const [padreF, setPadreUrl] = useParamUrl('padre', '')
  const [padres, setPadres] = useState<Padre[]>([])
  const [nSuc, setNSuc] = useState<Map<string, number>>(new Map())
  // Cambiar un filtro vuelve a la primera página y limpia la selección.
  const filtro = <T,>(f: (v: T) => void) => (v: T) => { f(v); setPaginaTxt('1'); setSel(new Set()) }
  const setQ = filtro((v: string) => { setQLocal(v); setQUrl(v) }), setEstado = filtro(setEstadoUrl), setZonaF = filtro(setZonaUrl), setVendF = filtro(setVendUrl)
  // Asignación masiva: se elige y se confirma con «Aplicar» (antes se aplicaba al elegir en la lista).
  const [masivo, setMasivo] = useState<{ campo: 'zona_id' | 'vendedor_id'; valor: string } | null>(null)
  const [zonas, setZonas] = useState<Zona[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [abierto, setAbierto] = useState<ClienteV | null>(null)
  const [verPapelera, setVerPapelera] = useParamUrl('papelera', '')
  const [nuevo, setNuevo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    sb.from('vis_zonas').select('*').order('nombre').then(({ data }) => setZonas(data ?? []))
    sb.from('vis_vendedores').select('*').order('nombre').then(({ data }) => setVendedores(data ?? []))
  }, [sb])

  const cargar = useCallback(async () => {
    // Sin los lugares de visita médica: tienen su página (Visita médica → Consultorios y lugares).
    let consulta = sb.from('vis_clientes_v').select('*', { count: 'exact' }).eq('categoria', 'cliente').order('razon_social').range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1)
    consulta = esSuc ? consulta.not('cliente_padre_id', 'is', null) : consulta.is('cliente_padre_id', null)
    if (esSuc && padreF) consulta = consulta.eq('cliente_padre_id', padreF)
    const t = q.trim()
    if (t) consulta = consulta.or(`razon_social.ilike.%${t.replace(/[%,()]/g, ' ')}%,ruc.ilike.%${t.replace(/[%,()]/g, ' ')}%,ciudad.ilike.%${t.replace(/[%,()]/g, ' ')}%`)
    if (estado) consulta = consulta.eq('estado', estado)
    if (zonaF === 'sin') consulta = consulta.is('zona_id', null)
    else if (zonaF) consulta = consulta.eq('zona_id', zonaF)
    if (vendF === 'sin') consulta = consulta.is('vendedor_id', null)
    else if (vendF) consulta = consulta.eq('vendedor_id', vendF)
    const { data, count, error } = await consulta
    if (error) setError(mensajeError(error))
    else {
      setError(null); setFilas(data ?? []); setTotal(count ?? 0)
      if (!esSuc && data?.length) {
        const { data: hs } = await sb.from('vis_clientes_v').select('cliente_padre_id').in('cliente_padre_id', data.map((x) => x.id!)).limit(5000)
        const m = new Map<string, number>()
        for (const h of hs ?? []) if (h.cliente_padre_id) m.set(h.cliente_padre_id, (m.get(h.cliente_padre_id) ?? 0) + 1)
        setNSuc(m)
      }
    }
  }, [sb, pagina, q, estado, zonaF, vendF, esSuc, padreF])

  // Casas matrices con sucursales (para el filtro y el alta).
  const cargarPadres = useCallback(async () => {
    if (!esSuc) return
    const { data: hs } = await sb.from('vis_clientes_v').select('cliente_padre_id').not('cliente_padre_id', 'is', null).limit(5000)
    const ids = [...new Set((hs ?? []).map((h) => h.cliente_padre_id!))]
    if (!ids.length) return setPadres([])
    const { data: ps } = await sb.from('vis_clientes').select('id, razon_social').in('id', ids).order('razon_social')
    setPadres((ps ?? []) as Padre[])
  }, [sb, esSuc])
  useEffect(() => { void cargarPadres() }, [cargarPadres])

  useEffect(() => { const t = setTimeout(() => void cargar(), 250); return () => clearTimeout(t) }, [cargar])

  const nombreZona = useMemo(() => new Map(zonas.map((z) => [z.id, z.nombre])), [zonas])
  const nombreVend = useMemo(() => new Map(vendedores.map((v) => [v.id, v.nombre])), [vendedores])

  async function asignar(campo: 'zona_id' | 'vendedor_id', valor: string) {
    if (!sel.size) return
    const n = `${sel.size} cliente${sel.size > 1 ? 's' : ''}`
    const que = campo === 'zona_id'
      ? (valor ? `¿Asignar la zona «${nombreZona.get(valor)}» a ${n}?` : `¿Quitarle la zona a ${n}?`)
      : (valor ? `¿Asignar a ${nombreVend.get(valor)} como vendedor de ${n}?` : `¿Quitarle el vendedor a ${n}?`)
    if (!confirm(que)) return
    setMasivo(null)
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">{esSuc ? 'Sucursales' : 'Clientes'}</h1>
          <p className="text-sm text-tenue">{esSuc ? 'Las sucursales de cada cliente (casa matriz): las que trae Odoo y las que se cargan acá.' : 'Las empresas (casas matrices). Sus sucursales están en el menú Sucursales.'}</p>
        </div>
        <Boton variante="secundario" aria-pressed={!!verPapelera} onClick={() => setVerPapelera(verPapelera ? '' : '1')}><Trash2 className="size-4" aria-hidden /> Papelera</Boton>
        <Boton onClick={() => setNuevo(true)}><Plus className="size-4" aria-hidden /> {esSuc ? 'Nueva sucursal' : 'Nuevo cliente'}</Boton>
      </div>
      {verPapelera && <PapeleraClientes alRestaurar={(n) => { setAviso(`«${n}» volvió a la lista.`); void cargar() }} />}
      {esSuc && (
        <Selector value={padreF} onChange={(e) => { setPadreUrl(e.target.value); setPaginaTxt('1'); setSel(new Set()) }} aria-label="Casa matriz" className="md:w-96">
          <option value="">Todas las casas matrices ({padres.length})</option>
          {padres.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
        </Selector>
      )}
      <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <Entrada placeholder={esSuc ? 'Buscar sucursal por nombre, código o ciudad' : 'Buscar por nombre, RUC o ciudad'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <Selector value={estado} onChange={(e) => setEstado(e.target.value as '' | EstadoCliente)} aria-label="Estado">
          <option value="">Todos los estados</option><option value="activo">Activo</option><option value="potencial">Potencial</option><option value="inactivo">Sin movimiento</option><option value="no_interesado">No le interesa</option>
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
          <Selector className="w-auto" value={masivo?.campo === 'zona_id' ? masivo.valor : ''} aria-label="Zona a asignar"
            onChange={(e) => setMasivo(e.target.value === '' ? null : { campo: 'zona_id', valor: e.target.value })}>
            <option value="">Asignar zona…</option><option value="ninguna">Quitar zona</option>
            {zonas.filter((z) => z.activo).map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
          </Selector>
          <Selector className="w-auto" value={masivo?.campo === 'vendedor_id' ? masivo.valor : ''} aria-label="Vendedor a asignar"
            onChange={(e) => setMasivo(e.target.value === '' ? null : { campo: 'vendedor_id', valor: e.target.value })}>
            <option value="">Asignar vendedor…</option><option value="ninguno">Quitar vendedor</option>
            {vendedores.filter((v) => v.activo).map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
          {masivo && (
            <Boton onClick={() => void asignar(masivo.campo, masivo.valor === 'ninguna' || masivo.valor === 'ninguno' ? '' : masivo.valor)}>
              Aplicar a {sel.size}
            </Boton>
          )}
          <Boton variante="fantasma" onClick={() => { setSel(new Set()); setMasivo(null) }}>Cancelar</Boton>
        </Tarjeta>
      )}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}

      <Tarjeta className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Seleccionar todos" checked={todosMarcados} onChange={() => setSel(todosMarcados ? new Set() : new Set(filas.map((f) => f.id!)))} /></th>
              <th className="px-2 py-2 font-medium">{esSuc ? 'Sucursal' : 'Cliente'}</th>{esSuc && <th className="px-2 py-2 font-medium">Casa matriz</th>}<th className="px-2 py-2 font-medium">Ciudad</th><th className="px-2 py-2 font-medium">Zona</th>
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
                  <div className="flex items-center gap-2"><PuntoEstado estado={c.estado} conTexto />{!c.odoo_partner_id && <span className="text-xs text-tenue">· {esSuc ? 'cargada en la app' : 'prospecto'}</span>}
                    {!esSuc && (nSuc.get(c.id!) ?? 0) > 0 && <a href={`/sucursales?padre=${c.id}`} className="text-xs underline">{nSuc.get(c.id!)} sucursal{nSuc.get(c.id!) === 1 ? '' : 'es'}</a>}</div>
                </td>
                {esSuc && <td className="px-2 py-2">{padres.find((p) => p.id === c.cliente_padre_id)?.razon_social ?? '—'}</td>}
                <td className="px-2 py-2">{c.ciudad ?? '—'}</td>
                <td className="px-2 py-2">{c.zona_id ? nombreZona.get(c.zona_id) : <span className="text-tenue">—</span>}</td>
                <td className="px-2 py-2">{c.vendedor_id ? nombreVend.get(c.vendedor_id) : <span className="text-tenue">—</span>}</td>
                <td className="px-2 py-2">{hace(c.ultima_visita)}</td>
                <td className="px-2 py-2">{fmtFecha(c.ultima_factura_fecha)}</td>
                <td className="px-3 py-2 text-xs">{c.lat == null ? <span className="text-amber-700 dark:text-amber-300">sin ubicación</span> : c.origen_ubicacion === 'odoo' ? 'de Odoo' : c.origen_ubicacion === 'manual' ? 'corregida a mano' : 'GPS en visita'}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={esSuc ? 9 : 8} className="px-4 py-8 text-center text-tenue">Sin clientes con estos filtros. Los clientes de Odoo aparecen cuando se conecte la sincronización.</td></tr>}
          </tbody>
        </table>
      </Tarjeta>
      <div className="flex items-center justify-between text-sm text-tenue tabular">
        <span>{total} {esSuc ? 'sucursales' : 'clientes'}</span>
        <div className="flex gap-2">
          <Boton variante="secundario" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</Boton>
          <Boton variante="secundario" disabled={(pagina + 1) * POR_PAGINA >= total} onClick={() => setPagina(pagina + 1)}>Siguiente</Boton>
        </div>
      </div>

      {abierto && <DetalleCliente cliente={abierto} zona={abierto.zona_id ? nombreZona.get(abierto.zona_id) : undefined} zonas={zonas} vendedores={vendedores}
        alCerrar={(cambio, msg) => { setAbierto(null); if (msg) setAviso(msg); if (cambio) void cargar() }} />}
      {nuevo && <NuevoCliente vendedores={vendedores} sucursal={esSuc} padreInicial={padres.find((p) => p.id === padreF) ?? null}
        alCerrar={(msg) => { setNuevo(false); if (msg) { setAviso(msg); void cargar(); void cargarPadres() } }} />}
    </div>
  )
}

function DetalleCliente({ cliente: c, zona, zonas, vendedores, alCerrar }: {
  cliente: ClienteV; zona?: string; zonas: Zona[]; vendedores: Vendedor[]; alCerrar: (cambio: boolean, msg?: string) => void
}) {
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

  // Panel con foco adentro, Esc para cerrar. Si hay algo escrito, pregunta antes de descartarlo.
  const panel = useRef<HTMLDivElement>(null)
  const cerrar = () => { if ((coords.trim() || motivo.trim()) && !confirm('Tenés una corrección de ubicación sin guardar. ¿Cerrar igual?')) return; alCerrar(false) }
  useDialogo(panel, cerrar)
  const nueva = leerCoordenadas(coords)
  async function borrar() {
    if (!confirm(`¿Borrar «${c.razon_social}» de la app? Sale de las listas y de las rutas de los próximos días. En Odoo no cambia nada y se puede restaurar desde la Papelera.`)) return
    const { error: e1 } = await sb.from('vis_clientes').update({ activo: false }).eq('id', c.id!)
    if (e1) return setError(mensajeError(e1))
    await sb.from('vis_ruta_paradas').delete().eq('cliente_id', c.id!).gt('dia', hoyIso())
    alCerrar(true, `«${c.razon_social}» se mandó a la Papelera.`)
  }
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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={cerrar}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="detalle-cliente-titulo"
        className="h-full w-full max-w-xl overflow-y-auto overscroll-contain bg-superficie p-5 shadow-xl focus:outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="detalle-cliente-titulo" className="text-xl font-semibold">{c.razon_social}</h2>
            <p className="text-sm text-tenue">{[c.ruc, c.telefono, c.direccion, c.ciudad, zona].filter(Boolean).join(' · ')}</p>
            <div className="mt-1"><PuntoEstado estado={c.estado} conTexto /></div>
          </div>
          <Boton variante="fantasma" onClick={cerrar}>Cerrar</Boton>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-tenue">Última factura</dt><dd>{fmtFecha(c.ultima_factura_fecha)}</dd></div>
          <div><dt className="text-tenue">Ventas 6 meses</dt><dd>{fmtGuaranies(c.ventas_6m_gs)}</dd></div>
          <div><dt className="text-tenue">Última visita</dt><dd>{fmtFechaHora(c.ultima_visita)}</dd></div>
          <div><dt className="text-tenue">Origen</dt><dd>{c.odoo_partner_id ? `Odoo #${c.odoo_partner_id}` : 'Prospecto de la app'}</dd></div>
        </dl>
        {c.notas && <p className="mt-2 whitespace-pre-line rounded-lg bg-fondo p-2 text-sm">{c.notas}</p>}

        <EditarCliente cliente={c} zonas={zonas} vendedores={vendedores} alGuardar={(msg) => alCerrar(true, msg)} />

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

        <div className="mt-6 border-t border-borde pt-4">
          <Boton variante="secundario" className="text-red-700 dark:text-red-300" onClick={() => void borrar()}><Trash2 className="size-4" aria-hidden /> Borrar cliente</Boton>
          <p className="mt-1 text-xs text-tenue">Solo en esta app: sale de las listas y de las rutas de los próximos días, queda en la Papelera y se puede restaurar. En Odoo no cambia nada; las visitas quedan en el historial.</p>
        </div>
      </div>
    </div>
  )
}

// Datos del cliente. Los que vienen de Odoo (nombre, RUC, teléfono, dirección, ciudad) se corrigen en Odoo: la sincronización
// de cada mañana los vuelve a traer. Vendedor, zona y notas son de esta app.
function EditarCliente({ cliente: c, zonas, vendedores, alGuardar }: { cliente: ClienteV; zonas: Zona[]; vendedores: Vendedor[]; alGuardar: (msg: string) => void }) {
  const sb = supabaseNavegador()
  const deOdoo = !!c.odoo_partner_id
  const [abierto, setAbierto] = useState(false)
  const [f, setF] = useState({
    razon_social: c.razon_social ?? '', ruc: c.ruc ?? '', telefono: c.telefono ?? '', direccion: c.direccion ?? '', ciudad: c.ciudad ?? '',
    notas: c.notas ?? '', vendedor_id: c.vendedor_id ?? '', zona_id: c.zona_id ?? '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const campo = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function guardar() {
    if (!f.razon_social.trim()) return setError('Falta el nombre.')
    setGuardando(true); setError(null)
    const t = (v: string) => v.trim() || null
    const cambios = {
      notas: t(f.notas),
      ...(f.vendedor_id !== (c.vendedor_id ?? '') ? { vendedor_id: f.vendedor_id || null } : {}),
      ...(f.zona_id !== (c.zona_id ?? '') ? { zona_id: f.zona_id || null } : {}),
      ...(deOdoo ? {} : { razon_social: f.razon_social.trim(), ruc: t(f.ruc), telefono: t(f.telefono), direccion: t(f.direccion), ciudad: t(f.ciudad) }),
    }
    const { error: e } = await sb.from('vis_clientes').update(cambios).eq('id', c.id!)
    setGuardando(false)
    if (e) return setError(mensajeError(e))
    alGuardar(`Se guardaron los cambios de «${f.razon_social.trim()}».`)
  }
  if (!abierto) return <Boton variante="secundario" className="mt-3" onClick={() => setAbierto(true)}>Editar datos</Boton>
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-borde p-3">
      <p className="font-semibold">Editar datos</p>
      {deOdoo && <Aviso tipo="info">Viene de Odoo (#{c.odoo_partner_id}): el nombre, RUC, teléfono, dirección y ciudad se corrigen en Odoo. Acá se cambian el vendedor, la zona y las notas.</Aviso>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Etiqueta htmlFor="ec-nombre">Nombre</Etiqueta><Entrada id="ec-nombre" value={f.razon_social} onChange={campo('razon_social')} disabled={deOdoo} autoComplete="off" /></div>
        <div><Etiqueta htmlFor="ec-ruc">RUC</Etiqueta><Entrada id="ec-ruc" value={f.ruc} onChange={campo('ruc')} disabled={deOdoo} autoComplete="off" /></div>
        <div><Etiqueta htmlFor="ec-tel">Teléfono</Etiqueta><Entrada id="ec-tel" type="tel" value={f.telefono} onChange={campo('telefono')} disabled={deOdoo} autoComplete="off" /></div>
        <div><Etiqueta htmlFor="ec-dir">Dirección</Etiqueta><Entrada id="ec-dir" value={f.direccion} onChange={campo('direccion')} disabled={deOdoo} autoComplete="off" /></div>
        <div><Etiqueta htmlFor="ec-ciudad">Ciudad</Etiqueta><Entrada id="ec-ciudad" value={f.ciudad} onChange={campo('ciudad')} disabled={deOdoo} autoComplete="off" /></div>
        <div>
          <Etiqueta htmlFor="ec-vend">Vendedor</Etiqueta>
          <Selector id="ec-vend" value={f.vendedor_id} onChange={campo('vendedor_id')}>
            <option value="">Sin vendedor</option>
            {c.vendedor_id && !vendedores.some((v) => v.id === c.vendedor_id) && <option value={c.vendedor_id}>El actual (de otra empresa o equipo)</option>}
            {vendedores.filter((v) => v.activo || v.id === c.vendedor_id).map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </Selector>
        </div>
        <div>
          <Etiqueta htmlFor="ec-zona">Zona</Etiqueta>
          <Selector id="ec-zona" value={f.zona_id} onChange={campo('zona_id')}>
            <option value="">Sin zona</option>
            {c.zona_id && !zonas.some((z) => z.id === c.zona_id) && <option value={c.zona_id}>La actual (de otra empresa o equipo)</option>}
            {zonas.filter((z) => z.activo || z.id === c.zona_id).map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
          </Selector>
        </div>
        <div className="sm:col-span-2"><Etiqueta htmlFor="ec-notas">Notas (las ve el vendedor)</Etiqueta><AreaTexto id="ec-notas" value={f.notas} onChange={campo('notas')} /></div>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex gap-2">
        <Boton disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar cambios'}</Boton>
        <Boton variante="fantasma" onClick={() => setAbierto(false)}>Cancelar</Boton>
      </div>
    </div>
  )
}

// Alta desde el panel (vis_crear_cliente): un cliente que no está en Odoo, con su vendedor. Queda de tu empresa.
function NuevoCliente({ vendedores, sucursal, padreInicial, alCerrar }: { vendedores: Vendedor[]; sucursal: boolean; padreInicial: Padre | null; alCerrar: (msg?: string) => void }) {
  const sb = supabaseNavegador()
  const [padre, setPadre] = useState<Padre | null>(padreInicial)
  const [buscarPadre, setBuscarPadre] = useState('')
  const [opciones, setOpciones] = useState<Padre[]>([])
  useEffect(() => {
    const t = buscarPadre.trim().replace(/[%,()]/g, ' ')
    if (!sucursal || t.length < 2) { setOpciones([]); return }
    const h = setTimeout(() => {
      void sb.from('vis_clientes_v').select('id, razon_social').eq('categoria', 'cliente').is('cliente_padre_id', null).ilike('razon_social', `%${t}%`).order('razon_social').limit(10)
        .then(({ data }) => setOpciones((data ?? []) as Padre[]))
    }, 250)
    return () => clearTimeout(h)
  }, [sb, buscarPadre, sucursal])
  const [f, setF] = useState({ razon_social: '', ruc: '', telefono: '', direccion: '', ciudad: '', notas: '', vendedor_id: '', coords: '' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const cerrar = () => { if (f.razon_social.trim() && !confirm('Tenés un cliente sin guardar. ¿Cerrar igual?')) return; alCerrar() }
  useDialogo(panel, cerrar)
  const campo = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }))
  const coords = f.coords.trim() ? leerCoordenadas(f.coords) : null
  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!f.razon_social.trim()) return setError(sucursal ? 'Falta el nombre de la sucursal.' : 'Falta el nombre del cliente.')
    if (sucursal && !padre) return setError('Elegí la casa matriz (el cliente al que pertenece la sucursal).')
    if (f.coords.trim() && !coords) return setError('Las coordenadas no se entienden: pegá por ejemplo -25.2637, -57.5759 o un link de Google Maps, o dejalo vacío.')
    setGuardando(true); setError(null)
    const { error: err } = await sb.rpc('vis_crear_cliente', { p: { ...f, coords: undefined, lat: coords?.lat ?? null, lng: coords?.lng ?? null, cliente_padre_id: sucursal ? padre?.id ?? null : null } })
    setGuardando(false)
    if (err) return setError(mensajeError(err))
    alCerrar(`«${f.razon_social.trim()}» quedó cargado.${coords ? '' : ' La ubicación se toma en la primera visita.'}`)
  }
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={cerrar}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="nuevo-cliente-titulo"
        className="h-full w-full max-w-xl overflow-y-auto overscroll-contain bg-superficie p-5 shadow-xl focus:outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="nuevo-cliente-titulo" className="text-xl font-semibold">{sucursal ? 'Nueva sucursal' : 'Nuevo cliente'}</h2>
            <p className="text-sm text-tenue">{sucursal ? 'Una sucursal que no está en Odoo, colgada de su casa matriz.' : 'Un cliente que no está en Odoo.'} La ve solo tu empresa.</p>
          </div>
          <Boton variante="fantasma" onClick={cerrar}>Cerrar</Boton>
        </div>
        <form onSubmit={guardar} className="mt-4 grid gap-3 sm:grid-cols-2">
          {sucursal && (
            <div className="sm:col-span-2">
              <Etiqueta htmlFor="nc-padre">Casa matriz *</Etiqueta>
              {padre ? (
                <div className="flex items-center gap-2 rounded-lg border border-borde px-3 py-2 text-sm"><b className="flex-1">{padre.razon_social}</b><button type="button" className="underline" onClick={() => setPadre(null)}>Cambiar</button></div>
              ) : (
                <>
                  <Entrada id="nc-padre" value={buscarPadre} onChange={(e) => setBuscarPadre(e.target.value)} placeholder="Buscar el cliente (ej.: Biggie, Energy…)" autoComplete="off" />
                  {opciones.length > 0 && (
                    <ul className="mt-1 max-h-48 overflow-auto rounded-lg border border-borde text-sm">
                      {opciones.map((o) => <li key={o.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-fondo" onClick={() => { setPadre(o); setBuscarPadre('') }}>{o.razon_social}</button></li>)}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
          <div className="sm:col-span-2"><Etiqueta htmlFor="nc-nombre">Nombre *</Etiqueta><Entrada id="nc-nombre" value={f.razon_social} onChange={campo('razon_social')} placeholder={sucursal ? 'Ej.: Biggie Farma F300 Sucursal Nueva' : 'Nombre o razón social'} autoComplete="off" /></div>
          <div><Etiqueta htmlFor="nc-ruc">RUC</Etiqueta><Entrada id="nc-ruc" value={f.ruc} onChange={campo('ruc')} autoComplete="off" /></div>
          <div><Etiqueta htmlFor="nc-tel">Teléfono</Etiqueta><Entrada id="nc-tel" type="tel" value={f.telefono} onChange={campo('telefono')} autoComplete="off" /></div>
          <div><Etiqueta htmlFor="nc-dir">Dirección</Etiqueta><Entrada id="nc-dir" value={f.direccion} onChange={campo('direccion')} autoComplete="off" /></div>
          <div><Etiqueta htmlFor="nc-ciudad">Ciudad</Etiqueta><Entrada id="nc-ciudad" value={f.ciudad} onChange={campo('ciudad')} autoComplete="off" /></div>
          <div className="sm:col-span-2">
            <Etiqueta htmlFor="nc-vend">Vendedor</Etiqueta>
            <Selector id="nc-vend" value={f.vendedor_id} onChange={campo('vendedor_id')}>
              <option value="">Sin vendedor</option>
              {vendedores.filter((v) => v.activo && v.rol === 'vendedor').map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Selector>
          </div>
          <div className="sm:col-span-2"><Etiqueta htmlFor="nc-coords">Ubicación (opcional)</Etiqueta><Entrada id="nc-coords" value={f.coords} onChange={campo('coords')} placeholder="-25.2637, -57.5759 o link de Google Maps" autoComplete="off" /></div>
          <div className="sm:col-span-2"><Etiqueta htmlFor="nc-notas">Notas</Etiqueta><AreaTexto id="nc-notas" value={f.notas} onChange={campo('notas')} /></div>
          {error && <div className="sm:col-span-2"><Aviso tipo="error">{error}</Aviso></div>}
          <div className="sm:col-span-2"><Boton type="submit" disabled={guardando}>{guardando ? 'Guardando…' : sucursal ? 'Cargar sucursal' : 'Cargar cliente'}</Boton></div>
        </form>
      </div>
    </div>
  )
}

// Papelera: clientes borrados de la app (inactivos), con «Restaurar». No muestra los lugares de visita médica.
function PapeleraClientes({ alRestaurar }: { alRestaurar: (nombre: string) => void }) {
  const sb = supabaseNavegador()
  const [lista, setLista] = useState<{ id: string; razon_social: string; ciudad: string | null; notas: string | null; updated_at: string; odoo_partner_id: number | null }[] | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void sb.from('vis_clientes').select('id, razon_social, ciudad, notas, updated_at, odoo_partner_id').eq('activo', false).eq('categoria', 'cliente')
      .order('updated_at', { ascending: false }).limit(300)
      .then(({ data, error: e }) => { if (e) setError(mensajeError(e)); setLista(data ?? []) })
  }, [sb, vuelta])
  async function restaurar(id: string, nombre: string) {
    const { error: e } = await sb.from('vis_clientes').update({ activo: true }).eq('id', id)
    if (e) return setError(mensajeError(e))
    setVuelta((v) => v + 1); alRestaurar(nombre)
  }
  return (
    <Tarjeta className="flex flex-col gap-2">
      <div>
        <p className="flex items-center gap-2 font-semibold"><Trash2 className="size-4" aria-hidden /> Papelera de clientes</p>
        <p className="text-sm text-tenue">Borrados de la app (en Odoo siguen igual) o unidos con otro. Las visitas quedan en el historial.</p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {lista === null ? <div className="h-16 animate-pulse rounded-lg bg-borde/40" /> : lista.length === 0 ? <p className="text-sm text-tenue">La papelera está vacía.</p> : (
        <ul className="flex flex-col divide-y divide-borde">
          {lista.map((x) => (
            <li key={x.id} className="flex flex-wrap items-start gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p><b>{x.razon_social}</b>{x.ciudad && <span className="text-tenue"> · {x.ciudad}</span>}{x.odoo_partner_id ? <span className="text-tenue"> · Odoo #{x.odoo_partner_id}</span> : null} <span className="text-xs text-tenue">· {fmtFecha(x.updated_at)}</span></p>
                {x.notas && <p className="line-clamp-2 whitespace-pre-line text-xs text-tenue">{x.notas}</p>}
              </div>
              <Boton variante="secundario" className="min-h-9 px-2.5 text-sm" onClick={() => void restaurar(x.id, x.razon_social)}><RotateCcw className="size-4" aria-hidden /> Restaurar</Boton>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  )
}
