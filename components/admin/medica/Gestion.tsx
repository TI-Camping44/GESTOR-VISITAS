'use client'
// Visita médica → arreglar los datos desde el panel (Sergio): editar un médico (datos, lugares y horarios),
// unir dos médicos cargados dos veces, mandar a la papelera y restaurar; lo mismo para los lugares.
// Nada se borra de verdad: lo que se borra queda inactivo en la papelera y se puede restaurar.
import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { AreaTexto, Aviso, Boton, Entrada, Etiqueta, Selector, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtFecha } from '@/lib/fechas'
import { ESPECIALIDADES, MEDICO_REPETIDO, esMedicoRepetido, paresParecidos, parecidos } from '@/lib/medicos'
import { mensajeError } from '@/lib/utils'
import type { Medico } from '@/lib/database.types'
import type { LugarMedico, Visitadora } from '@/components/admin/medica/datos'

const FRECUENCIAS = [7, 15, 30, 60, 90]
const TIPOS_LUGAR = ['Hospital', 'Sanatorio', 'Clínica', 'Consultorio', 'Centro médico', 'Centro de salud', 'Farmacia', 'Laboratorio']
const textoErr = (e: { code?: string; message?: string }) => (esMedicoRepetido(e) ? MEDICO_REPETIDO : mensajeError(e))
const lugaresDe = (m: Medico) => m.lugares.map((l) => l.nombre).join(', ')

/** Editar un médico: datos, visitadora, dónde atiende y con qué horario. */
export function FormMedico({ medico, lugares, visitadoras, alListo, alCancelar }: {
  medico: Medico; lugares: LugarMedico[]; visitadoras: Visitadora[]; alListo: (msg: string) => void; alCancelar: () => void
}) {
  const [f, setF] = useState({
    nombre: medico.nombre, especialidad: medico.especialidad ?? '', telefono: medico.telefono ?? '', email: medico.email ?? '',
    notas: medico.notas ?? '', frecuencia_dias: medico.frecuencia_dias, visitadora_id: medico.visitadora_id ?? '',
  })
  const [donde, setDonde] = useState<{ lugar_id: string; horario: string }[]>(medico.lugares.map((l) => ({ lugar_id: l.lugar_id, horario: l.horario ?? '' })))
  const [nuevoLugar, setNuevoLugar] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nombreLugar = (id: string) => lugares.find((l) => l.id === id)?.razon_social ?? medico.lugares.find((l) => l.lugar_id === id)?.nombre ?? 'Lugar'
  const libres = lugares.filter((l) => !donde.some((d) => d.lugar_id === l.id))
  const campo = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: k === 'frecuencia_dias' ? Number(e.target.value) : e.target.value }))

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!f.nombre.trim()) return setError('Falta el nombre.')
    setGuardando(true); setError(null)
    const sb = supabaseNavegador()
    try {
      const { error: e1 } = await sb.from('vis_medicos').update({
        nombre: f.nombre.trim(), especialidad: f.especialidad.trim() || null, telefono: f.telefono.trim() || null, email: f.email.trim() || null,
        notas: f.notas.trim() || null, frecuencia_dias: f.frecuencia_dias, visitadora_id: f.visitadora_id || null,
      }).eq('id', medico.id)
      if (e1) throw e1
      const quitar = medico.lugares.map((l) => l.lugar_id).filter((id) => !donde.some((d) => d.lugar_id === id))
      if (quitar.length) {
        const { error: e2 } = await sb.from('vis_medico_lugares').delete().eq('medico_id', medico.id).in('lugar_id', quitar)
        if (e2) throw e2
      }
      if (donde.length) {
        const { error: e3 } = await sb.from('vis_medico_lugares')
          .upsert(donde.map((d) => ({ medico_id: medico.id, lugar_id: d.lugar_id, horario: d.horario.trim() || null })), { onConflict: 'medico_id,lugar_id' })
        if (e3) throw e3
      }
      alListo(`Se guardaron los cambios de ${f.nombre.trim()}.`)
    } catch (err) {
      setError(textoErr(err as { code?: string; message?: string }))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-3 rounded-lg border border-borde bg-superficie p-3">
      <p className="font-semibold">Editar médico</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div><Etiqueta htmlFor={`n-${medico.id}`}>Nombre</Etiqueta><Entrada id={`n-${medico.id}`} value={f.nombre} onChange={campo('nombre')} autoComplete="off" /></div>
        <div>
          <Etiqueta htmlFor={`e-${medico.id}`}>Especialidad</Etiqueta>
          <Entrada id={`e-${medico.id}`} list="especialidades-panel" value={f.especialidad} onChange={campo('especialidad')} autoComplete="off" />
          <datalist id="especialidades-panel">{ESPECIALIDADES.map((x) => <option key={x} value={x} />)}</datalist>
        </div>
        <div><Etiqueta htmlFor={`t-${medico.id}`}>Celular</Etiqueta><Entrada id={`t-${medico.id}`} type="tel" value={f.telefono} onChange={campo('telefono')} autoComplete="off" /></div>
        <div><Etiqueta htmlFor={`m-${medico.id}`}>Email</Etiqueta><Entrada id={`m-${medico.id}`} type="email" value={f.email} onChange={campo('email')} autoComplete="off" /></div>
        <div>
          <Etiqueta htmlFor={`f-${medico.id}`}>Visitarlo cada</Etiqueta>
          <Selector id={`f-${medico.id}`} value={f.frecuencia_dias} onChange={campo('frecuencia_dias')}>
            {[...new Set([...FRECUENCIAS, f.frecuencia_dias])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d} días</option>)}
          </Selector>
        </div>
        {visitadoras.length > 1 && (
          <div>
            <Etiqueta htmlFor={`v-${medico.id}`}>Visitadora</Etiqueta>
            <Selector id={`v-${medico.id}`} value={f.visitadora_id} onChange={campo('visitadora_id')}>
              {visitadoras.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Selector>
          </div>
        )}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Dónde atiende y horario</legend>
        {donde.length === 0 && <p className="text-sm text-amber-800 dark:text-amber-300">Sin lugar: no aparece en ningún consultorio.</p>}
        {donde.map((d) => (
          <div key={d.lugar_id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-48 text-sm font-medium">{nombreLugar(d.lugar_id)}</span>
            <Entrada aria-label={`Horario en ${nombreLugar(d.lugar_id)}`} placeholder="Horario (ej.: lun y mié 8 a 12)" className="w-72" value={d.horario}
              onChange={(e) => setDonde((x) => x.map((y) => (y.lugar_id === d.lugar_id ? { ...y, horario: e.target.value } : y)))} />
            <button type="button" className="inline-flex items-center gap-1 text-sm text-red-700 underline dark:text-red-300"
              onClick={() => setDonde((x) => x.filter((y) => y.lugar_id !== d.lugar_id))}>Ya no atiende acá</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Selector aria-label="Agregar lugar" value={nuevoLugar} className="w-72" onChange={(e) => setNuevoLugar(e.target.value)}>
            <option value="">Agregar otro lugar…</option>
            {libres.map((l) => <option key={l.id} value={l.id}>{l.razon_social}</option>)}
          </Selector>
          <Boton type="button" variante="secundario" className="min-h-9" disabled={!nuevoLugar}
            onClick={() => { setDonde((x) => [...x, { lugar_id: nuevoLugar, horario: '' }]); setNuevoLugar('') }}>Agregar</Boton>
        </div>
      </fieldset>
      <div><Etiqueta htmlFor={`o-${medico.id}`}>Notas</Etiqueta><AreaTexto id={`o-${medico.id}`} value={f.notas} onChange={campo('notas')} /></div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex gap-2">
        <Boton type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</Boton>
        <Boton type="button" variante="fantasma" onClick={alCancelar}>Cancelar</Boton>
      </div>
    </form>
  )
}

/** Unir dos médicos: las visitas, planes y lugares del que sale pasan al que queda; el que sale va a la papelera. */
export function UnirMedico({ medico, todos, alListo, alCancelar }: { medico: Medico; todos: Medico[]; alListo: (msg: string) => void; alCancelar: () => void }) {
  const opciones = useMemo(() => todos.filter((m) => m.id !== medico.id)
    .sort((a, b) => Number(parecidos(medico.nombre, b.nombre)) - Number(parecidos(medico.nombre, a.nombre)) || a.nombre.localeCompare(b.nombre, 'es')), [todos, medico])
  const [otro, setOtro] = useState(opciones.find((m) => parecidos(medico.nombre, m.nombre))?.id ?? '')
  const [quedaEste, setQuedaEste] = useState(true)
  const [uniendo, setUniendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const elegido = opciones.find((m) => m.id === otro)
  const queda = quedaEste ? medico : elegido
  const sale = quedaEste ? elegido : medico

  async function unir() {
    if (!queda || !sale) return
    if (!confirm(`¿Unir a «${sale.nombre}» con «${queda.nombre}»?\n\nQueda «${queda.nombre}» con todas las visitas, planes y lugares de los dos. «${sale.nombre}» pasa a la papelera.`)) return
    setUniendo(true); setError(null)
    const { error: e } = await supabaseNavegador().rpc('vis_unir_medicos', { p_queda: queda.id, p_sale: sale.id })
    setUniendo(false)
    if (e) return setError(mensajeError(e))
    alListo(`Listo: «${sale.nombre}» quedó unido con «${queda.nombre}».`)
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-borde bg-superficie p-3">
      <p className="font-semibold">Unir con otro médico (cargado dos veces)</p>
      <Selector aria-label="Médico repetido" value={otro} onChange={(e) => setOtro(e.target.value)} className="max-w-xl">
        <option value="">Elegí el otro médico…</option>
        {opciones.map((m) => <option key={m.id} value={m.id}>{parecidos(medico.nombre, m.nombre) ? '≈ ' : ''}{m.nombre}{m.especialidad ? ` · ${m.especialidad}` : ''}{m.lugares.length ? ` · ${lugaresDe(m)}` : ''}</option>)}
      </Selector>
      {elegido && (
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 font-medium">¿Cuál queda?</legend>
          {[true, false].map((este) => {
            const m = este ? medico : elegido
            return (
              <label key={String(este)} className="flex items-start gap-2">
                <input type="radio" name={`queda-${medico.id}`} className="mt-0.5 size-4 accent-[var(--c-marca)]" checked={quedaEste === este} onChange={() => setQuedaEste(este)} />
                <span><b>{m.nombre}</b>{m.especialidad && ` · ${m.especialidad}`}<span className="text-tenue">{m.lugares.length ? ` · ${lugaresDe(m)}` : ''}{m.ultima_visita ? ` · última visita ${fmtFecha(m.ultima_visita)}` : ' · sin visitas'}</span></span>
              </label>
            )
          })}
        </fieldset>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex gap-2">
        <Boton disabled={!elegido || uniendo} onClick={() => void unir()}>{uniendo ? 'Uniendo…' : 'Unir'}</Boton>
        <Boton variante="fantasma" onClick={alCancelar}>Cancelar</Boton>
      </div>
    </div>
  )
}

const CLAVE_NO_SON = 'vis_no_son_el_mismo'
function leerNoSon(): string[] { try { return JSON.parse(localStorage.getItem(CLAVE_NO_SON) ?? '[]') as string[] } catch { return [] } }

/** Médicos que pueden estar cargados dos veces (nombre casi igual): unir o marcar «no son el mismo». */
export function PosiblesRepetidos({ medicos, alListo }: { medicos: Medico[]; alListo: (msg: string) => void }) {
  const [noSon, setNoSon] = useState<string[]>([])
  const [abierto, setAbierto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setNoSon(leerNoSon()), [])
  const pares = useMemo(() => paresParecidos(medicos).filter(([a, b]) => !noSon.includes([a.id, b.id].sort().join('|'))), [medicos, noSon])
  if (!pares.length) return null

  async function unir(queda: Medico, sale: Medico) {
    if (!confirm(`¿Unir a «${sale.nombre}» con «${queda.nombre}»? Queda «${queda.nombre}» con las visitas, planes y lugares de los dos; el otro pasa a la papelera.`)) return
    setOcupado(true); setError(null)
    const { error: e } = await supabaseNavegador().rpc('vis_unir_medicos', { p_queda: queda.id, p_sale: sale.id })
    setOcupado(false)
    if (e) return setError(mensajeError(e))
    alListo(`Listo: «${sale.nombre}» quedó unido con «${queda.nombre}».`)
  }
  function marcarNoSon(a: Medico, b: Medico) {
    const n = [...noSon, [a.id, b.id].sort().join('|')]
    setNoSon(n)
    try { localStorage.setItem(CLAVE_NO_SON, JSON.stringify(n)) } catch { /* sin almacenamiento: vuelve a aparecer */ }
  }
  const ficha = (m: Medico) => (
    <span><b>{m.nombre}</b>{m.especialidad && ` · ${m.especialidad}`}<span className="block text-xs text-tenue">{lugaresDe(m) || 'sin lugar'} · {m.ultima_visita ? `última visita ${fmtFecha(m.ultima_visita)}` : 'sin visitas'}</span></span>
  )

  return (
    <Tarjeta className="flex flex-col gap-2 border-amber-300 dark:border-amber-800">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">Posibles repetidos ({pares.length})</p>
        <p className="text-sm text-tenue">Nombres casi iguales: si es el mismo médico, unilos; si no, marcá «No son el mismo».</p>
        <Boton variante="secundario" className="ml-auto min-h-9" onClick={() => setAbierto(!abierto)}>{abierto ? 'Ocultar' : 'Revisar'}</Boton>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {abierto && (
        <ul className="flex flex-col divide-y divide-borde">
          {pares.map(([a, b]) => (
            <li key={`${a.id}${b.id}`} className="grid gap-2 py-2 text-sm md:grid-cols-[1fr_1fr_auto] md:items-center">
              {ficha(a)}{ficha(b)}
              <div className="flex flex-wrap gap-1.5">
                <Boton variante="secundario" className="min-h-9 px-2.5 text-sm" disabled={ocupado} onClick={() => void unir(a, b)}>Queda el 1.º</Boton>
                <Boton variante="secundario" className="min-h-9 px-2.5 text-sm" disabled={ocupado} onClick={() => void unir(b, a)}>Queda el 2.º</Boton>
                <Boton variante="fantasma" className="min-h-9 px-2.5 text-sm" disabled={ocupado} onClick={() => marcarNoSon(a, b)}>No son el mismo</Boton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  )
}

type Borrado = { id: string; nombre: string; detalle: string; notas: string | null; cuando: string }

/** Papelera: médicos o lugares borrados (inactivos), con «Restaurar». */
export function Papelera({ que, alListo }: { que: 'medicos' | 'lugares'; alListo: (msg: string) => void }) {
  const [lista, setLista] = useState<Borrado[] | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const sb = supabaseNavegador()
    const pedido = que === 'medicos'
      ? sb.from('vis_medicos').select('id, nombre, especialidad, notas, updated_at').eq('activo', false).order('updated_at', { ascending: false }).limit(300)
        .then(({ data, error: e }) => { if (e) setError(mensajeError(e)); setLista((data ?? []).map((m) => ({ id: m.id, nombre: m.nombre, detalle: m.especialidad ?? '', notas: m.notas, cuando: m.updated_at }))) })
      : sb.from('vis_clientes').select('id, razon_social, tipo_lugar, direccion, notas, updated_at').eq('categoria', 'lugar').eq('activo', false).order('updated_at', { ascending: false }).limit(300)
        .then(({ data, error: e }) => { if (e) setError(mensajeError(e)); setLista((data ?? []).map((l) => ({ id: l.id, nombre: l.razon_social, detalle: [l.tipo_lugar, l.direccion].filter(Boolean).join(' · '), notas: l.notas, cuando: l.updated_at }))) })
    void pedido
  }, [que, vuelta])

  async function restaurar(b: Borrado) {
    setOcupado(true); setError(null)
    const sb = supabaseNavegador()
    const { error: e } = que === 'medicos'
      ? await sb.from('vis_medicos').update({ activo: true }).eq('id', b.id)
      : await sb.from('vis_clientes').update({ activo: true }).eq('id', b.id)
    setOcupado(false)
    if (e) return setError(esMedicoRepetido(e) ? `Ya hay un médico activo llamado como «${b.nombre}». Si es el mismo, ya está; si es otro, cambiale el nombre a ese primero.` : mensajeError(e))
    setVuelta((v) => v + 1)
    alListo(`«${b.nombre}» volvió a la lista.`)
  }

  return (
    <Tarjeta className="flex flex-col gap-2">
      <div>
        <p className="flex items-center gap-2 font-semibold"><Trash2 className="size-4" aria-hidden /> Papelera de {que === 'medicos' ? 'médicos' : 'lugares'}</p>
        <p className="text-sm text-tenue">Lo que se borró o se unió con otro. Las visitas no se pierden: {que === 'medicos' ? 'las del médico unido ya están en el que quedó.' : 'quedan en el historial.'}</p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {lista === null ? <div className="h-16 animate-pulse rounded-lg bg-borde/40" /> : lista.length === 0 ? <p className="text-sm text-tenue">La papelera está vacía.</p> : (
        <ul className="flex flex-col divide-y divide-borde">
          {lista.map((b) => (
            <li key={b.id} className="flex flex-wrap items-start gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p><b>{b.nombre}</b>{b.detalle && <span className="text-tenue"> · {b.detalle}</span>} <span className="text-xs text-tenue">· borrado el {fmtFecha(b.cuando)}</span></p>
                {b.notas && <p className="whitespace-pre-line text-xs text-tenue">{b.notas}</p>}
              </div>
              <Boton variante="secundario" className="min-h-9 px-2.5 text-sm" disabled={ocupado} onClick={() => void restaurar(b)}>
                <RotateCcw className="size-4" aria-hidden /> Restaurar
              </Boton>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  )
}

/** Editar un lugar: nombre, tipo, dirección, ciudad y notas. */
export function FormLugar({ lugar, alListo, alCancelar }: { lugar: LugarMedico; alListo: (msg: string) => void; alCancelar: () => void }) {
  const [f, setF] = useState({ razon_social: lugar.razon_social, tipo_lugar: lugar.tipo_lugar ?? '', direccion: lugar.direccion ?? '', ciudad: lugar.ciudad ?? '', notas: lugar.notas ?? '' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const campo = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!f.razon_social.trim()) return setError('Falta el nombre del lugar.')
    setGuardando(true); setError(null)
    const { error: err } = await supabaseNavegador().from('vis_clientes').update({
      razon_social: f.razon_social.trim(), tipo_lugar: f.tipo_lugar.trim() || null, direccion: f.direccion.trim() || null,
      ciudad: f.ciudad.trim() || null, notas: f.notas.trim() || null,
    }).eq('id', lugar.id)
    setGuardando(false)
    if (err) return setError(mensajeError(err))
    alListo(`Se guardaron los cambios de ${f.razon_social.trim()}.`)
  }
  return (
    <form onSubmit={guardar} className="flex flex-col gap-3 rounded-lg border border-borde bg-superficie p-3">
      <p className="font-semibold">Editar lugar</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Etiqueta htmlFor={`ln-${lugar.id}`}>Nombre</Etiqueta><Entrada id={`ln-${lugar.id}`} value={f.razon_social} onChange={campo('razon_social')} autoComplete="off" /></div>
        <div>
          <Etiqueta htmlFor={`lt-${lugar.id}`}>Tipo</Etiqueta>
          <Entrada id={`lt-${lugar.id}`} list="tipos-lugar" value={f.tipo_lugar} onChange={campo('tipo_lugar')} autoComplete="off" />
          <datalist id="tipos-lugar">{TIPOS_LUGAR.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
        <div><Etiqueta htmlFor={`ld-${lugar.id}`}>Dirección</Etiqueta><Entrada id={`ld-${lugar.id}`} value={f.direccion} onChange={campo('direccion')} autoComplete="off" /></div>
        <div><Etiqueta htmlFor={`lc-${lugar.id}`}>Ciudad</Etiqueta><Entrada id={`lc-${lugar.id}`} value={f.ciudad} onChange={campo('ciudad')} autoComplete="off" /></div>
      </div>
      <div><Etiqueta htmlFor={`lo-${lugar.id}`}>Notas (las ve la visitadora)</Etiqueta><AreaTexto id={`lo-${lugar.id}`} value={f.notas} onChange={campo('notas')} /></div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex gap-2">
        <Boton type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</Boton>
        <Boton type="button" variante="fantasma" onClick={alCancelar}>Cancelar</Boton>
      </div>
    </form>
  )
}

/** Mandar un lugar a la papelera: sale de las rutas de hoy en adelante (si no tienen visita); las visitas quedan. */
export async function borrarLugar(l: { id: string; razon_social: string }): Promise<string | null> {
  if (!confirm(`¿Borrar «${l.razon_social}»? Va a la papelera y sale de las rutas de hoy en adelante. Las visitas que ya tiene quedan en el historial y se puede restaurar.`)) return null
  const { error } = await supabaseNavegador().rpc('vis_quitar_lugar', { p_lugar: l.id })
  if (error) throw new Error(mensajeError(error))
  return `«${l.razon_social}» se mandó a la papelera.`
}

/** Mandar un médico a la papelera: sale de las listas y los lugares; las visitas quedan. */
export async function borrarMedico(m: { id: string; nombre: string }): Promise<string | null> {
  if (!confirm(`¿Borrar a «${m.nombre}»? Va a la papelera: sale de la lista y de la app de la visitadora. Sus visitas quedan en el historial y se puede restaurar.`)) return null
  const { error } = await supabaseNavegador().from('vis_medicos').update({ activo: false }).eq('id', m.id)
  if (error) throw new Error(mensajeError(error))
  return `«${m.nombre}» se mandó a la papelera.`
}
