import type { Medico } from '@/lib/database.types'

/** Días desde la última visita al médico (null = nunca). */
export function diasSinVisita(m: Pick<Medico, 'ultima_visita'>, ahora = Date.now()): number | null {
  return m.ultima_visita ? Math.floor((ahora - new Date(m.ultima_visita).getTime()) / 86_400_000) : null
}

/** Le toca visita: nunca se lo visitó o ya pasó su frecuencia. */
export function tocaVisitar(m: Pick<Medico, 'ultima_visita' | 'frecuencia_dias'>, ahora = Date.now()): boolean {
  const d = diasSinVisita(m, ahora)
  return d == null || d >= m.frecuencia_dias
}

export const ESPECIALIDADES = [
  'Clínica médica', 'Pediatría', 'Ginecología', 'Cardiología', 'Traumatología', 'Dermatología', 'Nutrición',
  'Endocrinología', 'Gastroenterología', 'Neurología', 'Medicina familiar', 'Odontología', 'Kinesiología',
]

export const TIPOS_LUGAR = ['Hospital', 'Sanatorio', 'Clínica', 'Consultorio', 'Centro de salud', 'Farmacia', 'Otro']
