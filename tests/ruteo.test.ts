import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtMin, horasEstimadas, leerDia, leerPlanilla, minDeHora } from '../lib/ruteo'

const OFICINA = { lat: -25.269635, lng: -57.602141 }

test('horas estimadas como la planilla de Sergio', () => {
  // Miércoles 04/11: sale 11:00 → La Costa Artigas 11:08, Randall 12:05 (sin almuerzo: empezó a las 11).
  const h = horasEstimadas(OFICINA, [{ lat: -25.272939, lng: -57.607289 }, { lat: -25.28567, lng: -57.618604 }], { inicioMin: 11 * 60 })
  assert.equal(fmtMin(h[0]!.llegada), '11:08')
  assert.equal(fmtMin(h[0]!.salida), '11:53')
  assert.equal(fmtMin(h[1]!.llegada), '12:05')
  assert.equal(h[0]!.km, 0.9)
})

test('almuerzo de una hora al pasar las 12 si el día empezó temprano', () => {
  const p = { lat: -25.27, lng: -57.6 }
  const h = horasEstimadas(p, [p, p, p, p, p], { inicioMin: 8 * 60 })
  // 5 min de estacionar + 45 por lugar: 8:05, 8:55, 9:45, 10:35, 11:25 (sale 12:10) → nada antes
  assert.equal(fmtMin(h[4]!.llegada), '11:25')
  const h2 = horasEstimadas(p, [p, p, p, p, p, p], { inicioMin: 8 * 60 })
  assert.equal(fmtMin(h2[5]!.llegada), '13:15', 'después de salir 12:10, una hora de almuerzo')
})

test('sin coordenadas: 15 min de viaje', () => {
  const h = horasEstimadas(null, [{ lat: null, lng: null }], { inicioMin: 9 * 60 })
  assert.equal(fmtMin(h[0]!.llegada), '9:15')
  assert.equal(h[0]!.km, null)
  assert.equal(minDeHora('08:30'), 510)
  assert.equal(minDeHora('25:00'), null)
})

test('días de la planilla', () => {
  const lunes = '2026-11-02'
  assert.equal(leerDia('04/11/2026', lunes), '2026-11-04')
  assert.equal(leerDia('5/11', lunes), '2026-11-05')
  assert.equal(leerDia('Miércoles', lunes), '2026-11-04')
  assert.equal(leerDia('mié', lunes), '2026-11-04')
  assert.equal(leerDia('VIERNES', lunes), '2026-11-06')
  assert.equal(leerDia('', lunes), null)
})

test('planilla con encabezado, en cualquier orden, varios médicos en una celda', () => {
  const texto = [
    'Día de visita\tCentro médico / Consultorio\tEspecialidad\tDr',
    'Jueves\tSanatorio Migone\tTraumatología\tDr. Pérez; Dra. López',
    'Miércoles\tLa Costa Artigas\tNutrición\t',
    'Lunes 9/11\tX\t\t',
    'Domingo\t\t\t',
  ].join('\n')
  const { filas, errores } = leerPlanilla(texto, '2026-11-02')
  assert.deepEqual(filas.map((f) => [f.dia, f.lugar, f.especialidad, f.medico]), [
    ['2026-11-04', 'La Costa Artigas', 'Nutrición', null],
    ['2026-11-05', 'Sanatorio Migone', 'Traumatología', 'Dr. Pérez'],
    ['2026-11-05', 'Sanatorio Migone', 'Traumatología', 'Dra. López'],
  ])
  assert.equal(errores.length, 1, 'el 09/11 no es de esa semana; el renglón sin lugar se ignora')
})

test('planilla de Sergio (Fecha, Orden, Institución, Latitud, Longitud, Médico(s) objetivo)', () => {
  const texto = [
    'Día\tFecha\tOrden\tZona\tInstitución\tTipo\tDirección\tLatitud\tLongitud\tUbicación\tKm\tMin\tLlegada est.\tSalida est.\tMédico(s) objetivo\tEspecialidad',
    'Jueves\t05/11/2026\t2\tNorte\tHospital Policial\tPúblico\tAv. Kubitschek\t-25.292868\t-57.603095\tVer\t6\t23\t9:23\t10:08\t\tDeportología',
    'Jueves\t05/11/2026\t1\tNorte\tSanatorio Santa Bárbara\tPrivado\tAlejandro Ravizza 263\t-25.258518\t-57.581147\tVer\t3.3\t15\t8:15\t9:00\tDr. Gómez\t',
  ].join('\n')
  const { filas, errores } = leerPlanilla(texto, '2026-11-02')
  assert.equal(errores.length, 0)
  assert.deepEqual(filas.map((f) => [f.lugar, f.medico, f.especialidad, f.lat, f.direccion]), [
    ['Sanatorio Santa Bárbara', 'Dr. Gómez', null, -25.258518, 'Alejandro Ravizza 263'],
    ['Hospital Policial', null, 'Deportología', -25.292868, 'Av. Kubitschek'],
  ])
})

test('sin encabezado: lugar, especialidad, doctor, día', () => {
  const { filas } = leerPlanilla('IPS Central\tPediatría\tDra. Ruiz\tViernes', '2026-11-02')
  assert.deepEqual(filas.map((f) => [f.lugar, f.especialidad, f.medico, f.dia]), [['IPS Central', 'Pediatría', 'Dra. Ruiz', '2026-11-06']])
})
