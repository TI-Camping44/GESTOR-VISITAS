import { redirect } from 'next/navigation'
import { obtenerPerfil } from '@/lib/sesion'
import { FormLogin } from './FormLogin'

export const metadata = { title: 'Ingresar' }

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { autenticado } = await obtenerPerfil()
  if (autenticado) redirect('/')
  const { error } = await searchParams
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-marca">Camping 44</p>
        <h1 className="mt-1 text-2xl font-semibold">Visitas y rutas</h1>
        <p className="mt-1 text-tenue">Ingresá con tu cuenta de la empresa.</p>
      </div>
      <FormLogin error={error} />
    </main>
  )
}
