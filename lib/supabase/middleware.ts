import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config'

const PUBLICAS = ['/login', '/auth', '/sin-acceso', '/offline']

/** Refresca la sesión en cada request y manda al login a quien no está autenticado. */
export async function actualizarSesion(request: NextRequest) {
  let respuesta = NextResponse.next({ request })
  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        for (const { name, value } of lista) request.cookies.set(name, value)
        respuesta = NextResponse.next({ request })
        for (const { name, value, options } of lista) respuesta.cookies.set(name, value, options)
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  const ruta = request.nextUrl.pathname
  if (!user && !PUBLICAS.some((p) => ruta === p || ruta.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }
  return respuesta
}
