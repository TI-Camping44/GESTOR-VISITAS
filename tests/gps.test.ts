import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fechaGps, leerEnvioGps } from '../lib/gpsExterno'

test('Traccar OsmAnd: parámetros en la dirección', () => {
  const p = new URLSearchParams('id=c44abc1234567890&lat=-25.29&lon=-57.61&timestamp=1762354800&accuracy=12&speed=10&batt=55')
  const r = leerEnvioGps(p, null)
  assert.equal(r.codigo, 'c44abc1234567890')
  assert.deepEqual(r.puntos, [{ fecha_hora: '2025-11-05T15:00:00.000Z', lat: -25.29, lng: -57.61, precision_m: 12, velocidad_kmh: 18.5, bateria_pct: 55 }])
})

test('Traccar Client 9: JSON con una o varias posiciones', () => {
  const r = leerEnvioGps(new URLSearchParams(), { device_id: 'c44x', location: [
    { timestamp: '2026-11-05T15:00:00.000Z', coords: { latitude: -25.3, longitude: -57.6, accuracy: 8, speed: 25 }, battery: { level: 0.42 } },
    { timestamp: '2026-11-05T15:01:00.000Z', coords: { latitude: -25.31, longitude: -57.61, accuracy: 9, speed: -1 }, battery: { level: -1 } },
  ] })
  assert.equal(r.codigo, 'c44x')
  assert.equal(r.puntos.length, 2)
  assert.equal(r.puntos[0]!.velocidad_kmh, 90)
  assert.equal(r.puntos[0]!.bateria_pct, 42)
  assert.equal(r.puntos[1]!.velocidad_kmh, null)
  assert.equal(r.puntos[1]!.bateria_pct, null)
  assert.equal(fechaGps(1762354800000), '2025-11-05T15:00:00.000Z')
})
