import { NextResponse, type NextRequest } from 'next/server'
import { supabaseServidor } from '@/lib/supabase/server'

// Vuelta del login (Google o link por email): canjea el código por la sesión.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  if (code) {
    const supabase = await supabaseServidor()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}/`)
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
  }
  const error = searchParams.get('error_description') ?? 'No se pudo iniciar sesión'
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error)}`)
}
