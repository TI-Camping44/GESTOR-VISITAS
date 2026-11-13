'use client'
// Panel en dos vistas para las empresas con visitadoras (Vitalica): «Ventas» (vendedores y clientes)
// y «Visita médica» (visitadoras, médicos y lugares). La vista sale de la dirección: todo lo de
// /medica/… es visita médica. Las pantallas comunes (Usuarios, Ver la app como…) muestran el menú
// de la última vista usada (cookie), para no saltar de un menú al otro.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Briefcase, Stethoscope } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COOKIE_MODO, modoPropio, type ModoPanel } from '@/lib/panel'

type Ctx = { modo: ModoPanel; hayMedica: boolean; esVisitadora: (vendedorId: string | null | undefined) => boolean; delModo: (vendedorId: string | null | undefined) => boolean }
const Contexto = createContext<Ctx>({ modo: 'ventas', hayMedica: false, esVisitadora: () => false, delModo: () => true })

export function ProveedorPanel({ idsMedica, guardado, children }: { idsMedica: string[]; guardado: ModoPanel; children: ReactNode }) {
  const ruta = usePathname()
  const hayMedica = idsMedica.length > 0
  // La última vista usada (la de la cookie al cargar, y después la de cada pantalla propia que se abre).
  const propio = modoPropio(ruta)
  const [ultimo, setUltimo] = useState<ModoPanel>(guardado)
  if (propio && propio !== ultimo) setUltimo(propio)
  const modo: ModoPanel = hayMedica ? (propio ?? ultimo) : 'ventas'
  // Recordar la vista para las pantallas comunes.
  useEffect(() => {
    if (hayMedica) document.cookie = `${COOKIE_MODO}=${modo}; path=/; max-age=31536000; samesite=lax`
  }, [modo, hayMedica])
  const valor = useMemo<Ctx>(() => {
    const ids = new Set(idsMedica)
    const esVisitadora = (id: string | null | undefined) => !!id && ids.has(id)
    // En Ventas no aparecen las visitadoras; en Visita médica, solo ellas.
    return { modo, hayMedica, esVisitadora, delModo: (id) => !hayMedica || esVisitadora(id) === (modo === 'medica') }
  }, [idsMedica, modo, hayMedica])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export const usePanel = () => useContext(Contexto)

/** Interruptor arriba del menú: Ventas | Visita médica. */
export function SelectorModo() {
  const { modo, hayMedica } = usePanel()
  if (!hayMedica) return null
  const opcion = (m: ModoPanel, href: string, texto: string, Icono: typeof Briefcase) => (
    <Link href={href} aria-current={modo === m ? 'page' : undefined}
      className={cn('flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1.5 text-[13px] font-medium',
        modo === m ? 'bg-marca text-sobre-marca shadow-sm' : 'text-barra-tinta hover:bg-barra-hover')}>
      <Icono className="size-3.5 shrink-0" aria-hidden /> {texto}
    </Link>
  )
  return (
    <nav aria-label="Vista del panel" className="mb-3 flex gap-1 rounded-lg bg-barra-hover/60 p-1">
      {opcion('ventas', '/tablero', 'Ventas', Briefcase)}
      {opcion('medica', '/medica', 'Visita médica', Stethoscope)}
    </nav>
  )
}
