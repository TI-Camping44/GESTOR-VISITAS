'use client'
import { useRouter } from 'next/navigation'
import { supabaseNavegador } from '@/lib/supabase/client'
import { Boton } from '@/components/ui'

export function BotonSalir({ className }: { className?: string }) {
  const router = useRouter()
  return (
    <Boton variante="secundario" className={className} onClick={async () => {
      await supabaseNavegador().auth.signOut()
      router.replace('/login')
      router.refresh()
    }}>
      Salir
    </Boton>
  )
}
