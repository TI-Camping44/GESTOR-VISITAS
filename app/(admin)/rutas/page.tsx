'use client'
// Rutas con nombre por semana y vendedor (requerimiento 5). Ej.: "Ruta Norte – Sem 42 – Antonio".
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SelectorSemana } from '@/components/admin/SelectorSemana'
import { Aviso, Boton, Entrada, Etiqueta, Insignia, Selector, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { hoyIso, lunesDe, ORDINAL_SEMANA, semanaDelMes, semanaIso } from '@/lib/fechas'
import { mensajeError } from '@/lib/utils'
import { COLOR_ESTADO_RUTA } from '@/lib/rutas'
import type { EstadoRuta, Vendedor, Zona } from '@/lib/database.types'

type FilaRuta = { id: string; nombre: string; estado: EstadoRuta; vendedor_id: string; zona_id: string | null; paradas: { count: number }[] }

export default function Rutas() {
  const router = useRouter()
  const [semana, setSemana] = useState(lunesDe(hoyIso()))
  const [rutas, setRutas] = useState<FilaRuta[] | null>(null)
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [zonas, setZonas] = useState<Zona[]>([])
  const [nueva, setNueva] = useState({ vendedor_id: '', zona_id: '', nombre: '' })
  const [error, setError] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)

  useEffect(() => {
    const sb = supabaseNavegador()
    sb.from('vis_vendedores').select('*').eq('activo', true).order('nombre').then(({ data }) => setVendedores(data ?? []))
    sb.from('vis_zonas').select('*').eq('activo', true).order('nombre').then(({ data }) => setZonas(data ?? []))
  }, [])

  useEffect(() => {
    setRutas(null)
    supabaseNavegador().from('vis_rutas').select('id, nombre, estado, vendedor_id, zona_id, paradas:vis_ruta_paradas(count)')
      .eq('semana_inicio', semana).order('nombre')
      .then(({ data, error }) => { if (error) setError(mensajeError(error)); else setRutas((data ?? []) as unknown as FilaRuta[]) })
  }, [semana])

  const semMes = semanaDelMes(semana)
  const tocan = zonas.filter((z) => z.semanas_mes.includes(semMes))
  const responsableDe = (z: Zona) => vendedores.find((v) => v.id === z.vendedor_id)?.nombre ?? z.responsable
  const esDe = (z: Zona, v: Vendedor) => z.vendedor_id === v.id || (!z.vendedor_id && !!z.responsable &&
    z.responsable.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(' ')[0] === v.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(' ')[0])

  function elegirVendedor(id: string) {
    const v = vendedores.find((x) => x.id === id)
    const sugerida = v ? tocan.find((z) => esDe(z, v)) : undefined
    setNueva((n) => ({ ...n, vendedor_id: id, zona_id: n.zona_id || sugerida?.id || '' }))
  }

  const nombreSugerido = () => {
    const v = vendedores.find((x) => x.id === nueva.vendedor_id)
    const z = zonas.find((x) => x.id === nueva.zona_id)
    if (!v) return ''
    return `Ruta ${z ? z.nombre.replace(/^Zona\s+/i, '') : 'General'} – Sem ${semanaIso(semana)} – ${v.nombre.split(' ')[0]}`
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!nueva.vendedor_id) return setError('Elegí el vendedor.')
    setCreando(true)
    setError(null)
    const sb = supabaseNavegador()
    const { data: yo } = await sb.rpc('vis_mi_id')
    const { data, error } = await sb.from('vis_rutas').insert({
      nombre: nueva.nombre.trim() || nombreSugerido(), vendedor_id: nueva.vendedor_id, zona_id: nueva.zona_id || null,
      semana_inicio: semana, creado_por: yo ?? null,
    }).select('id').single()
    setCreando(false)
    if (error) return setError(error.code === '23505' ? 'Ese vendedor ya tiene una ruta con ese nombre esta semana.' : mensajeError(error))
    router.push(`/rutas/${data.id}`)
  }

  const nombreV = (id: string) => vendedores.find((v) => v.id === id)?.nombre ?? '—'
  const nombreZ = (id: string | null) => zonas.find((z) => z.id === id)?.nombre ?? 'Sin zona'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Rutas</h1>
        <SelectorSemana semana={semana} alCambiar={setSemana} />
      </div>

      <Tarjeta>
        <h2 className="font-semibold">Nueva ruta para esta semana</h2>
        <p className="mb-3 mt-1 text-sm text-tenue">
          Es la {ORDINAL_SEMANA[semMes]} semana del mes.{' '}
          {tocan.length ? <>Toca: {tocan.map((z) => `${z.nombre}${responsableDe(z) ? ` (${responsableDe(z)})` : ''}`).join(' · ')}.</> : 'Ninguna zona tiene visita programada esta semana.'}
        </p>
        <form onSubmit={crear} className="grid gap-3 md:grid-cols-[1fr_1fr_1.5fr_auto] md:items-end">
          <div>
            <Etiqueta htmlFor="nv-vend">Vendedor</Etiqueta>
            <Selector id="nv-vend" value={nueva.vendedor_id} onChange={(e) => elegirVendedor(e.target.value)}>
              <option value="">Elegí…</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Selector>
          </div>
          <div>
            <Etiqueta htmlFor="nv-zona">Zona</Etiqueta>
            <Selector id="nv-zona" value={nueva.zona_id} onChange={(e) => setNueva({ ...nueva, zona_id: e.target.value })}>
              <option value="">Sin zona</option>
              {zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}{z.semanas_mes.includes(semMes) ? ' · le toca esta semana' : ''}</option>)}
            </Selector>
          </div>
          <div>
            <Etiqueta htmlFor="nv-nombre">Nombre</Etiqueta>
            <Entrada id="nv-nombre" value={nueva.nombre} placeholder={nombreSugerido() || 'Ruta Norte – Sem 42 – Antonio'} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} />
          </div>
          <Boton type="submit" disabled={creando}>Crear y planificar</Boton>
        </form>
        {zonas.length === 0 && <p className="mt-2 text-sm text-tenue">Todavía no hay zonas: creálas en <Link href="/zonas" className="text-marca underline">Zonas</Link> para filtrar clientes al planificar.</p>}
      </Tarjeta>

      {error && <Aviso tipo="error">{error}</Aviso>}

      {rutas === null ? <div className="h-24 animate-pulse rounded-xl bg-borde/40" /> : rutas.length === 0 ? (
        <Vacio titulo="No hay rutas esta semana">Creá una arriba, o duplicá una de la semana pasada desde su planificador.</Vacio>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rutas.map((r) => (
            <li key={r.id}>
              <Link href={`/rutas/${r.id}`} className="block rounded-xl border border-borde bg-superficie p-4 hover:border-marca">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{r.nombre}</p>
                  <Insignia className={COLOR_ESTADO_RUTA[r.estado]}>{r.estado}</Insignia>
                </div>
                <p className="mt-1 text-sm text-tenue">{nombreV(r.vendedor_id)} · {nombreZ(r.zona_id)} · {r.paradas[0]?.count ?? 0} paradas</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
