import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { distanciaM, linksGoogleMaps, ordenarParadas } from '../lib/geo'
import { fmtFecha, lunesDe, semanaIso, sumarDias } from '../lib/fechas'

describe('geo', () => {
  it('distancia Asunción–Concepción ≈ 207 km', () => {
    const d = distanciaM({ lat: -25.2637, lng: -57.5759 }, { lat: -23.4064, lng: -57.4344 })
    assert.ok(d > 200_000 && d < 215_000, `fue ${d}`)
  })

  it('ordena paradas en línea sin cruces', () => {
    const p = [0.05, 0.01, 0.04, 0.02, 0.03].map((x, i) => ({ id: i, lat: -25 - x, lng: -57.5 }))
    const orden = ordenarParadas(p, { lat: -25, lng: -57.5 }).map((x) => x.lat)
    assert.deepEqual(orden, [...orden].sort((a, b) => b - a))
  })

  it('parte la navegación en tramos de 9 intermedias', () => {
    const p = Array.from({ length: 23 }, (_, i) => ({ lat: -25 - i / 100, lng: -57.5 }))
    const links = linksGoogleMaps(null, p)
    assert.equal(links.length, 3) // 10 + 10 + 3
    const primero = new URL(links[0]!)
    assert.equal(primero.searchParams.get('origin'), null, 'sin origen usa la ubicación actual')
    assert.equal(primero.searchParams.get('waypoints')!.split('|').length, 9)
    assert.equal(new URL(links[1]!).searchParams.get('origin'), primero.searchParams.get('destination'), 'cada tramo sigue al anterior')
  })
})

describe('fechas', () => {
  it('lunes de la semana y número de semana ISO', () => {
    assert.equal(lunesDe('2026-10-12'), '2026-10-12')
    assert.equal(lunesDe('2026-10-18'), '2026-10-12') // domingo
    assert.equal(semanaIso('2026-10-12'), 42)
    assert.equal(sumarDias('2026-12-31', 1), '2027-01-01')
  })
  it('formato dd/MM/yyyy en hora de Asunción', () => {
    assert.equal(fmtFecha('2026-10-07'), '07/10/2026')
    assert.equal(fmtFecha(new Date('2026-10-08T02:00:00Z')), '07/10/2026') // 23:00 del 7 en Asunción
  })
})

describe('leerCoordenadas', () => {
  it('acepta "lat, lng" y links de Google Maps', async () => {
    const { leerCoordenadas } = await import('../lib/geo')
    assert.deepEqual(leerCoordenadas('-25.2637, -57.5759'), { lat: -25.2637, lng: -57.5759 })
    assert.deepEqual(leerCoordenadas('https://www.google.com/maps/place/x/@-23.4064,-57.4344,17z'), { lat: -23.4064, lng: -57.4344 })
    assert.equal(leerCoordenadas('Concepción'), null)
  })
})

describe('semanaDelMes', () => {
  it('numera las semanas del mes por el lunes', async () => {
    const { semanaDelMes } = await import('../lib/fechas')
    assert.deepEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map(semanaDelMes), [1, 2, 3, 4])
    assert.equal(semanaDelMes('2026-11-30'), 5)
  })
})
