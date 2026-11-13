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

/** Días de la semana (1 = lunes … 7 = domingo) con su nombre corto, para filtros y chips. */
export const DIAS_SEMANA = [
  { n: 1, corto: 'Lun', largo: 'Lunes' }, { n: 2, corto: 'Mar', largo: 'Martes' }, { n: 3, corto: 'Mié', largo: 'Miércoles' },
  { n: 4, corto: 'Jue', largo: 'Jueves' }, { n: 5, corto: 'Vie', largo: 'Viernes' }, { n: 6, corto: 'Sáb', largo: 'Sábado' },
  { n: 7, corto: 'Dom', largo: 'Domingo' },
] as const

// Nombres y abreviaturas de los días, exactos (así «domicilio» o «marzo» no cuentan como días).
const PALABRA_DIA: Record<string, number> = Object.fromEntries([
  [1, ['lunes', 'lun']], [2, ['martes', 'mar']], [3, ['miercoles', 'mier', 'mie']], [4, ['jueves', 'jue']],
  [5, ['viernes', 'vie']], [6, ['sabado', 'sabados', 'sab']], [7, ['domingo', 'domingos', 'dom']],
].flatMap(([n, ps]) => (ps as string[]).map((p) => [p, n as number])))
const normalTexto = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Días en que atiende, leídos del horario que escribe la visitadora a mano:
 * «Lunes a Viernes 07:00 a 17:00» → lun–vie; «Martes, Jueves y Viernes» → mar, jue, vie;
 * «lun y mié 8 a 12» → lun, mié. Sin días reconocibles → [].
 */
export function diasDeHorario(horario: string | null | undefined): number[] {
  if (!horario) return []
  const t = normalTexto(horario)
  const menciones: { dia: number; ini: number; fin: number }[] = []
  for (const m of t.matchAll(/[a-z]+/g)) {
    const dia = PALABRA_DIA[m[0]]
    if (dia) menciones.push({ dia, ini: m.index!, fin: m.index! + m[0].length })
  }
  const dias = new Set<number>()
  menciones.forEach((m, i) => {
    dias.add(m.dia)
    const sig = menciones[i + 1]
    // «lunes a viernes», «lun-vie», «lunes al viernes», «de lunes hasta jueves»: rango.
    if (sig && /^\s*(a|al|-|–|hasta)\s*$/.test(t.slice(m.fin, sig.ini)) && sig.dia > m.dia) {
      for (let d = m.dia; d <= sig.dia; d++) dias.add(d)
    }
  })
  return [...dias].sort((a, b) => a - b)
}

/** Clave para agrupar especialidades escritas distinto («Clínica Medica» = «Clínica médica»). */
export const claveEspecialidad = (e: string | null | undefined) => normalTexto((e ?? '').trim()).replace(/\s+/g, ' ')
