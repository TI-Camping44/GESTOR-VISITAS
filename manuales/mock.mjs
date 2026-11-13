// Simulador de Supabase para las capturas de los manuales. Datos de ejemplo (no reales).
// PERFIL=hum (vendedor C44) | jor (supervisor C44) | hug (vendedor Vitalica) | noe (visitadora) | ser (admin Vitalica)
// JORNADA=1: jornada abierta.
import { createServer } from 'node:http'
const P = process.env.PERFIL ?? 'hum'
const JORNADA = !!process.env.JORNADA
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date())
const sumar = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const lunes = (() => { const d = new Date(`${hoy}T12:00:00Z`); return sumar(hoy, -((d.getUTCDay() + 6) % 7)) })()
const h = (hhmm, dia = hoy) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString()
const E1 = 'e1', E2 = 'e2'
const V = (id, nombre, rol, empresa, tipo = 'ventas', extra = {}) => ({ id, nombre, email: `${nombre.split(' ')[0].toLowerCase()}@empresa.com.py`, rol, empresa_id: empresa, tipo, activo: true, meta_diaria: 8, meta_semanal: 40, telefono: '0981 000 000', auth_user_id: 'x', tracking_aceptado_el: h('07:00', sumar(hoy, -20)), base_lat: null, base_lng: null, created_at: '2026-10-01', odoo_user_id: null, multi_empresa: false, empresa_activa: null, equipo_id: empresa === E1 ? 'eq1' : null, ...extra })
const vendedores = [
  V('hum', 'Humberto Benítez', 'vendedor', E1), V('dan', 'Dan Velastiqui', 'vendedor', E1), V('ant', 'Antonio Fernández', 'vendedor', E1),
  V('jor', 'Jorge Lezcano', 'supervisor', E1),
  V('hug', 'Hugo Jara', 'vendedor', E2), V('noe', 'Noelia Villalba', 'vendedor', E2, 'medica'), V('ser', 'Sergio Divano', 'admin', E2),
]
const yo = vendedores.find((v) => v.id === P)
const EMP = yo.empresa_id
const perfil = { ...yo, empresa: EMP === E1 ? 'Camping 44' : 'Vitalica', multi_empresa: false, equipo: EMP === E1 ? 'Mayorista' : null }
const deEmpresa = (id) => vendedores.find((v) => v.id === id)?.empresa_id === EMP

// ── Clientes (ventas) ──
const C = [
  ['c1', 'Ferretería San Roque', 'Asunción', 'Av. Eusebio Ayala 1450', -25.2995, -57.6110, 'activo', 'hum'],
  ['c2', 'Comercial El Sol', 'Asunción', 'Mcal. López 3020', -25.2930, -57.5930, 'activo', 'hum'],
  ['c3', 'Distribuidora Luque', 'Luque', 'Av. Gral. Aquino 820', -25.2680, -57.4870, 'inactivo', 'hum'],
  ['c4', 'Autoservice La Familia', 'San Lorenzo', 'Ruta Mcal. Estigarribia km 11', -25.3400, -57.5080, 'potencial', 'hum'],
  ['c5', 'Pinturería Central', 'Asunción', 'Brasil 1220', -25.2905, -57.6280, 'activo', 'hum'],
  ['c6', 'Supermercado Don Pedro', 'Fernando de la Mora', 'Av. Mcal. López 5600', -25.3200, -57.5600, 'no_interesado', 'hum'],
  ['c7', 'Bazar La Esquina', 'Asunción', 'Colón 940', -25.2850, -57.6400, 'activo', 'dan'],
  ['c8', 'Almacén Santa Rita', 'Lambaré', 'Av. Cacique Lambaré 2100', -25.3450, -57.6200, 'inactivo', 'dan'],
  ['c9', 'Ferrecentro Capiatá', 'Capiatá', 'Ruta 2 km 20', -25.3550, -57.4450, 'activo', 'ant'],
  ['c10', 'Comercial Ñemby', 'Ñemby', 'Av. Defensores 450', -25.3950, -57.5400, 'potencial', 'ant'],
  ['c11', 'Farmacia Vida', 'Asunción', 'España 1890', -25.2880, -57.6010, 'activo', 'hug'],
  ['c12', 'Farmacia Central Luque', 'Luque', 'Gral. Elizardo Aquino 300', -25.2700, -57.4900, 'activo', 'hug'],
]
const clientes = C.map(([id, rs, ciudad, dir, lat, lng, estado, vend], i) => ({
  id, razon_social: rs, ciudad, direccion: dir, lat, lng, estado, vendedor_id: vend, categoria: 'cliente', empresa_id: null, tipo_lugar: null,
  telefono: '0981 555 1' + String(i).padStart(2, '0'), telefono_norm: '595981555' + String(100 + i), ruc: `8001${i}234-5`, notas: null,
  zona_id: ['Luque', 'San Lorenzo', 'Capiatá'].includes(ciudad) ? 'z2' : 'z1', odoo_partner_id: 1000 + i, origen_ubicacion: i % 3 ? 'odoo' : 'gps_visita',
  ultima_visita: i % 4 === 3 ? null : h('10:15', sumar(hoy, -(i * 6 + 3))), ultima_factura_fecha: estado === 'activo' ? sumar(hoy, -(i * 9 + 5)) : null,
  ventas_6m_gs: estado === 'activo' ? 2500000 + i * 750000 : 0, facturas_6m: estado === 'activo' ? 3 + i : 0, activo: true, cliente_padre_id: null,
  lat_odoo: lat, lng_odoo: lng,
}))
// ── Lugares y médicos (visita médica) ──
const L = [['l1', 'Sanatorio San Sebastián', 'Sanatorio', 'Av. Eusebio Ayala 2850', -25.3010, -57.5960], ['l2', 'Hospital de Clínicas', 'Hospital', 'Dr. Montero y Lagerenza', -25.2870, -57.6350], ['l3', 'Centro Médico La Costa', 'Clínica', 'Av. Artigas 1500', -25.2780, -57.6050], ['l4', 'Consultorio Dr. Benítez', 'Consultorio', 'Brasilia 1240', null, null]]
const lugares = L.map(([id, rs, tipo, dir, lat, lng], i) => ({ id, razon_social: rs, tipo_lugar: tipo, direccion: dir, ciudad: 'Asunción', lat, lng, categoria: 'lugar', empresa_id: E2, vendedor_id: 'noe', estado: 'potencial', telefono: null, telefono_norm: null, ruc: null, notas: i === 0 ? 'Visitadores por recepción del 2do piso' : null, ultima_visita: i < 2 ? h('11:10') : null, ultima_factura_fecha: null, ventas_6m_gs: 0, activo: true, zona_id: null }))
const lnom = (id) => L.find((x) => x[0] === id)[1]
const M = [
  ['m1', 'Dr. Ramón Pérez', 'Traumatología', [['l1', 'Lunes a Viernes 07:00 Hs a 17:00 Hs.']], h('09:35'), 30],
  ['m2', 'Dra. Laura Giménez', 'Pediatría', [['l1', 'Martes y Jueves 17:00 Hs.']], h('10:00', sumar(hoy, -12)), 30],
  ['m3', 'Dr. Carlos Ortiz', 'Clínica médica', [['l2', 'Lunes, Miércoles y Viernes de 14:00 a 18:00 Hs.'], ['l3', 'Martes, 10:00 Hs.']], h('11:10'), 15],
  ['m4', 'Dra. Ana Benítez', 'Clínica Medica', [['l4', 'Miércoles y Viernes 15:00 a 18:00 Hs.']], null, 30],
  ['m5', 'Dr. Luis Acosta', 'Endocrinología', [['l3', 'Jueves 06:30 Hs. a 12:30 Hs.']], h('10:00', sumar(hoy, -1)), 30],
  ['m6', 'Dra. Sofía Duarte', 'Gastroenterología', [['l2', null]], h('09:00', sumar(hoy, -54)), 30],
]
const medicos = M.map(([id, nombre, esp, ls, uv, f]) => ({ id, nombre, especialidad: esp, telefono: id === 'm1' ? '0981 555 123' : null, telefono_norm: id === 'm1' ? '595981555123' : null, email: null, notas: id === 'm2' ? 'Prefiere visitas después de las 17' : null, frecuencia_dias: f, visitadora_id: 'noe', creado_por: 'noe', activo: true, empresa_id: E2, created_at: '2026-11-01', updated_at: '2026-11-01', ultima_visita: uv, lugares: ls.map(([lid, hor]) => ({ lugar_id: lid, nombre: lnom(lid), horario: hor })) }))
const med = (id) => { const m = medicos.find((x) => x.id === id); return { nombre: m.nombre, especialidad: m.especialidad } }
const resultados = [
  ...['Pedido', 'Cotización', 'Volver otro día', 'Cobranza', 'Cerrado', 'Cliente nuevo', 'No le interesa'].map((n, i) => ({ id: i + 1, nombre: n, es_venta: n === 'Pedido', orden: i + 1, tipo: 'ventas', activo: true })),
  ...['Presentó productos', 'Dejó muestras', 'Pidió volver otro día', 'No atendió', 'Sin acceso'].map((n, i) => ({ id: 20 + i, nombre: n, es_venta: false, orden: i + 1, tipo: 'medica', activo: true })),
]
const productos = ['Artrodol 50 mg', 'Gastrovit', 'Pedifer gotas', 'Vitalcal D', 'Omegavit 1000'].map((n, i) => ({ id: i + 1, nombre: n, codigo: null, activo: true, orden: i + 1, empresa_id: E2 }))
// ── Visitas ──
const vis = (id, vend, cli, hhmm, dia, extra = {}) => ({ id, vendedor_id: vend, cliente_id: cli, fecha_hora: h(hhmm, dia), lat: null, lng: null, hizo_pedido: false, ruta_parada_id: 'p', origen: 'app', productos: null, observaciones: null, proxima_visita: null, medico_id: null, ...extra })
const visitas = [
  vis('vh1', 'hum', 'c1', '08:45', hoy, { hizo_pedido: true, lat: -25.2996, lng: -57.6108, observaciones: 'Pidió 2 cajas de linternas y 10 conservadoras.', resultado: { nombre: 'Pedido' }, cliente: { razon_social: 'Ferretería San Roque', ciudad: 'Asunción' }, zona: { nombre: 'Asunción Centro' } }),
  vis('vh2', 'hum', 'c2', '09:40', hoy, { lat: -25.2931, lng: -57.5932, observaciones: 'Quiere cotización de carpas para enero.', resultado: { nombre: 'Cotización' }, cliente: { razon_social: 'Comercial El Sol', ciudad: 'Asunción' }, zona: { nombre: 'Asunción Centro' } }),
  vis('vn1', 'noe', 'l1', '09:35', hoy, { medico_id: 'm1', observaciones: 'Pidió más muestras del antiinflamatorio para la semana que viene.', productos: [{ producto: 'Artrodol 50 mg', muestras: 4 }, { producto: 'Vitalcal D', muestras: 0 }], resultado: { nombre: 'Presentó productos' }, lugar: { razon_social: lnom('l1') }, medico: med('m1'), cliente: { razon_social: lnom('l1') } }),
  vis('vn2', 'noe', 'l2', '11:10', hoy, { medico_id: 'm3', productos: [{ producto: 'Gastrovit', muestras: 6 }], resultado: { nombre: 'Dejó muestras' }, lugar: { razon_social: lnom('l2') }, medico: med('m3'), cliente: { razon_social: lnom('l2') } }),
]
const llegadas = [
  { id: 'a1', vendedor_id: 'noe', lugar_id: 'l1', fecha_hora: h('09:10'), created_at: h('09:10'), lat: -25.3010, lng: -57.5960, lugar: { razon_social: lnom('l1') } },
  { id: 'a2', vendedor_id: 'noe', lugar_id: 'l2', fecha_hora: h('10:52'), created_at: h('10:52'), lat: -25.2870, lng: -57.6350, lugar: { razon_social: lnom('l2') } },
]
// ── Paradas del día ──
const parada = (id, c, orden, visitada, extra = {}) => ({ parada_id: id, ruta_id: 'r1', ruta_nombre: 'Asunción Centro – Sem', orden, cliente_id: c.id, razon_social: c.razon_social, telefono: c.telefono, telefono_norm: c.telefono_norm, direccion: c.direccion, ciudad: c.ciudad, lat: c.lat, lng: c.lng, estado: c.estado, ultima_visita: c.ultima_visita, ultimo_resultado: null, ultima_observacion: null, visitada, ...extra })
const cli = (id) => clientes.find((c) => c.id === id) ?? lugares.find((c) => c.id === id)
const paradasDe = {
  hum: [parada('p1', cli('c1'), 1, true), parada('p2', cli('c2'), 2, true), parada('p3', cli('c5'), 3, false, { ultimo_resultado: 'Volver otro día', ultima_observacion: 'El encargado vuelve el martes.' }), parada('p4', cli('c3'), 4, false), parada('p5', cli('c4'), 5, false), parada('p6', cli('c6'), 6, false)],
  noe: [parada('q1', cli('l1'), 1, true), parada('q2', cli('l2'), 2, true), parada('q3', cli('l3'), 3, false)],
  hug: [parada('u1', cli('c11'), 1, false), parada('u2', cli('c12'), 2, false)],
  dan: [parada('d1', cli('c7'), 1, true), parada('d2', cli('c8'), 2, false)], ant: [parada('t1', cli('c9'), 1, false)],
}
// ── Tablero ──
const tablero = []
for (const v of vendedores.filter((x) => x.rol === 'vendedor' && x.empresa_id === EMP)) for (let i = 0; i < 6; i++) {
  const d = sumar(lunes, i); if (d > hoy) continue
  const base = { hum: [8, 7, 9, 6, 2], dan: [6, 5, 8, 7, 1], ant: [9, 8, 4, 8, 0], hug: [5, 6, 4, 7, 2], noe: [6, 7, 5, 8, 2] }[v.id] ?? [5, 5, 5, 5, 5]
  const r = d === hoy ? (v.id === 'hum' ? 2 : v.id === 'noe' ? 2 : 1) : base[i] ?? 6
  tablero.push({ vendedor_id: v.id, vendedor: v.nombre, meta_diaria: 8, meta_semanal: 40, dia: d, planificadas: 8, realizadas: r, en_ruta: r - 1, fuera_de_ruta: r ? 1 : 0, con_pedido: Math.floor(r / 3) })
}
const reporte = vendedores.filter((x) => x.rol === 'vendedor' && x.empresa_id === EMP).map((v, i) => ({ vendedor_id: v.id, vendedor: v.nombre, meta_diaria: 8, meta_semanal: 40, dias_con_jornada: 5, horas_jornada: 38.5 - i * 3, km: 186.4 - i * 22, visitas: 32 - i * 4, dias_con_visitas: 5, clientes_distintos: 28 - i * 3, con_pedido: 11 - i * 2, cobranzas: 4, cobrado_gs: 6800000 - i * 1200000, fuera_de_ruta: 3 + i, planificadas: 40, paradas_visitadas: 29 - i * 4, prospectos_nuevos: 2, inactivos_visitados: 3, primera_visita_prom: '08:12', ultima_visita_prom: '16:40' }))
const detalle = [
  { tipo: 'visita', dia: hoy, fecha_hora: h('08:45'), cliente_id: 'c1', razon_social: 'Ferretería San Roque', ciudad: 'Asunción', estado: 'activo', resultado: 'Pedido', observaciones: 'Pidió 2 cajas de linternas y 10 conservadoras.', motivo_no_interesa: null, en_ruta: true, ultima_anterior: h('10:00', sumar(hoy, -15)), zona: 'Asunción Centro' },
  { tipo: 'visita', dia: hoy, fecha_hora: h('09:40'), cliente_id: 'c2', razon_social: 'Comercial El Sol', ciudad: 'Asunción', estado: 'activo', resultado: 'Cotización', observaciones: 'Quiere cotización de carpas para enero.', motivo_no_interesa: null, en_ruta: true, ultima_anterior: h('10:00', sumar(hoy, -22)), zona: 'Asunción Centro' },
  { tipo: 'ruta', dia: hoy, fecha_hora: null, cliente_id: 'c5', razon_social: 'Pinturería Central', ciudad: 'Asunción', estado: 'activo', resultado: null, observaciones: null, motivo_no_interesa: null, en_ruta: true, ultima_anterior: h('10:00', sumar(hoy, -30)), zona: 'Asunción Centro' },
  { tipo: 'zona', dia: null, fecha_hora: null, cliente_id: 'c6', razon_social: 'Supermercado Don Pedro', ciudad: 'Fernando de la Mora', estado: 'no_interesado', resultado: null, observaciones: null, motivo_no_interesa: null, en_ruta: false, ultima_anterior: h('10:00', sumar(hoy, -40)), zona: 'Asunción Centro' },
]
// ── Rutas y zonas ──
const zonas = [
  { id: 'z1', nombre: 'Asunción Centro', color: '#2563eb', ciudades: ['Asunción', 'Fernando de la Mora'], ciudades_alias: [], semanas_mes: [1, 3], vendedor_id: 'hum', responsable: 'Humberto', frecuencia: 'Quincenal', activo: true, empresa_id: E1, equipo_id: 'eq1', created_at: '2026-10-01', poligono: null, clientes: [{ count: 6 }] },
  { id: 'z2', nombre: 'Central Este', color: '#16a34a', ciudades: ['Luque', 'San Lorenzo', 'Capiatá'], ciudades_alias: ['SLO'], semanas_mes: [2, 4], vendedor_id: 'ant', responsable: 'Antonio', frecuencia: 'Quincenal', activo: true, empresa_id: E1, equipo_id: 'eq1', created_at: '2026-10-01', poligono: null, clientes: [{ count: 4 }] },
  { id: 'z3', nombre: 'Central Sur', color: '#d97706', ciudades: ['Lambaré', 'Ñemby'], ciudades_alias: [], semanas_mes: [1, 2, 3, 4], vendedor_id: 'dan', responsable: 'Dan', frecuencia: 'Semanal', activo: true, empresa_id: E1, equipo_id: 'eq1', created_at: '2026-10-01', poligono: null, clientes: [{ count: 2 }] },
]
const rutas = [
  { id: 'r1', nombre: `Asunción Centro – Sem ${hoy}`, estado: 'publicada', vendedor_id: 'hum', zona_id: 'z1', semana_inicio: lunes, notas: null, creado_por: 'jor', created_at: lunes, paradas: [{ count: 24 }] },
  { id: 'r2', nombre: 'Central Sur – Sem', estado: 'publicada', vendedor_id: 'dan', zona_id: 'z3', semana_inicio: lunes, notas: null, creado_por: 'jor', created_at: lunes, paradas: [{ count: 18 }] },
  { id: 'r3', nombre: 'Central Este – Sem', estado: 'borrador', vendedor_id: 'ant', zona_id: 'z2', semana_inicio: lunes, notas: null, creado_por: 'jor', created_at: lunes, paradas: [{ count: 9 }] },
  { id: 'r4', nombre: 'Farmacias Asunción', estado: 'publicada', vendedor_id: 'hug', zona_id: null, semana_inicio: lunes, notas: null, creado_por: 'ser', created_at: lunes, paradas: [{ count: 10 }] },
]
const rutaParadas = ['c1', 'c2', 'c5', 'c3', 'c4', 'c6'].map((c, i) => ({ id: `rp${i}`, ruta_id: 'r1', cliente_id: c, dia: i < 4 ? hoy : sumar(hoy, 1), orden: (i % 4) + 1 }))
// ── En vivo y recorrido ──
const posActual = [
  { vendedor_id: 'hum', lat: -25.2925, lng: -57.6140, fecha_hora: new Date(Date.now() - 2 * 60000).toISOString(), en_jornada: true, bateria_pct: 72, jornada_id: 'j1', precision_m: 8 },
  { vendedor_id: 'dan', lat: -25.3400, lng: -57.6180, fecha_hora: new Date(Date.now() - 9 * 60000).toISOString(), en_jornada: true, bateria_pct: 48, jornada_id: 'j2', precision_m: 12 },
  { vendedor_id: 'hug', lat: -25.2860, lng: -57.6000, fecha_hora: new Date(Date.now() - 3 * 60000).toISOString(), en_jornada: true, bateria_pct: 80, jornada_id: 'j4', precision_m: 10 },
  { vendedor_id: 'noe', lat: -25.2872, lng: -57.6348, fecha_hora: new Date(Date.now() - 1 * 60000).toISOString(), en_jornada: true, bateria_pct: 65, jornada_id: 'j5', precision_m: 7 },
]
const recorrido = []
{ // Humberto: base → c1 → c2 → (hueco sin GPS) → posición actual
  const pts = [[-25.3060, -57.6200], [-25.3030, -57.6160], [-25.3000, -57.6115], [-25.2996, -57.6108], [-25.2996, -57.6108], [-25.2980, -57.6050], [-25.2955, -57.5990], [-25.2931, -57.5932], [-25.2931, -57.5932], [-25.2940, -57.6010], [-25.2925, -57.6140]]
  const t0 = Date.parse(h('08:00'))
  const mins = [0, 10, 20, 30, 50, 65, 75, 85, 110, 170, 200]
  // Una lectura por minuto entre puntos (con jitter chico), salvo el hueco de 110 a 170 min (celular sin señal).
  for (let k = 0; k < pts.length - 1; k++) {
    const [a, b] = [pts[k], pts[k + 1]]; const [m0, m1] = [mins[k], mins[k + 1]]
    if (m0 === 110) { recorrido.push({ fecha_hora: new Date(t0 + m0 * 60000).toISOString(), lat: a[0], lng: a[1], precision_m: 10, bateria_pct: 60, velocidad_kmh: 0, origen: 'traccar', jornada_id: 'j1', vendedor_id: 'hum' }); continue }
    for (let m = m0; m < m1; m++) {
      const f = (m - m0) / (m1 - m0); const quieto = a[0] === b[0] && a[1] === b[1]
      recorrido.push({ fecha_hora: new Date(t0 + m * 60000).toISOString(), lat: a[0] + (b[0] - a[0]) * f + (quieto ? 0 : Math.sin(m) * 0.0002), lng: a[1] + (b[1] - a[1]) * f + (quieto ? 0 : Math.cos(m) * 0.0002), precision_m: 10, bateria_pct: 92 - Math.floor(m / 6), velocidad_kmh: quieto ? 0 : 28, origen: m === 0 ? 'inicio' : 'traccar', jornada_id: 'j1', vendedor_id: 'hum' })
    }
  }
  recorrido.push({ fecha_hora: new Date(t0 + 200 * 60000).toISOString(), lat: pts.at(-1)[0], lng: pts.at(-1)[1], precision_m: 10, bateria_pct: 58, velocidad_kmh: 0, origen: 'traccar', jornada_id: 'j1', vendedor_id: 'hum' })
}
const jornadas = [
  { id: 'j1', vendedor_id: 'hum', inicio: h('08:00'), fin: null, km_actual: 14.2, km_recorridos: null, cierre_auto: false, inicio_lat: null, inicio_lng: null },
  { id: 'j4', vendedor_id: 'hug', inicio: h('08:00'), fin: null, km_actual: 12.6, km_recorridos: null, cierre_auto: false, inicio_lat: null, inicio_lng: null },
  { id: 'j5', vendedor_id: 'noe', inicio: h('08:20'), fin: null, km_actual: 9.8, km_recorridos: null, cierre_auto: false, inicio_lat: null, inicio_lng: null },
]
const misVisitas = [
  { id: 'vh1', fecha_hora: h('08:45'), cliente_id: 'c1', razon_social: 'Ferretería San Roque', ciudad: 'Asunción', telefono: '0981 555 100', telefono_norm: '595981555100', resultado: 'Pedido', es_venta: true, hizo_pedido: true, hizo_cobranza: false, monto_cobrado_gs: null, observaciones: 'Pidió 2 cajas de linternas y 10 conservadoras.', proxima_visita: null, en_ruta: true, distancia_cliente_m: 12 },
  { id: 'vh2', fecha_hora: h('09:40'), cliente_id: 'c2', razon_social: 'Comercial El Sol', ciudad: 'Asunción', telefono: '0981 555 101', telefono_norm: '595981555101', resultado: 'Cotización', es_venta: false, hizo_pedido: false, hizo_cobranza: true, monto_cobrado_gs: 1500000, observaciones: 'Quiere cotización de carpas para enero.', proxima_visita: sumar(hoy, 7), en_ruta: true, distancia_cliente_m: 20 },
  { id: 'vh3', fecha_hora: h('15:20', sumar(hoy, -1)), cliente_id: 'c5', razon_social: 'Pinturería Central', ciudad: 'Asunción', telefono: '0981 555 104', telefono_norm: '595981555104', resultado: 'Volver otro día', es_venta: false, hizo_pedido: false, hizo_cobranza: false, monto_cobrado_gs: null, observaciones: 'El encargado vuelve el martes.', proxima_visita: sumar(hoy, 2), en_ruta: true, distancia_cliente_m: 8 },
]
const proximas = [{ cliente_id: 'c3', razon_social: 'Distribuidora Luque', ciudad: 'Luque', direccion: 'Av. Gral. Aquino 820', telefono: '0981 555 102', telefono_norm: '595981555102', lat: -25.2680, lng: -57.4870, estado: 'inactivo', zona_id: 'z2', vendedor_id: 'hum', proxima_visita: sumar(hoy, -2), ultima_visita: h('10:00', sumar(hoy, -16)), ultima_observacion: 'Pidió que vuelva con la lista de precios nueva.', dias_vencida: 2 }]
const alertas = [{ id: 1, cliente_id: 'c4', vendedor_id: 'hum', zona_id: 'z2', dueno_zona_id: 'ant', vecinos: [{ cliente_id: 'c9', razon_social: 'Ferrecentro Capiatá', vendedor_id: 'ant', vendedor: 'Antonio Fernández', distancia_m: 180 }], creada_el: h('11:30', sumar(hoy, -1)), revisada_el: null, revisada_por: null, decision: null }]
const ruteo = [
  ...[['q1', 'l1', 'm1', 1], ['q1', 'l1', 'm2', 1], ['q2', 'l2', 'm3', 2], ['q3', 'l3', 'm5', 3]].map(([pid, lid, mid, orden], i) => {
    const m = medicos.find((x) => x.id === mid); const l = lugares.find((x) => x.id === lid); const v = visitas.find((x) => x.medico_id === mid)
    return { dia: hoy, orden, parada_id: pid, lugar_id: lid, lugar: l.razon_social, tipo_lugar: l.tipo_lugar, direccion: l.direccion, notas: l.notas, lat: l.lat, lng: l.lng, objetivo_id: `o${i}`, medico_id: mid, medico: m.nombre, especialidad: m.especialidad, visita_id: v?.id ?? null, fecha_hora: v?.fecha_hora ?? null, resultado: v?.resultado?.nombre ?? null, medico_visitado: v ? m.nombre : null, observaciones: v?.observaciones ?? null, proxima_visita: null, productos: v?.productos ?? null, llegada: llegadas.find((x) => x.lugar_id === lid)?.fecha_hora ?? null, llegadas: llegadas.filter((x) => x.lugar_id === lid).map((x) => x.fecha_hora) }
  }),
  { dia: sumar(hoy, 1), orden: 1, parada_id: 'q4', lugar_id: 'l4', lugar: lnom('l4'), tipo_lugar: 'Consultorio', direccion: 'Brasilia 1240', notas: null, lat: null, lng: null, objetivo_id: 'o9', medico_id: 'm4', medico: 'Dra. Ana Benítez', especialidad: 'Clínica médica', visita_id: null, fecha_hora: null, resultado: null, medico_visitado: null, observaciones: null, proxima_visita: null, productos: null, llegada: null, llegadas: null },
]
const tablas = {
  vis_vendedores: vendedores.filter((v) => v.empresa_id === EMP),
  vis_empresas: [{ id: E1, nombre: 'Camping 44' }, { id: E2, nombre: 'Vitalica' }].filter((e) => e.id === EMP),
  vis_equipos: EMP === E1 ? [{ id: 'eq1', empresa_id: E1, nombre: 'Mayorista' }] : [],
  vis_clientes_v: [...clientes, ...(EMP === E2 ? lugares : [])], vis_clientes: [...clientes, ...lugares],
  vis_medicos_v: EMP === E2 ? medicos : [], vis_resultados: resultados, vis_productos: EMP === E2 ? productos : [],
  vis_visitas: visitas.filter((v) => deEmpresa(v.vendedor_id)), vis_llegadas: llegadas, vis_jornadas: JORNADA || ['jor', 'ser'].includes(P) ? jornadas : [],
  vis_zonas: EMP === E1 ? zonas : [], vis_rutas: rutas.filter((r) => deEmpresa(r.vendedor_id)), vis_ruta_paradas: rutaParadas,
  vis_posicion_actual: posActual.filter((p) => deEmpresa(p.vendedor_id)), vis_posiciones: [...recorrido, ...recorrido.map((r) => ({ ...r, vendedor_id: 'hug', lat: r.lat + 0.004, lng: r.lng + 0.012 }))],
  vis_alertas_alta: EMP === E1 ? alertas : [], vis_sync_log: [], vis_parada_objetivos: [], vis_medico_lugares: [],
  vis_gps_dispositivos: [{ vendedor_id: 'hum', ultima_recibida_el: new Date(Date.now() - 3 * 60000).toISOString() }, { vendedor_id: 'noe', ultima_recibida_el: new Date(Date.now() - 60000).toISOString() }, { vendedor_id: 'dan', ultima_recibida_el: null }],
  vis_config: [{ id: true, base_lat: -25.3060, base_lng: -57.6200 }],
}
const RPC = {
  vis_vincular_usuario: () => perfil, vis_mi_id: () => P, vis_es_admin: () => perfil.rol === 'admin', vis_mi_empresa: () => EMP, vis_soy_admin_multi: () => false, vis_mi_equipo: () => (EMP === E1 && perfil.rol !== 'admin' ? 'eq1' : null),
  vis_paradas_dia: (a) => paradasDe[a.p_vendedor ?? P] ?? [], vis_tablero: () => (perfil.rol === 'vendedor' ? tablero.filter((f) => f.vendedor_id === P) : tablero), vis_proximas_visitas: () => (P === 'hum' ? proximas : []),
  vis_reporte_vendedores: () => reporte, vis_reporte_resultados: () => [{ resultado: 'Pedido', es_venta: true, visitas: 41 }, { resultado: 'Cotización', es_venta: false, visitas: 23 }, { resultado: 'Volver otro día', es_venta: false, visitas: 18 }, { resultado: 'No le interesa', es_venta: false, visitas: 5 }],
  vis_reporte_zonas: () => zonas.map((z, i) => ({ zona_id: z.id, zona: z.nombre, color: z.color, responsable: z.responsable, clientes: 60 - i * 15, activos: 38 - i * 9, inactivos: 22 - i * 6, visitados: 30 - i * 7, visitas: 44 - i * 10, con_pedido: 16 - i * 4, sin_visita_60d: 9 + i })),
  vis_clientes_sin_visita: () => clientes.slice(2, 6).map((c) => ({ id: c.id, razon_social: c.razon_social, ciudad: c.ciudad, zona: 'Asunción Centro', vendedor: 'Humberto Benítez', estado: c.estado, ultima_visita: c.ultima_visita, ultima_factura_fecha: c.ultima_factura_fecha, ventas_6m_gs: c.ventas_6m_gs })),
  vis_tablero_detalle: () => detalle, vis_mis_visitas: () => misVisitas, vis_ruteo_semana: () => ruteo,
  vis_para_ver_como: () => vendedores.filter((v) => v.empresa_id === EMP && v.rol === 'vendedor').map((v) => ({ id: v.id, nombre: v.nombre, tipo: v.tipo, empresa_id: EMP, empresa: perfil.empresa, equipo: EMP === E1 ? 'Mayorista' : null })),
  vis_mi_gps: () => ({ codigo: 'c44a7f3e91b20d4c', ultima_recibida_el: new Date(Date.now() - 2 * 60000).toISOString(), ultima_posicion_el: new Date(Date.now() - 2 * 60000).toISOString() }),
  vis_vecinos_de_otros: () => [], vis_clientes_cercanos: () => [], vis_zona_historial: () => [], vis_sugerir_paradas: () => [],
  vis_marcar_llegada: () => ({ id: 'a9', parada_id: 'q3' }), vis_iniciar_jornada: () => ({ id: 'j1', inicio: new Date().toISOString() }),
}
createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*'); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', '*'); res.setHeader('Access-Control-Expose-Headers', 'content-range')
  if (req.method === 'OPTIONS') return res.end()
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const json = (o, s = 200, hd = {}) => { res.writeHead(s, { 'Content-Type': 'application/json', ...hd }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(o)) }
    const p = url.pathname
    if (p === '/auth/v1/user') return json({ id: 'u1', aud: 'authenticated', role: 'authenticated', email: perfil.email, app_metadata: {}, user_metadata: {} })
    if (p.startsWith('/auth/v1/')) return json({})
    if (p.startsWith('/rest/v1/rpc/')) { const f = RPC[p.slice(13)]; let a = {}; try { a = JSON.parse(body || '{}') } catch {} ; return json(f ? f(a) : []) }
    const tabla = p.slice(9)
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(req.method === 'POST' ? [{ id: 'nuevo' }] : [], 201)
    let filas = tablas[tabla] ?? []
    for (const [k, v] of url.searchParams) {
      if (!filas.length || !(k in filas[0])) continue
      if (v.startsWith('eq.')) filas = filas.filter((r) => String(r[k]) === v.slice(3))
      else if (v.startsWith('gte.')) filas = filas.filter((r) => r[k] != null && new Date(r[k]) >= new Date(v.slice(4)))
      else if (v.startsWith('lt.')) filas = filas.filter((r) => r[k] != null && new Date(r[k]) < new Date(v.slice(3)))
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); filas = filas.filter((r) => set.includes(String(r[k]))) }
      else if (v === 'is.null') filas = filas.filter((r) => r[k] == null)
    }
    const uno = (req.headers.accept || '').includes('vnd.pgrst.object')
    return json(uno ? (filas[0] ?? null) : filas, 200, { 'content-range': `0-${Math.max(0, filas.length - 1)}/${filas.length}` })
  })
}).listen(54321, '127.0.0.1', () => console.log('mock', P))
