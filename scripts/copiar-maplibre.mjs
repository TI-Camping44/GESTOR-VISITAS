// MapLibre 6 corre su worker como módulo aparte: se sirve desde public/maplibre/.
// Corre en cada npm install (postinstall), también en Vercel.
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('public/maplibre', { recursive: true })
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(`node_modules/maplibre-gl/dist/${f}`, `public/maplibre/${f}`)
}
