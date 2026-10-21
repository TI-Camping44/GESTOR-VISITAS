// Service worker de Visitas C44.
// - Estáticos de Next (/_next/static), íconos y MapLibre: caché primero (tienen hash, no cambian).
// - Páginas: red primero, pero con señal débil no se espera: a los 4 s se muestra la versión
//   guardada y la red sigue en segundo plano para dejarla al día. Sin nada guardado, /offline.
// - Datos de Next al cambiar de pantalla (RSC): si no responden a tiempo, error rápido y Next
//   abre la página completa, que sale de lo guardado.
// - Con señal, la app pide guardar sus pantallas y lo que necesitan para abrir ("precargar").
// - Supabase y tiles de mapas: no se tocan (los datos offline van por IndexedDB).
const VERSION = 'vis-v2'
const ESTATICOS = `${VERSION}-estaticos`
const PAGINAS = `${VERSION}-paginas`
const PRECARGA = ['/offline', '/icons/icon-192.png']
const ESPERA_RED_MS = 4000
const ESPERA_INICIO_MS = 2000 // "/" solo redirige: si tarda, directo a la pantalla de inicio guardada
const ESPERA_RSC_MS = 6000
const ESPERA_MAXIMA_MS = 25000

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(PAGINAS).then((c) => c.addAll(PRECARGA)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function conTiempo(promesa, ms) {
  return new Promise((ok, mal) => {
    const t = setTimeout(() => mal(new Error('sin respuesta')), ms)
    promesa.then((v) => { clearTimeout(t); ok(v) }, (e) => { clearTimeout(t); mal(e) })
  })
}

async function estatico(req) {
  const hit = await caches.match(req)
  if (hit) return hit
  const r = await fetch(req)
  if (r.ok) {
    const copia = r.clone()
    caches.open(ESTATICOS).then((c) => c.put(req, copia))
  }
  return r
}

// La página guardada: la misma dirección, o la misma pantalla con otros parámetros
// (/visita?c=otro-cliente usa la misma copia; el cliente sale de la dirección).
async function guardada(url) {
  const c = await caches.open(PAGINAS)
  return (await c.match(url.href)) || (await c.match(url.origin + url.pathname, { ignoreSearch: true }))
}

// "/" redirige según el rol; sin señal, a la pantalla de inicio que haya guardada.
async function inicioGuardado() {
  const c = await caches.open(PAGINAS)
  for (const p of ['/hoy', '/tablero']) {
    if (await c.match(new URL(p, self.location.origin).href, { ignoreSearch: true })) return Response.redirect(new URL(p, self.location.origin).href, 302)
  }
  return null
}

async function navegar(e) {
  const req = e.request
  const url = new URL(req.url)
  const red = fetch(req)
  // Se guarda aunque ya se haya mostrado la copia vieja: así la próxima vez abre al día.
  e.waitUntil(red.then((r) => {
    const copia = r.ok && r.type === 'basic' ? r.clone() : null
    return copia && caches.open(PAGINAS).then((c) => c.put(req.url, copia))
  }).catch(() => {}))
  try { return await conTiempo(red, url.pathname === '/' ? ESPERA_INICIO_MS : ESPERA_RED_MS) } catch { /* sin señal o señal débil */ }
  const hit = (await guardada(url)) || (url.pathname === '/' ? await inicioGuardado() : null)
  if (hit) return hit
  try { return await conTiempo(red, ESPERA_MAXIMA_MS) } catch { /* nada guardado y sin red */ }
  return (await caches.match('/offline')) || Response.error()
}

async function precargar(urls) {
  const paginas = await caches.open(PAGINAS)
  const estaticos = await caches.open(ESTATICOS)
  for (const u of urls) {
    try {
      const r = await conTiempo(fetch(u, { credentials: 'same-origin', redirect: 'manual' }), 20000)
      if (!r.ok || r.type !== 'basic') continue // sesión vencida (redirige a /login) u otro error: no se guarda
      const html = await r.clone().text()
      await paginas.put(new URL(u, self.location.origin).href, r)
      // Lo que esa página carga al abrir: scripts y estilos de Next.
      const recursos = new Set()
      for (const m of html.matchAll(/\/_next\/static\/[^"'\s\\<>]+/g)) recursos.add(m[0])
      for (const m of html.matchAll(/(?<![\w/])static\/(?:chunks|css|media)\/[^"'\s\\<>]+/g)) recursos.add(`/_next/${m[0]}`)
      for (const p of recursos) {
        if (await estaticos.match(p)) continue
        try {
          const rr = await conTiempo(fetch(p), 20000)
          if (rr.ok) await estaticos.put(p, rr)
        } catch { /* sigue con el resto */ }
      }
    } catch { /* sin señal: se reintenta la próxima vez */ }
  }
}

self.addEventListener('message', (e) => {
  if (e.data && e.data.tipo === 'precargar' && Array.isArray(e.data.urls)) e.waitUntil(precargar(e.data.urls))
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/maplibre/')) {
    e.respondWith(estatico(req))
    return
  }

  if (req.mode === 'navigate') {
    e.respondWith(navegar(e))
    return
  }

  if (req.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) {
    e.respondWith(conTiempo(fetch(req), ESPERA_RSC_MS).catch(() => Response.error()))
  }
})
