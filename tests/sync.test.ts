import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coordenadasOdoo, filaCliente, telefonoOdoo, vendedorPorFacturas } from '../lib/sync/reglas'

test('el cliente es del vendedor de su última factura', () => {
  const m = vendedorPorFacturas([
    { partnerId: 1, userId: 10, ultima: '2026-05-01', monto: 900 },
    { partnerId: 1, userId: 20, ultima: '2026-09-15', monto: 100 },
    { partnerId: 2, userId: 10, ultima: '2026-09-01', monto: 50 },
    { partnerId: 2, userId: 30, ultima: '2026-09-01', monto: 80 },
    { partnerId: 3, userId: null, ultima: '2026-10-01', monto: 500 },
  ])
  assert.equal(m.get(1), 20, 'gana la factura más nueva aunque sea menor')
  assert.equal(m.get(2), 30, 'mismo día: el de mayor monto')
  assert.equal(m.has(3), false, 'facturas sin vendedor no asignan')
})

test('teléfono y coordenadas de Odoo', () => {
  assert.equal(telefonoOdoo({ id: 1, name: 'x', mobile: "'0981 111 222", phone: false }), '0981 111 222')
  assert.equal(telefonoOdoo({ id: 1, name: 'x', mobile: '.', phone: '999999999' }), null)
  assert.equal(telefonoOdoo({ id: 1, name: 'x', mobile: false, phone: '021 555 444' }), '021 555 444')
  assert.equal(coordenadasOdoo({ id: 1, name: 'x', partner_latitude: 0, partner_longitude: 0 }), null)
  assert.deepEqual(coordenadasOdoo({ id: 1, name: 'x', partner_latitude: -25.3, partner_longitude: -57.6 }), { lat: -25.3, lng: -57.6 })
})

test('Odoo no pisa una ubicación corregida en la calle', () => {
  const p = { id: 7, name: 'Ferretería', partner_latitude: -25.3, partner_longitude: -57.6, city: 'Luque', state_id: [5, 'Central'] as [number, string] }
  const nuevo = filaCliente(p, undefined, false)
  assert.equal(nuevo.pisaUbicacion, true)
  assert.equal(nuevo.fila.lat, -25.3)
  assert.equal(nuevo.fila.origen_ubicacion, 'odoo')
  assert.equal(nuevo.fila.departamento, 'Central')
  assert.equal(filaCliente({ ...p, city: 'ASUNCION (DISTRITO)' }, undefined, false).fila.ciudad, 'ASUNCION', 'ciudad sin el (DISTRITO)')
  const corregido = filaCliente(p, 'gps_visita', true)
  assert.equal(corregido.pisaUbicacion, false)
  assert.equal('lat' in corregido.fila, false, 'no manda lat/lng')
  assert.equal(corregido.fila.lat_odoo, -25.3, 'pero sí guarda la de Odoo como referencia')
  assert.equal(filaCliente(p, 'odoo', true).pisaUbicacion, true, 'si la vigente es de Odoo, se actualiza')
})
