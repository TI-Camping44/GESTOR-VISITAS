import type { Medico, MotivoNoVisita } from '@/lib/database.types'

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

/** Motivos de «No pude visitar este lugar» (en el orden en que se ofrecen). */
export const MOTIVOS_NO_VISITA: { valor: MotivoNoVisita; texto: string }[] = [
  { valor: 'sin_medicos', texto: 'No había médicos' },
  { valor: 'sin_acceso', texto: 'Sin acceso: no me dejaron pasar' },
  { valor: 'cerrado', texto: 'Estaba cerrado' },
  { valor: 'licencia', texto: 'Médico de vacaciones o con licencia' },
  { valor: 'otro', texto: 'Otro motivo' },
]
/** Motivos de «No pude visitar» en la venta (parada de la ruta del vendedor). Mismo texto que vis_texto_motivo_no_visita. */
export const MOTIVOS_NO_VISITA_VENTA: { valor: MotivoNoVisita; texto: string }[] = [
  { valor: 'cerrado', texto: 'Estaba cerrado' },
  { valor: 'encargado_ausente', texto: 'No estaba el encargado o comprador' },
  { valor: 'reprogramado', texto: 'El cliente pidió que vuelva otro día' },
  { valor: 'sin_tiempo', texto: 'No me dio el tiempo' },
  { valor: 'otro', texto: 'Otro motivo' },
]
export const textoMotivo = (m: string | null | undefined) =>
  [...MOTIVOS_NO_VISITA, ...MOTIVOS_NO_VISITA_VENTA].find((x) => x.valor === m)?.texto ?? 'Otro motivo'

/** Resultados de visita médica en los que el médico no fue atendido (no cuenta como «visto» en el plan del día). */
// «Otro motivo» y «Pidió volver otro día» también: la visitadora los usa cuando no pudo presentar (congreso, canceló…).
export const RESULTADOS_NO_VISTO = ['No estaba / no atendió', 'Sin acceso', 'Ya no atiende acá', 'Pidió volver otro día', 'Otro motivo']
export const noLoVio = (resultado: string | null | undefined) => !!resultado && RESULTADOS_NO_VISTO.includes(resultado)

/** Qué pasó con una visita que no se hizo, en palabras («Sin acceso» → «no dejaron pasar»). */
const QUE_PASO: Record<string, string> = {
  'No estaba / no atendió': 'el médico no estaba o no atendió',
  'Sin acceso': 'no dejaron pasar (sin acceso)',
  'Ya no atiende acá': 'el médico ya no atiende en este lugar',
  'Pidió volver otro día': 'reprogramada: el médico pidió volver otro día',
  'Otro motivo': 'otro motivo',
}
export const quePaso = (resultado: string | null | undefined) => (resultado && QUE_PASO[resultado]) ?? (resultado ?? 'sin motivo').toLowerCase()

/** Nombre para comparar médicos cargados dos veces («Dra. Yanina  Meza» = «Dra. Yanina Meza»): sin título, tildes ni espacios de más. */
export const claveNombre = (n: string | null | undefined) => (n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(dr|dra|lic|doctor|doctora|licenciada?)\b\.?/g, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
/** ¿Es el mismo médico? Por id o, si hay dos fichas, por el nombre. */
export const mismoMedico = (a: { id?: string | null; nombre?: string | null } | null | undefined, b: { id?: string | null; nombre?: string | null } | null | undefined) =>
  !!a && !!b && ((!!a.id && a.id === b.id) || (!!claveNombre(a.nombre) && claveNombre(a.nombre) === claveNombre(b.nombre)))

/** Cambios de letra entre dos textos (Levenshtein). */
export function distancia(a: string, b: string) {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]!
}

/** Dos nombres que pueden ser el mismo médico escrito distinto («Yanina Meza» / «Yanina Mesa», «Ana Santillán» /
 *  «Ana Cecilia Santilla»): mismo primer nombre (o casi) y otro nombre o apellido casi igual. Igual clave también cuenta. */
export function parecidos(a: string, b: string) {
  const x = claveNombre(a), y = claveNombre(b)
  if (!x || !y) return false
  if (x === y) return true
  const ta = x.split(' '), tb = y.split(' ')
  if (ta.length < 2 || tb.length < 2 || distancia(ta[0]!, tb[0]!) > 1) return false
  return ta.slice(1).some((p) => p.length >= 4 && tb.slice(1).some((q) => q.length >= 4 && distancia(p, q) <= (Math.min(p.length, q.length) >= 7 ? 2 : 1)))
}

/** Pares de médicos que pueden estar cargados dos veces, para revisar y unir. */
export function paresParecidos<T extends { id: string; nombre: string }>(medicos: T[]) {
  const pares: [T, T][] = []
  for (let i = 0; i < medicos.length; i++) for (let j = i + 1; j < medicos.length; j++) if (parecidos(medicos[i]!.nombre, medicos[j]!.nombre)) pares.push([medicos[i]!, medicos[j]!])
  return pares
}

/** Error al guardar un médico: el índice único de nombres (0042) quiere decir «ya está cargado». */
export const MEDICO_REPETIDO = 'Ya hay un médico cargado con ese nombre. Buscalo en la lista y usá ese (o, si es otro médico, agregale el segundo nombre).'
export const esMedicoRepetido = (e: { code?: string; message?: string } | null | undefined) => e?.code === '23505' && /vis_medicos_nombre_unico/.test(e.message ?? '')
