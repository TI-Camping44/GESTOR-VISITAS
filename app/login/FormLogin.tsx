'use client'
import { useState } from 'react'
import { supabaseNavegador } from '@/lib/supabase/client'
import { Aviso, Boton, Entrada, Etiqueta } from '@/components/ui'
import { mensajeError } from '@/lib/utils'

export function FormLogin({ error }: { error?: string }) {
  const [email, setEmail] = useState('')
  const [estado, setEstado] = useState<'inicio' | 'enviando' | 'enviado'>('inicio')
  const [fallo, setFallo] = useState<string | null>(error ?? null)
  const volver = () => `${window.location.origin}/auth/callback`

  async function conGoogle() {
    setFallo(null)
    const { error } = await supabaseNavegador().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: volver(), queryParams: { hd: 'camping44.com.py', prompt: 'select_account' } },
    })
    if (error) setFallo(mensajeError(error))
  }

  async function conEmail(e: React.FormEvent) {
    e.preventDefault()
    setFallo(null)
    setEstado('enviando')
    const { error } = await supabaseNavegador().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: volver(), shouldCreateUser: true },
    })
    if (error) {
      setFallo(mensajeError(error))
      setEstado('inicio')
    } else setEstado('enviado')
  }

  return (
    <div className="flex flex-col gap-4">
      {fallo && <Aviso tipo="error">{fallo}</Aviso>}
      <Boton grande onClick={conGoogle}>Ingresar con Google</Boton>
      <div className="flex items-center gap-3 text-xs text-tenue"><span className="h-px flex-1 bg-borde" />o con un link por email<span className="h-px flex-1 bg-borde" /></div>
      {estado === 'enviado' ? (
        <Aviso tipo="ok">Te mandamos un link a <strong>{email}</strong>. Abrilo desde este mismo celular.</Aviso>
      ) : (
        <form onSubmit={conEmail} className="flex flex-col gap-2">
          <Etiqueta htmlFor="email">Email</Etiqueta>
          <Entrada id="email" type="email" required autoComplete="email" inputMode="email" placeholder="nombre@camping44.com.py"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <Boton type="submit" variante="secundario" disabled={estado === 'enviando'}>
            {estado === 'enviando' ? 'Enviando…' : 'Mandarme el link'}
          </Boton>
        </form>
      )}
    </div>
  )
}
