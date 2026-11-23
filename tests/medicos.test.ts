import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claveEspecialidad, diasDeHorario, parecidos } from '../lib/medicos'

test('días del horario escrito a mano', () => {
  assert.deepEqual(diasDeHorario('Lunes a Viernes 07:00 Hs a 17:00 Hs.'), [1, 2, 3, 4, 5])
  assert.deepEqual(diasDeHorario('Martes, Jueves y Viernes a partir de las 17:00 Hs'), [2, 4, 5])
  assert.deepEqual(diasDeHorario('Martes. 11:00 Hs. Jueves, 12:00 Hs y Viernes 14:00 Hs.'), [2, 4, 5])
  assert.deepEqual(diasDeHorario('Lunes y Jueves de 15:00 Hs. a 19:00 Hs. Viernes, 08:00 Hs a 12:00Hs.'), [1, 4, 5])
  assert.deepEqual(diasDeHorario('Miércoles y Viernes 15:00 a 18:00 Hs.'), [3, 5])
  assert.deepEqual(diasDeHorario('lun y mié 8 a 12'), [1, 3])
  assert.deepEqual(diasDeHorario('Lunes a Viernes de mañana 09:00 Hs a 13:00 Hs'), [1, 2, 3, 4, 5])
  assert.deepEqual(diasDeHorario('lun-jue'), [1, 2, 3, 4])
  assert.deepEqual(diasDeHorario('sábados de mañana'), [6])
  assert.deepEqual(diasDeHorario('8 a 12'), [])
  assert.deepEqual(diasDeHorario(null), [])
})

test('especialidades escritas distinto se agrupan', () => {
  assert.equal(claveEspecialidad('Clínica Medica'), claveEspecialidad('Clínica médica'))
  assert.equal(claveEspecialidad('  Endocrinología '), 'endocrinologia')
})

test('palabras que no son días no cuentan', () => {
  assert.deepEqual(diasDeHorario('Atiende a domicilio en marzo'), [])
  assert.deepEqual(diasDeHorario('Escribir para agendar Visita a fin de mes.'), [])
  assert.deepEqual(diasDeHorario('Martes, 10:30 Hs. Miercoles 08:00 Hs. Y Jueves 08:00 Hs.'), [2, 3, 4])
  assert.deepEqual(diasDeHorario('Lunes; 07:30 Hs. Martes, 16:30 Hs.'), [1, 2])
  assert.deepEqual(diasDeHorario('Miércoles  Jueves  y Viernes'), [3, 4, 5])
})

test('claveNombre y mismoMedico: el mismo médico cargado dos veces', async () => {
  const { claveNombre, mismoMedico } = await import('../lib/medicos')
  assert.equal(claveNombre('Dra. Yanina  Meza'), 'yanina meza')
  assert.equal(claveNombre('Dr María González'), 'maria gonzalez')
  assert.ok(mismoMedico({ id: 'a', nombre: 'Dra. Yanina  Meza' }, { id: 'b', nombre: 'Dra. Yanina Meza' }))
  assert.ok(!mismoMedico({ id: 'a', nombre: 'Dra. Edith Fernández' }, { id: 'b', nombre: 'Dra. Elayne Fernández' }))
  assert.ok(mismoMedico({ id: 'x', nombre: null }, { id: 'x', nombre: 'Otro' }))
})

test('médicos parecidos: el mismo escrito distinto', () => {
  assert.equal(parecidos('Dra. Yanina  Meza', 'Dra. Yanina Mesa'), true)
  assert.equal(parecidos('Lic. Agostina Olivo', 'Agostina Oliva'), true)
  assert.equal(parecidos('Dr. Marcos Cinturón', 'Dr. Marcos Centurión'), true)
  assert.equal(parecidos('Silvana Torres', 'Sylvana Torres'), true)
  assert.equal(parecidos('Ana Santillán', 'Ana Cecilia Santilla'), true)
  assert.equal(parecidos('Enrique García Bello', 'Enrique García Colman'), true)
})

test('médicos parecidos: no junta a distintos', () => {
  assert.equal(parecidos('María González', 'María Gómez'), false)
  assert.equal(parecidos('Juan Pérez', 'Pedro Pérez'), false)
  assert.equal(parecidos('Ana', 'Ana'), true)
})
