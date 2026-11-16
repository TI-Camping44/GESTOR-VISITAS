'use client'
// Ciclos de rutas (TI-0115, venta mayorista de Vitalica): zona → semana → día → punto de venta, en ciclos de hasta
// 4 semanas que se repiten solos. Las rutas de las primeras semanas son las «semanas modelo» (se arman con el
// planificador de siempre); de ahí en adelante cada semana se genera sola (pg_cron, cada madrugada, la semana actual
// y las 2 siguientes) copiando el modelo que le toca. Ver supabase/migrations/0034_vis_ciclos.sql.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Repeat } from 'lucide-react'
import { Aviso, Boton, Entrada, Etiqueta, Insignia, Selector, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtFecha, hoyIso, lunesDe, semanaIso, sumarDias } from '@/lib/fechas'
import { COLOR_ESTADO_RUTA, semanaDelCiclo } from '@/lib/rutas'
import { mensajeError } from '@/lib/utils'
import type { Ciclo, EstadoRuta, Vendedor, Zona } from '@/lib/database.types'

type RutaCiclo = {
  id: string; nombre: string; estado: EstadoRuta; vendedor_id: string; zona_id: string | null; semana_inicio: string
  ciclo_id: string | null; ciclo_semana: number | null; ciclo_modelo_id: string | null; paradas: { count: number }[]
}

export function Ciclos({ vendedores, zonas }: { vendedores: Vendedor[]; zonas: Zona[] }) {
  const sb = supabaseNavegador()
  const router = useRouter()
  const lunesHoy = lunesDe(hoyIso())
  const [ciclos, setCiclos] = useState<Ciclo[] | null>(null)
  const [rutas, setRutas] = useState<RutaCiclo[]>([])
  const [nuevo, setNuevo] = useState({ vendedor_id: '', nombre: '', inicio: lunesHoy, semanas: '4' })
  const [abierto, setAbierto] = useState(false)
  const [zonaNueva, setZonaNueva] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const visibles = useMemo(() => new Set(vendedores.map((v) => v.id)), [vendedores])
  const cargar = useCallback(async () => {
    const [c, r] = await Promise.all([
      sb.from('vis_ciclos').select('*').order('created_at'),
      // Rutas de los vendedores con ciclo, desde 4 semanas antes del primer ciclo hasta 8 semanas adelante.
      sb.from('vis_rutas').select('id, nombre, estado, vendedor_id, zona_id, semana_inicio, ciclo_id, ciclo_semana, ciclo_modelo_id, paradas:vis_ruta_paradas(count)')
        .gte('semana_inicio', sumarDias(lunesHoy, -7 * 26)).lte('semana_inicio', sumarDias(lunesHoy, 7 * 8)).order('semana_inicio').order('nombre'),
    ])
    if (c.error || r.error) return setError(mensajeError(c.error ?? r.error))
    setCiclos((c.data ?? []).filter((x) => visibles.has(x.vendedor_id)))
    setRutas((r.data ?? []) as unknown as RutaCiclo[])
  }, [sb, lunesHoy, visibles])
  useEffect(() => { void cargar() }, [cargar])

  const nombreV = (id: string) => vendedores.find((v) => v.id === id)?.nombre ?? '—'
  const nombreZ = (id: string | null) => zonas.find((z) => z.id === id)?.nombre ?? 'Sin zona'

  async function hacer(fn: () => PromiseLike<{ error: unknown } | void>, ok?: string) {
    setOcupado(true); setError(null); setAviso(null)
    try {
      const r = await fn()
      if (r && r.error) setError(mensajeError(r.error))
      else if (ok) setAviso(ok)
      await cargar()
    } finally { setOcupado(false) }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!nuevo.vendedor_id) return setError('Elegí el vendedor.')
    const inicio = lunesDe(nuevo.inicio)
    const nombre = nuevo.nombre.trim() || `Ciclo ${nombreV(nuevo.vendedor_id).split(' ')[0]}`
    await hacer(async () => {
      const { data: yo } = await sb.rpc('vis_mi_id')
      const r = await sb.from('vis_ciclos').insert({ vendedor_id: nuevo.vendedor_id, nombre, inicio, semanas: Number(nuevo.semanas), creado_por: yo ?? null })
      if (!r.error) { setAbierto(false); setNuevo({ vendedor_id: '', nombre: '', inicio: lunesHoy, semanas: '4' }) }
      return r
    }, `Ciclo creado. Armá la ruta de cada semana modelo (botón «Crear ruta» o «Sumar al ciclo» si ya existe).`)
  }

  // Ruta modelo nueva para la semana k: queda en borrador hasta que se publique desde el planificador.
  const crearModelo = (c: Ciclo, k: number) => hacer(async () => {
    const lunes = sumarDias(c.inicio, 7 * (k - 1))
    const zona = zonaNueva[`${c.id}-${k}`] || null
    const z = zonas.find((x) => x.id === zona)
    const { data: yo } = await sb.rpc('vis_mi_id')
    const r = await sb.from('vis_rutas').insert({
      nombre: `${c.nombre}${z ? ` · ${z.nombre.replace(/^Zona\s+/i, '')}` : ''} · S${k} – Sem ${semanaIso(lunes)} – ${nombreV(c.vendedor_id).split(' ')[0]}`,
      vendedor_id: c.vendedor_id, zona_id: zona, semana_inicio: lunes, ciclo_id: c.id, ciclo_semana: k, creado_por: yo ?? null,
    }).select('id').single()
    if (r.error) return { error: r.error.code === '23505' ? { message: 'Ya hay una ruta con ese nombre esa semana.' } : r.error }
    router.push(`/rutas/${r.data.id}`)
  })

  const sumar = (c: Ciclo, rutaId: string, k: number) => hacer(async () =>
    sb.from('vis_rutas').update({ ciclo_id: c.id, ciclo_semana: k }).eq('id', rutaId), 'Ruta sumada al ciclo como semana modelo.')
  const quitar = (rutaId: string) => hacer(async () =>
    sb.from('vis_rutas').update({ ciclo_id: null, ciclo_semana: null }).eq('id', rutaId), 'La ruta quedó fuera del ciclo (no se borra).')

  const generar = (c: Ciclo, rehacer: boolean) => hacer(async () => {
    const { data, error } = await sb.rpc('vis_generar_ciclo', { p_ciclo: c.id, p_semanas_adelante: 2, p_rehacer: rehacer })
    if (error) return { error }
    const r = data as { creadas: number; rehechas: number }
    setAviso(r.creadas === 0 && r.rehechas === 0 ? 'Ya estaban generadas la semana actual y las 2 siguientes.'
      : rehacer ? `Rehechas ${r.rehechas} rutas futuras; ${r.creadas} generadas desde el modelo.` : `${r.creadas} ruta${r.creadas === 1 ? '' : 's'} generada${r.creadas === 1 ? '' : 's'}.`)
  })

  return (
    <Tarjeta className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Repeat className="size-4 text-marca" aria-hidden /> Ciclos de rutas</h2>
          <p className="mt-1 max-w-3xl text-sm text-tenue">
            Planificación que se repite: armás las rutas de las primeras semanas (hasta 4) y de ahí en adelante se generan solas,
            copiando las paradas en los mismos días y en el mismo orden. Cada madrugada se generan la semana actual y las 2 siguientes.
            Una semana generada se puede tocar como cualquier ruta: el cambio vale solo para esa semana.
          </p>
        </div>
        {!abierto && <Boton variante="secundario" onClick={() => { setAbierto(true); setError(null) }}>Nuevo ciclo</Boton>}
      </div>

      {abierto && (
        <form onSubmit={crear} className="grid gap-3 rounded-lg bg-fondo p-3 md:grid-cols-[1fr_1.4fr_auto_auto_auto] md:items-end">
          <div>
            <Etiqueta htmlFor="ci-vend">Vendedor</Etiqueta>
            <Selector id="ci-vend" value={nuevo.vendedor_id} onChange={(e) => setNuevo({ ...nuevo, vendedor_id: e.target.value })}>
              <option value="">Elegí…</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Selector>
          </div>
          <div>
            <Etiqueta htmlFor="ci-nombre">Nombre</Etiqueta>
            <Entrada id="ci-nombre" value={nuevo.nombre} placeholder={nuevo.vendedor_id ? `Ciclo ${nombreV(nuevo.vendedor_id).split(' ')[0]}` : 'Ciclo Mayorista – Hugo'} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          </div>
          <div>
            <Etiqueta htmlFor="ci-inicio">Semana 1 (lunes)</Etiqueta>
            <Selector id="ci-inicio" value={nuevo.inicio} onChange={(e) => setNuevo({ ...nuevo, inicio: e.target.value })}>
              {[-2, -1, 0, 1, 2, 3, 4].map((n) => { const l = sumarDias(lunesHoy, 7 * n); return <option key={l} value={l}>Sem {semanaIso(l)} · {fmtFecha(l)}{n === 0 ? ' (esta)' : ''}</option> })}
            </Selector>
          </div>
          <div>
            <Etiqueta htmlFor="ci-semanas">Semanas</Etiqueta>
            <Selector id="ci-semanas" value={nuevo.semanas} onChange={(e) => setNuevo({ ...nuevo, semanas: e.target.value })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </Selector>
          </div>
          <div className="flex gap-2">
            <Boton type="submit" disabled={ocupado}>Crear ciclo</Boton>
            <Boton type="button" variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Boton>
          </div>
        </form>
      )}

      {error && <Aviso tipo="error">{error}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}

      {ciclos === null ? <div className="h-16 animate-pulse rounded-lg bg-borde/40" /> : ciclos.length === 0 ? (
        <p className="text-sm text-tenue">Todavía no hay ciclos. Creá uno con «Nuevo ciclo».</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {ciclos.map((c) => {
            const actual = semanaDelCiclo(c.inicio, c.semanas, lunesHoy)
            const fin = sumarDias(c.inicio, 7 * c.semanas)
            const generadas = rutas.filter((r) => r.ciclo_id === c.id && r.ciclo_modelo_id && r.semana_inicio >= lunesHoy)
            return (
              <li key={c.id} className="rounded-xl border border-borde p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{c.nombre} {!c.activo && <Insignia className="ml-1 bg-fondo text-tenue">pausado</Insignia>}</p>
                    <p className="text-sm text-tenue">
                      {nombreV(c.vendedor_id)} · {c.semanas} semana{c.semanas > 1 ? 's' : ''} · desde el {fmtFecha(c.inicio)}
                      {actual != null && <> · esta semana es la <b className="text-tinta">{actual}</b> del ciclo</>}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Boton variante="secundario" disabled={ocupado || !c.activo} onClick={() => void generar(c, false)}>Generar próximas semanas</Boton>
                    <Boton variante="secundario" disabled={ocupado || !c.activo}
                      onClick={() => { if (confirm('¿Volver a copiar del modelo las semanas siguientes a esta? Se borran y se rehacen las rutas generadas de esas semanas que todavía no tienen visitas. La semana actual no se toca.')) void generar(c, true) }}>
                      Rehacer semanas futuras
                    </Boton>
                    <Boton variante="secundario" disabled={ocupado} onClick={() => void hacer(async () => sb.from('vis_ciclos').update({ activo: !c.activo }).eq('id', c.id), c.activo ? 'Ciclo pausado: no se generan más semanas.' : 'Ciclo activo.')}>
                      {c.activo ? 'Pausar' : 'Activar'}
                    </Boton>
                    <Boton variante="secundario" disabled={ocupado} onClick={() => { if (confirm(`¿Borrar el ciclo «${c.nombre}»? Las rutas ya armadas o generadas quedan como rutas sueltas; no se generan más semanas.`)) void hacer(async () => sb.from('vis_ciclos').delete().eq('id', c.id), 'Ciclo borrado.') }}>
                      Borrar
                    </Boton>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: c.semanas }, (_, i) => i + 1).map((k) => {
                    const lunes = sumarDias(c.inicio, 7 * (k - 1))
                    const modelos = rutas.filter((r) => r.ciclo_id === c.id && !r.ciclo_modelo_id && r.semana_inicio === lunes)
                    const sueltas = rutas.filter((r) => r.vendedor_id === c.vendedor_id && !r.ciclo_id && r.semana_inicio === lunes)
                    const clave = `${c.id}-${k}`
                    return (
                      <div key={k} className={`flex flex-col gap-2 rounded-lg p-2.5 ${actual === k ? 'bg-fondo ring-1 ring-marca/40' : 'bg-fondo'}`}>
                        <p className="text-sm font-semibold">Semana {k} <span className="font-normal text-tenue">· modelo: Sem {semanaIso(lunes)} ({fmtFecha(lunes)})</span></p>
                        {modelos.length === 0 && <p className="text-xs text-amber-800 dark:text-amber-300">Sin ruta modelo: esta semana del ciclo no va a generar nada.</p>}
                        <ul className="flex flex-col gap-1">
                          {modelos.map((r) => (
                            <li key={r.id} className="flex items-start justify-between gap-2 rounded-md bg-superficie px-2 py-1.5">
                              <div className="min-w-0">
                                <Link href={`/rutas/${r.id}`} className="block truncate text-sm font-medium text-marca hover:underline">{r.nombre}</Link>
                                <p className="text-xs text-tenue">{nombreZ(r.zona_id)} · {r.paradas[0]?.count ?? 0} paradas · <span className={`rounded px-1 ${COLOR_ESTADO_RUTA[r.estado]}`}>{r.estado}</span></p>
                              </div>
                              <button type="button" disabled={ocupado} className="shrink-0 text-xs text-tenue underline hover:text-red-600"
                                onClick={() => { if (confirm(`¿Sacar «${r.nombre}» del ciclo? La ruta no se borra.`)) void quitar(r.id) }}>Sacar</button>
                            </li>
                          ))}
                        </ul>
                        {sueltas.map((r) => (
                          <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="truncate text-tenue">{r.nombre} ({r.paradas[0]?.count ?? 0} paradas)</span>
                            <button type="button" disabled={ocupado} className="shrink-0 font-medium text-marca underline" onClick={() => void sumar(c, r.id, k)}>Sumar al ciclo</button>
                          </div>
                        ))}
                        <div className="flex gap-1.5">
                          <Selector aria-label={`Zona de la ruta de la semana ${k}`} value={zonaNueva[clave] ?? ''} className="py-1 text-xs"
                            onChange={(e) => setZonaNueva((z) => ({ ...z, [clave]: e.target.value }))}>
                            <option value="">Sin zona</option>
                            {zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                          </Selector>
                          <Boton variante="secundario" className="shrink-0 px-2 py-1 text-xs" disabled={ocupado} onClick={() => void crearModelo(c, k)}>Crear ruta</Boton>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-3 text-sm">
                  {lunesHoy < fin ? (
                    <p className="text-tenue">Las semanas generadas empiezan el {fmtFecha(fin)}, cuando termina el primer ciclo.</p>
                  ) : generadas.length === 0 ? (
                    <p className="text-tenue">Todavía no hay semanas generadas de acá en adelante: tocá «Generar próximas semanas».</p>
                  ) : (
                    <p className="text-tenue">Generadas: {generadas.map((r, i) => (
                      <span key={r.id}>{i > 0 && ' · '}<Link href={`/rutas/${r.id}`} className="text-marca hover:underline">Sem {semanaIso(r.semana_inicio)} (S{r.ciclo_semana}){r.zona_id ? ` ${nombreZ(r.zona_id)}` : ''}</Link></span>
                    ))}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Tarjeta>
  )
}
