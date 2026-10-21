'use client'
import { useRouter } from 'next/navigation'
import { supabaseNavegador } from '@/lib/supabase/client'
import { Boton } from '@/components/ui'

export function BotonSalir({ className }: { className?: string }) {
  const router = useRouter()
  return (
    <Boton variante="secundario" className={className} onClick={async () => {
      await supabaseNavegador().auth.signOut()
      // Las pantallas guardadas para usar sin señal son de este usuario: se borran al salir.
      try { localStorage.removeItem('vis-precarga') } catch { /* nada */ }
      if (typeof caches !== 'undefined') await caches.keys().then((ks) => Promise.all(ks.filter((k) => k.endsWith('-paginas')).map((k) => caches.delete(k)))).catch(() => {})
      router.replace('/login')
      router.refresh()
    }}>
      Salir
    </Boton>
  )
}
