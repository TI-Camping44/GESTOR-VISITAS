'use client'
// Datos de visita médica para el panel (Sergio): visitadoras, médicos, lugares, visitas y llegadas.
// Todo con el RLS de quien mira: solo su empresa y su gente.
import { useEffect, useState } from 'react'
import { supabaseNavegador } from '@/lib/supabase/client'
import { claveEspecialidad } from '@/lib/medicos'
import { mensajeError } from '@/lib/utils'
import type { Medico, ProductoVisita } from '@/lib/database.types'

export type Visitadora = { id: string; nombre: string; activo: boolean }
export type LugarMedico = {
  id: string; razon_social: string; tipo_lugar: string | null; direccion: string | null; ciudad: string | null
  lat: number | null; lng: number | null; notas: string | null; vendedor_id: string | null; ultima_visita: string | null
}
export type VisitaMedica = {
  id: string; vendedor_id: string; cliente_id: string; medico_id: string | null; fecha_hora: string
  observaciones: string | null; proxima_visita: string | null; productos: ProductoVisita[] | null
  resultado: { nombre: string } | null; lugar: { razon_social: string } | null; medico: { nombre: string; especialidad: string | null } | null
}
export type Llegada = { id: string; vendedor_id: string; lugar_id: string; fecha_hora: string; lugar: { razon_social: string } | null }

const desdeIso = (dia: string) => new Date(`${dia}T00:00:00-03:00`).toISOString()

/** Visitadoras de la empresa (para filtros y nombres). */
export function useVisitadoras() {
  const [lista, setLista] = useState<Visitadora[]>([])
  useEffect(() => {
    void supabaseNavegador().from('vis_vendedores').select('id, nombre, activo').eq('tipo', 'medica').order('nombre')
      .then(({ data }) => setLista((data ?? []) as Visitadora[]))
  }, [])
  return lista
}

export function useMedicos() {
  const [medicos, setMedicos] = useState<Medico[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void supabaseNavegador().from('vis_medicos_v').select('*').order('nombre').limit(5000)
      .then(({ data, error: e }) => { if (e) setError(mensajeError(e)); setMedicos((data ?? []) as Medico[]) })
  }, [])
  return { medicos, error }
}

export function useLugares() {
  const [lugares, setLugares] = useState<LugarMedico[] | null>(null)
  useEffect(() => {
    void supabaseNavegador().from('vis_clientes_v').select('id, razon_social, tipo_lugar, direccion, ciudad, lat, lng, notas, vendedor_id, ultima_visita')
      .eq('categoria', 'lugar').order('razon_social').limit(2000)
      .then(({ data }) => setLugares((data ?? []) as LugarMedico[]))
  }, [])
  return lugares
}

const CAMPOS_VISITA = 'id, vendedor_id, cliente_id, medico_id, fecha_hora, observaciones, proxima_visita, productos, '
  + 'resultado:vis_resultados!vis_visitas_resultado_id_fkey(nombre), lugar:vis_clientes!vis_visitas_cliente_id_fkey(razon_social), '
  + 'medico:vis_medicos!vis_visitas_medico_id_fkey(nombre, especialidad)'

/** Visitas de las visitadoras entre dos días (inclusive), más nuevas primero. */
export async function leerVisitas(ids: string[], desde: string, hasta: string): Promise<VisitaMedica[]> {
  if (!ids.length) return []
  const fin = new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 86_400_000).toISOString()
  const { data, error } = await supabaseNavegador().from('vis_visitas').select(CAMPOS_VISITA)
    .in('vendedor_id', ids).gte('fecha_hora', desdeIso(desde)).lt('fecha_hora', fin).order('fecha_hora', { ascending: false }).limit(5000)
  if (error) throw new Error(mensajeError(error))
  return (data ?? []) as unknown as VisitaMedica[]
}

export async function leerLlegadas(ids: string[], desde: string, hasta: string): Promise<Llegada[]> {
  if (!ids.length) return []
  const fin = new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 86_400_000).toISOString()
  const { data, error } = await supabaseNavegador().from('vis_llegadas')
    .select('id, vendedor_id, lugar_id, fecha_hora, lugar:vis_clientes!vis_llegadas_lugar_id_fkey(razon_social)')
    .in('vendedor_id', ids).gte('fecha_hora', desdeIso(desde)).lt('fecha_hora', fin).order('fecha_hora').limit(5000)
  if (error) throw new Error(mensajeError(error))
  return (data ?? []) as unknown as Llegada[]
}

/** Visitas de un médico (historial), más nuevas primero. */
export async function leerVisitasDeMedico(medicoId: string): Promise<VisitaMedica[]> {
  const { data, error } = await supabaseNavegador().from('vis_visitas').select(CAMPOS_VISITA)
    .eq('medico_id', medicoId).order('fecha_hora', { ascending: false }).limit(200)
  if (error) throw new Error(mensajeError(error))
  return (data ?? []) as unknown as VisitaMedica[]
}

/** Especialidades agrupadas («Clínica Medica» = «Clínica médica»), con el nombre más usado. */
export function agruparEspecialidades(medicos: Medico[]) {
  const m = new Map<string, { clave: string; nombres: Map<string, number>; medicos: Medico[] }>()
  for (const x of medicos) {
    const clave = claveEspecialidad(x.especialidad) || 'sin'
    const g = m.get(clave) ?? { clave, nombres: new Map<string, number>(), medicos: [] as Medico[] }
    const nombre = x.especialidad?.trim() || 'Sin especialidad'
    g.nombres.set(nombre, (g.nombres.get(nombre) ?? 0) + 1)
    g.medicos.push(x)
    m.set(clave, g)
  }
  return [...m.values()].map((g) => ({
    clave: g.clave,
    nombre: [...g.nombres].sort((a, b) => b[1] - a[1])[0]![0],
    medicos: g.medicos,
  })).sort((a, b) => b.medicos.length - a.medicos.length || a.nombre.localeCompare(b.nombre, 'es'))
}

export const totalMuestras = (v: Pick<VisitaMedica, 'productos'>) => (v.productos ?? []).reduce((s, p) => s + Number(p.muestras ?? 0), 0)
export const textoProductos = (v: Pick<VisitaMedica, 'productos'>) =>
  (v.productos ?? []).map((p) => (p.muestras ? `${p.producto} (${p.muestras})` : p.producto)).join(', ')
