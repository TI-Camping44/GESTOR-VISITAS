import type { NextRequest } from 'next/server'
import { actualizarSesion } from '@/lib/supabase/middleware'

export function middleware(request: NextRequest) {
  return actualizarSesion(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)'],
}
