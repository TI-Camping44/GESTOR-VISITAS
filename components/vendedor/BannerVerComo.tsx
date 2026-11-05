// Franja de «Ver la app como…»: de quién es la app que se está mirando y cómo salir.
import { Eye } from 'lucide-react'
import { dejarDeVer } from '@/app/(admin)/ver-como/acciones'

export function BannerVerComo({ nombre }: { nombre: string }) {
  return (
    <form action={dejarDeVer} className="flex items-center justify-between gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
      <span className="flex min-w-0 items-center gap-1.5"><Eye className="size-4 shrink-0" aria-hidden /><span className="truncate">Viendo la app de <b>{nombre}</b> · solo lectura</span></span>
      <button type="submit" className="shrink-0 font-semibold underline">Salir de la vista</button>
    </form>
  )
}
