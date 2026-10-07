import type { NextRequest } from 'next/server'
import { actualizarSesion } from './lib/supabase/middleware'

export function middleware(request: NextRequest) {
  return actualizarSesion(request)
}

export const config = {
  // Node.js completo (no Edge): supabase-js usa APIs que el runtime Edge no tiene.
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|maplibre/|sw.js|manifest.webmanifest|.*\\.(?:png|svg|jpg|jpeg|webp|ico|mjs)$).*)'],
}
