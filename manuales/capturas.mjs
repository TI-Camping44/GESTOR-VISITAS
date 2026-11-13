// Capturas para los manuales: levanta el simulador con cada perfil y saca las pantallas.
// Uso: node capturas.mjs <grupo>   (grupos: vend-c44, vend-vit, medica, panel-c44, panel-vit)
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const DIR = new URL('.', import.meta.url).pathname
const B = 'http://127.0.0.1:3100'
const grupo = process.argv[2]
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date())
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(`${DIR}salida/shots`, { recursive: true })

async function conMock(perfil, jornada, fn) {
  const m = spawn('node', [`${DIR}mock.mjs`], { env: { ...process.env, PERFIL: perfil, ...(jornada ? { JORNADA: '1' } : {}) }, stdio: 'ignore' })
  await espera(700)
  try { await fn() } finally { m.kill(); await espera(300) }
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 86400 * 400
const tok = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp })}.firma`
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--lang=es-PY'] })
const errores = []
async function contexto(movil, { sesion = true, oscuro = false } = {}) {
  const c = await browser.newContext(movil
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-PY', timezoneId: 'America/Asuncion', colorScheme: oscuro ? 'dark' : 'light', geolocation: { latitude: -25.2905, longitude: -57.6278, accuracy: 9 }, permissions: ['geolocation'] }
    : { viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, locale: 'es-PY', timezoneId: 'America/Asuncion', colorScheme: 'light' })
  if (sesion) await c.addCookies([{ name: 'sb-127-auth-token', domain: '127.0.0.1', path: '/', value: 'base64-' + b64({ access_token: tok, token_type: 'bearer', expires_in: 86400, expires_at: exp, refresh_token: 'r', user: { id: 'u1' } }) }])
  const p = await c.newPage()
  await p.clock.setFixedTime(new Date(`${hoy}T16:30:00-03:00`))
  p.on('pageerror', (e) => errores.push(`${p.url()}: ${e.message}`))
  return p
}
async function foto(p, nombre, { completa = false } = {}) {
  // La dirección del simulador se muestra como la de producción.
  await p.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.nodeValue.includes('127.0.0.1:3100')) n.nodeValue = n.nodeValue.replaceAll('http://127.0.0.1:3100', 'https://gestion-visitas-eight.vercel.app') }).catch(() => {})
  await p.screenshot({ path: `${DIR}salida/shots/${nombre}.png`, fullPage: completa })
  console.log('·', nombre)
}
const ir = async (p, ruta, ms = 2600) => { await p.goto(B + ruta); await espera(ms) }

async function vendedor(pref, perfil) {
  await conMock(perfil, false, async () => {
    const p = await contexto(true, { sesion: false })
    await ir(p, '/login', 1500); await foto(p, `${pref}-login`)
    const q = await contexto(true)
    await ir(q, '/hoy'); await foto(q, `${pref}-sin-jornada`)
  })
  await conMock(perfil, true, async () => {
    const p = await contexto(true)
    await ir(p, '/hoy', 3500); await foto(p, `${pref}-hoy`); await foto(p, `${pref}-hoy-completa`, { completa: true })
    await p.getByLabel(/Buscar|cliente/i).first().fill('pint').catch(() => {}); await espera(900); await foto(p, `${pref}-buscar`)
    const c = perfil === 'hum' ? 'c5' : 'c11'
    await ir(p, `/visita?c=${c}&parada=p3`, 3200); await foto(p, `${pref}-visita`)
    await p.selectOption('#resultado', { label: 'Pedido' }).catch(() => {}); await espera(400)
    await p.getByRole('button', { name: 'Guardar visita' }).scrollIntoViewIfNeeded(); await espera(300); await foto(p, `${pref}-visita-abajo`)
    await ir(p, `/visita?c=${c}`, 3000); await p.getByRole('button', { name: 'Guardar visita' }).click(); await espera(700); await foto(p, `${pref}-visita-error`)
    await ir(p, '/prospecto/nuevo', 3000); await foto(p, `${pref}-nuevo-cliente`)
    await ir(p, '/mapa', 3000); await foto(p, `${pref}-clientes`)
    await ir(p, '/mapa?vista=mapa', 6000); await foto(p, `${pref}-clientes-mapa`)
    await ir(p, '/visitas', 3000); await foto(p, `${pref}-mis-visitas`)
    await ir(p, '/gps', 2500); await foto(p, `${pref}-gps`); await foto(p, `${pref}-gps-completa`, { completa: true })
    const o = await contexto(true, { oscuro: true }); await ir(o, '/hoy', 3500); await foto(o, `${pref}-hoy-oscuro`)
  })
}

async function medica() {
  await conMock('noe', true, async () => {
    const p = await contexto(true)
    await p.context().setGeolocation({ latitude: -25.3011, longitude: -57.5961, accuracy: 9 })
    await ir(p, '/hoy', 3500); await foto(p, 'm-hoy'); await foto(p, 'm-hoy-completa', { completa: true })
    await ir(p, '/lugar?c=l3&parada=q3', 3200); await foto(p, 'm-lugar-llegar')
    await ir(p, '/lugar?c=l1&parada=q1', 3200); await foto(p, 'm-lugar-llego')
    await p.getByRole('button', { name: 'Ya lo tengo cargado' }).click().catch(() => {}); await espera(500); await foto(p, 'm-ya-cargado')
    await ir(p, '/visita?c=l1&m=m2', 3200); await foto(p, 'm-visita')
    await p.selectOption('#resultado', { label: 'Presentó productos' }).catch(() => {}); await espera(300)
    await p.getByRole('checkbox', { name: 'Pedifer gotas' }).check().catch(() => {}); await p.getByLabel('Muestras de Pedifer gotas').fill('3').catch(() => {})
    await p.getByRole('checkbox', { name: 'Gastrovit' }).check().catch(() => {}); await espera(300)
    await p.getByText('Productos', { exact: false }).first().scrollIntoViewIfNeeded().catch(() => {}); await espera(300); await foto(p, 'm-visita-productos')
    await ir(p, '/medicos', 3000); await foto(p, 'm-medicos')
    await ir(p, '/medicos/nuevo?lugar=l1', 3000); await foto(p, 'm-medico-nuevo'); await foto(p, 'm-medico-nuevo-completa', { completa: true })
    await ir(p, '/lugar/nuevo', 3000); await foto(p, 'm-lugar-nuevo')
    await ir(p, '/mapa', 3000); await foto(p, 'm-lugares')
    await ir(p, '/visitas', 3000); await foto(p, 'm-mis-visitas')
  })
}

async function panelC44() {
  await conMock('jor', false, async () => {
    const p = await contexto(false)
    await ir(p, '/tablero', 3500); await foto(p, 's-tablero')
    await p.locator('tbody button').first().click().catch(() => {}); await espera(1500)
    await p.getByText('Visitados (').first().scrollIntoViewIfNeeded().catch(() => {}); await espera(400); await foto(p, 's-tablero-detalle')
    await ir(p, '/reportes', 3500); await foto(p, 's-reportes')
    await ir(p, '/rutas', 3000); await foto(p, 's-rutas')
    await ir(p, '/rutas/r1', 6000); await foto(p, 's-ruta-planificador')
    await ir(p, '/en-vivo', 7000); await foto(p, 's-en-vivo')
    await p.getByText('Recorrido del día').first().scrollIntoViewIfNeeded().catch(() => {}); await espera(400)
    await p.getByLabel('Vendedor').selectOption({ label: 'Humberto Benítez' }).catch(() => {}); await espera(6000)
    await p.getByText('Recorrido del día').first().evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {}); await p.evaluate(() => window.scrollBy(0, -20)); await espera(800); await foto(p, 's-recorrido')
    await p.evaluate(() => window.scrollBy(0, 700)); await espera(500); await foto(p, 's-recorrido-detalle')
    await ir(p, '/clientes', 3500); await foto(p, 's-clientes')
    await p.getByRole('button', { name: 'Ferretería San Roque' }).click().catch(() => {}); await espera(3500); await foto(p, 's-cliente-detalle')
    await p.keyboard.press('Escape'); await espera(300)
    await p.locator('tbody input[type=checkbox]').nth(1).check().catch(() => {}); await p.locator('tbody input[type=checkbox]').nth(2).check().catch(() => {}); await espera(300)
    await p.getByLabel('Vendedor a asignar').selectOption({ label: 'Dan Velastiqui' }).catch(() => {}); await espera(300); await foto(p, 's-clientes-masivo')
    await ir(p, '/altas', 3500); await foto(p, 's-altas')
    await ir(p, '/zonas', 3000); await foto(p, 's-zonas')
    await ir(p, '/vendedores', 3000); await foto(p, 's-usuarios')
    await ir(p, '/ver-como', 2500); await foto(p, 's-ver-como')
  })
}

async function panelVit() {
  await conMock('ser', false, async () => {
    const p = await contexto(false)
    await ir(p, '/tablero', 3500); await foto(p, 't-tablero-ventas')
    await ir(p, '/medica', 3500); await foto(p, 't-actividad'); await foto(p, 't-actividad-completa', { completa: true })
    await ir(p, '/medica/medicos', 3000)
    await p.getByRole('button', { name: 'Martes', exact: true }).click(); await espera(400); await foto(p, 't-medicos-martes')
    await p.getByRole('button', { name: 'Martes', exact: true }).click(); await espera(300)
    await p.getByRole('button', { name: 'Dr. Ramón Pérez', exact: true }).click(); await espera(1500); await foto(p, 't-medico-historial')
    await ir(p, '/medica/lugares', 3000); await p.getByRole('button', { name: 'Sanatorio San Sebastián', exact: true }).click(); await espera(500); await foto(p, 't-lugares'); await foto(p, 't-lugares-completa', { completa: true })
    await ir(p, '/medica/especialidades', 3000); await foto(p, 't-especialidades')
    await ir(p, '/medica/ruteo', 3500); await foto(p, 't-ruteo'); await foto(p, 't-ruteo-completa', { completa: true })
    await ir(p, '/medica/en-vivo', 7000); await foto(p, 't-en-vivo')
    await ir(p, '/medica/productos', 3000); await foto(p, 't-productos')
    await ir(p, '/ver-como', 2500); await foto(p, 't-ver-como')
    await ir(p, '/reportes', 3500); await foto(p, 't-reportes')
    await ir(p, '/rutas', 3000); await foto(p, 't-rutas')
    await ir(p, '/clientes', 3500); await foto(p, 't-clientes')
    await ir(p, '/en-vivo', 7000); await foto(p, 't-en-vivo-ventas')
    await p.getByLabel('Vendedor').selectOption({ label: 'Hugo Jara' }).catch(() => {}); await espera(6000)
    await p.getByText('Recorrido del día').first().evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {}); await p.evaluate(() => window.scrollBy(0, -20)); await espera(800); await foto(p, 't-recorrido')
    await ir(p, '/vendedores', 3000); await foto(p, 't-usuarios')
  })
}

const grupos = { 'vend-c44': () => vendedor('v', 'hum'), 'vend-vit': () => vendedor('h', 'hug'), medica, 'panel-c44': panelC44, 'panel-vit': panelVit }
for (const g of grupo === 'todos' ? Object.keys(grupos) : [grupo]) await grupos[g]()
await browser.close()
if (errores.length) console.log('ERRORES:\n' + [...new Set(errores)].join('\n'))
