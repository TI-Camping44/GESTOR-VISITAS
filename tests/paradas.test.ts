import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analizarJornada, motivoCorte } from '../lib/paradas'

const t = (hhmm: string) => `2026-11-05T${hhmm}:00.000Z`
const A = { lat: -25.3, lng: -57.6 }      // cliente
const B = { lat: -25.33, lng: -57.55 }    // casa (lejos)

test('paradas de 10 minutos o más, aunque no haya puntos en el medio', () => {
  const pos = [
    { fecha_hora: t('12:00'), ...A }, { fecha_hora: t('12:01'), lat: A.lat + 0.0003, lng: A.lng }, { fecha_hora: t('12:20'), ...A },
    { fecha_hora: t('12:22'), lat: -25.31, lng: -57.58 },
    { fecha_hora: t('12:24'), ...B }, { fecha_hora: t('13:30'), ...B, bateria_pct: 60 },
  ]
  const r = analizarJornada(pos, t('12:00'), t('13:30'))
  assert.deepEqual(r.paradas.map((p) => [p.inicio, p.minutos]), [[t('12:00'), 20], [t('12:24'), 66]])
  assert.equal(r.cortes.length, 0, 'quedarse quieto sin puntos no es un corte')
  assert.equal(r.cubiertoPct, 100)
})

test('cortes: se movió sin GPS, con la batería de antes; bordes de la jornada', () => {
  const pos = [{ fecha_hora: t('11:40'), ...A, bateria_pct: 30 }, { fecha_hora: t('12:50'), ...B, bateria_pct: 28 }]
  const r = analizarJornada(pos, t('11:30'), null, t('13:30'))
  assert.deepEqual(r.cortes.map((c) => [c.tipo, c.minutos]), [['al_iniciar', 10], ['en_camino', 70], ['al_final', 40]])
  assert.equal(r.cortes[1]!.bateriaAntes, 30)
  assert.equal(r.cubiertoPct, 0)
  assert.equal(r.tramos.length, 0, 'sin tramos continuos para dibujar')
  assert.match(motivoCorte(r.cortes[1]!, true), /celular apagado/)
  assert.match(motivoCorte({ ...r.cortes[1]!, bateriaAntes: 3 }, true), /Batería agotada/)
})

test('excesos de velocidad agrupados', () => {
  const pos = [
    { fecha_hora: t('02:00'), lat: -25.30, lng: -57.60, velocidad_kmh: 80 },
    { fecha_hora: t('02:01'), lat: -25.31, lng: -57.60, velocidad_kmh: 130 },
    { fecha_hora: t('02:02'), lat: -25.32, lng: -57.60, velocidad_kmh: 145.4 },
    { fecha_hora: t('02:03'), lat: -25.33, lng: -57.60, velocidad_kmh: 90 },
  ]
  const r = analizarJornada(pos, t('02:00'), t('02:03'))
  assert.equal(r.maxKmh, 145)
  assert.deepEqual(r.excesos.map((e) => [e.inicio, e.fin, e.maxKmh]), [[t('02:01'), t('02:02'), 145]])
  assert.equal(r.tramos.length, 1)
})
