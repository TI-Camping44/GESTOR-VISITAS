import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renombrarSemana, semanaDelCiclo } from '../lib/rutas'
import { textoMotivo } from '../lib/medicos'

describe('ciclos de rutas (TI-0115)', () => {
  it('semana del ciclo: se repite cada N semanas desde el inicio', () => {
    assert.equal(semanaDelCiclo('2026-11-16', 4, '2026-11-16'), 1)
    assert.equal(semanaDelCiclo('2026-11-16', 4, '2026-11-23'), 2)
    assert.equal(semanaDelCiclo('2026-11-16', 4, '2026-12-07'), 4)
    assert.equal(semanaDelCiclo('2026-11-16', 4, '2026-12-14'), 1)
    assert.equal(semanaDelCiclo('2026-11-16', 2, '2026-12-14'), 1)
    assert.equal(semanaDelCiclo('2026-11-16', 3, '2026-12-14'), 2)
  })
  it('antes del inicio no hay semana', () => {
    assert.equal(semanaDelCiclo('2026-11-16', 4, '2026-11-09'), null)
  })
  it('cruza el año sin correrse (Paraguay sin horario de verano)', () => {
    assert.equal(semanaDelCiclo('2026-12-28', 4, '2027-01-25'), 1)
  })
  it('el nombre cambia de semana como en «Duplicar»', () => {
    assert.equal(renombrarSemana('Ciclo Hugo · S1 – Sem 47 – Hugo', 51), 'Ciclo Hugo · S1 – Sem 51 – Hugo')
  })
})

describe('no concretadas en la venta', () => {
  it('texto de los motivos de venta y de visita médica', () => {
    assert.equal(textoMotivo('reprogramado'), 'El cliente pidió que vuelva otro día')
    assert.equal(textoMotivo('encargado_ausente'), 'No estaba el encargado o comprador')
    assert.equal(textoMotivo('sin_medicos'), 'No había médicos')
    assert.equal(textoMotivo('cualquiera'), 'Otro motivo')
  })
})
