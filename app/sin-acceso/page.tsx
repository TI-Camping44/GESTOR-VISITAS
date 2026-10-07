import { BotonSalir } from '@/components/BotonSalir'

export const metadata = { title: 'Sin acceso' }

export default function SinAcceso() {
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Pedile acceso a TI</h1>
      <p className="text-tenue">
        Tu cuenta todavía no está habilitada en la app de visitas. Escribile a TI con el email con el que ingresaste para que te den acceso.
      </p>
      <BotonSalir />
    </main>
  )
}
