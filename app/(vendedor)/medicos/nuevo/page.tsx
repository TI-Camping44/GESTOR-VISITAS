'use client'
// Visita médica: alta o edición de un médico. Los médicos no están en Odoo: los carga la visitadora.
// Un médico atiende en uno o más de sus lugares, cada uno con su horario.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AVISO_SOLO_LECTURA, useVendedor } from '@/components/vendedor/Proveedor'
import { AreaTexto, Aviso, Boton, Entrada, Etiqueta, Selector, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { guardarCache, leerCache } from '@/lib/offline/db'
import { mensajeError } from '@/lib/utils'
import { urlLugar } from '@/lib/rutas'
import { ESPECIALIDADES } from '@/lib/medicos'

type LugarOpcion = { id: string; razon_social: string; ciudad: string | null }
const FRECUENCIAS = [7, 15, 30, 60, 90]

export default function EditarMedico() {
  const busqueda = useSearchParams()
  const id = busqueda.get('id')
  const lugarInicial = busqueda.get('lugar')
  const router = useRouter()
  const { perfil, soloLectura } = useVendedor()
  const [lugares, setLugares] = useState<LugarOpcion[]>([])
  const [f, setF] = useState({ nombre: '', especialidad: busqueda.get('especialidad') ?? '', telefono: '', email: '', notas: '', frecuencia_dias: 30 })
  const [elegidos, setElegidos] = useState<Record<string, string>>(lugarInicial ? { [lugarInicial]: '' } : {}) // lugar → horario
  const [cargando, setCargando] = useState(!!id)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void leerCache<LugarOpcion[]>(`cartera:${perfil.id}`).then((c) => { if (c && vivo) setLugares(c.datos) }).catch(() => {})
    void supabaseNavegador().from('vis_clientes_v').select('id, razon_social, ciudad').eq('vendedor_id', perfil.id).order('razon_social').limit(3000)
      .then(({ data }) => { if (data && vivo) setLugares(data as LugarOpcion[]) })
    return () => { vivo = false }
  }, [perfil.id])

  useEffect(() => {
    if (!id) return
    let vivo = true
    const sb = supabaseNavegador()
    void Promise.all([
      sb.from('vis_medicos').select('*').eq('id', id).maybeSingle(),
      sb.from('vis_medico_lugares').select('lugar_id, horario').eq('medico_id', id),
    ]).then(([m, l]) => {
      if (!vivo) return
      setCargando(false)
      if (!m.data) { setError(m.error ? 'Necesitás señal para editar un médico.' : 'No encontramos este médico.'); return }
      setF({ nombre: m.data.nombre, especialidad: m.data.especialidad ?? '', telefono: m.data.telefono ?? '', email: m.data.email ?? '', notas: m.data.notas ?? '', frecuencia_dias: m.data.frecuencia_dias })
      setElegidos(Object.fromEntries((l.data ?? []).map((x) => [x.lugar_id, x.horario ?? ''])))
    })
    return () => { vivo = false }
  }, [id])

  const cambiar = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: k === 'frecuencia_dias' ? Number(e.target.value) : e.target.value }))

  const salir = () => router.push(lugarInicial ? urlLugar(lugarInicial) : '/medicos')

  async function refrescarCache() {
    const { data } = await supabaseNavegador().from('vis_medicos_v').select('*').order('nombre').limit(3000)
    if (data) await guardarCache(`medicos:${perfil.id}`, data).catch(() => {})
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (soloLectura) return setError(AVISO_SOLO_LECTURA)
    setError(null)
    if (!f.nombre.trim()) return setError('Falta el nombre del médico.')
    if (!Object.keys(elegidos).length) return setError('Elegí al menos un lugar donde atiende.')
    if (!navigator.onLine) return setError('Necesitás señal para guardar el médico.')
    setEnviando(true)
    try {
      const sb = supabaseNavegador()
      const datos = {
        nombre: f.nombre.trim(), especialidad: f.especialidad.trim() || null, telefono: f.telefono.trim() || null,
        email: f.email.trim() || null, notas: f.notas.trim() || null, frecuencia_dias: f.frecuencia_dias,
      }
      let medicoId = id
      if (medicoId) {
        const { error } = await sb.from('vis_medicos').update(datos).eq('id', medicoId)
        if (error) throw error
      } else {
        const { data, error } = await sb.from('vis_medicos')
          .insert({ ...datos, empresa_id: perfil.empresa_id!, visitadora_id: perfil.id, creado_por: perfil.id }).select('id').single()
        if (error) throw error
        medicoId = data.id
      }
      const ids = Object.keys(elegidos)
      const { error: e1 } = await sb.from('vis_medico_lugares').delete().eq('medico_id', medicoId!).not('lugar_id', 'in', `(${ids.join(',')})`)
      if (e1) throw e1
      const { error: e2 } = await sb.from('vis_medico_lugares')
        .upsert(ids.map((lugar_id) => ({ medico_id: medicoId!, lugar_id, horario: elegidos[lugar_id]?.trim() || null })), { onConflict: 'medico_id,lugar_id' })
      if (e2) throw e2
      await refrescarCache()
      salir()
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  async function darDeBaja() {
    if (soloLectura) return setError(AVISO_SOLO_LECTURA)
    if (!id || !confirm(`¿Borrar a ${f.nombre}? Sale de tu lista y de sus lugares (las visitas que ya le hiciste quedan en el historial).`)) return
    setEnviando(true)
    const { error } = await supabaseNavegador().from('vis_medicos').update({ activo: false }).eq('id', id)
    setEnviando(false)
    if (error) return setError(mensajeError(error))
    await refrescarCache()
    router.push('/medicos')
  }

  if (cargando) return <div className="h-40 animate-pulse rounded-xl bg-borde/40" />
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{id ? 'Editar médico' : 'Nuevo médico'}</h1>
      <div>
        <Etiqueta htmlFor="nombre">Nombre *</Etiqueta>
        <Entrada id="nombre" value={f.nombre} onChange={cambiar('nombre')} placeholder="Dra. Ana Gómez" autoComplete="off" />
      </div>
      <div>
        <Etiqueta htmlFor="especialidad">Especialidad</Etiqueta>
        <Entrada id="especialidad" list="especialidades" value={f.especialidad} onChange={cambiar('especialidad')} autoComplete="off" />
        <datalist id="especialidades">{ESPECIALIDADES.map((e) => <option key={e} value={e} />)}</datalist>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Etiqueta htmlFor="telefono">Celular</Etiqueta>
          <Entrada id="telefono" type="tel" inputMode="tel" value={f.telefono} onChange={cambiar('telefono')} placeholder="0981 123 456" />
        </div>
        <div>
          <Etiqueta htmlFor="frecuencia">Visitarlo cada</Etiqueta>
          <Selector id="frecuencia" value={f.frecuencia_dias} onChange={cambiar('frecuencia_dias')}>
            {FRECUENCIAS.map((d) => <option key={d} value={d}>{d} días</option>)}
          </Selector>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Dónde atiende *</legend>
        {lugares.length === 0 && <Aviso tipo="info">Todavía no tenés lugares. <Link href="/lugar/nuevo" className="font-medium underline">Cargá el hospital o consultorio</Link> parado ahí y después volvé.</Aviso>}
        {lugares.map((l) => {
          const marcado = l.id in elegidos
          return (
            <Tarjeta key={l.id} className="flex flex-col gap-2 py-3">
              <label className="flex items-center gap-3">
                <input type="checkbox" className="size-5 accent-[var(--c-marca)]" checked={marcado}
                  onChange={(e) => setElegidos((x) => { const n = { ...x }; if (e.target.checked) n[l.id] = ''; else delete n[l.id]; return n })} />
                <span className="min-w-0"><span className="font-medium">{l.razon_social}</span>{l.ciudad && <span className="text-sm text-tenue"> · {l.ciudad}</span>}</span>
              </label>
              {marcado && (
                <Entrada aria-label={`Horario en ${l.razon_social}`} placeholder="Horario (ej.: lun y mié 8 a 12)" value={elegidos[l.id] ?? ''}
                  onChange={(e) => setElegidos((x) => ({ ...x, [l.id]: e.target.value }))} />
              )}
            </Tarjeta>
          )
        })}
      </fieldset>

      <div>
        <Etiqueta htmlFor="notas">Notas</Etiqueta>
        <AreaTexto id="notas" value={f.notas} onChange={cambiar('notas')} placeholder="Secretaria, cómo prefiere que lo visiten, qué receta…" />
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <Boton type="submit" grande disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar médico'}</Boton>
      <div className="flex justify-between">
        <button type="button" className="text-sm text-tenue underline" onClick={salir}>Cancelar</button>
        {id && <button type="button" className="text-sm text-red-700 underline dark:text-red-300" onClick={() => void darDeBaja()}>Borrar médico</button>}
      </div>
    </form>
  )
}
