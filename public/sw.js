// Service worker de Visitas C44.
// - Estáticos de Next (/_next/static): caché primero (tienen hash, no cambian).
// - Páginas: red primero; sin señal, la última versión guardada o /offline.
// - Supabase y tiles de mapas: no se tocan (los datos offline van por IndexedDB).
const VERSION = 'vis-v1'
const ESTATICOS = `${VERSION}-estaticos`
const PAGINAS = `${VERSION}-paginas`
const PRECARGA = ['/offline', '/icons/icon-192.png']

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

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => {
        const copia = r.clone()
        caches.open(ESTATICOS).then((c) => c.put(req, copia))
        return r
      })),
    )
    return
  }

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok && !r.redirected) {
            const copia = r.clone()
            caches.open(PAGINAS).then((c) => c.put(req, copia))
          }
          return r
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/offline'))),
    )
  }
})
