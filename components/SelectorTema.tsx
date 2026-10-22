'use client'
// Tema de la app: Claro, Oscuro o Automático (sigue al celular/computadora). Se guarda en el
// navegador y se aplica antes de pintar (script en app/layout.tsx), sin parpadeo.
import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tema = 'claro' | 'oscuro' | 'auto'
export const CLAVE_TEMA = 'vis-tema'
const OPCIONES: { valor: Tema; texto: string; Icono: typeof Sun }[] = [
  { valor: 'claro', texto: 'Claro', Icono: Sun },
  { valor: 'oscuro', texto: 'Oscuro', Icono: Moon },
  { valor: 'auto', texto: 'Auto', Icono: Monitor },
]

function aplicar(t: Tema) {
  if (t === 'auto') document.documentElement.removeAttribute('data-tema')
  else document.documentElement.setAttribute('data-tema', t)
}

export function SelectorTema({ className, enBarra = false }: { className?: string; enBarra?: boolean }) {
  const [tema, setTema] = useState<Tema>('auto')
  useEffect(() => {
    try { const t = localStorage.getItem(CLAVE_TEMA); if (t === 'claro' || t === 'oscuro') setTema(t) } catch { /* sin almacenamiento */ }
  }, [])

  function elegir(t: Tema) {
    setTema(t)
    aplicar(t)
    try { if (t === 'auto') localStorage.removeItem(CLAVE_TEMA); else localStorage.setItem(CLAVE_TEMA, t) } catch { /* nada */ }
  }

  return (
    <div role="radiogroup" aria-label="Tema" className={cn('flex rounded-lg p-0.5 ring-1', enBarra ? 'ring-barra-hover' : 'ring-borde', className)}>
      {OPCIONES.map(({ valor, texto, Icono }) => {
        const activo = tema === valor
        return (
          <button key={valor} type="button" role="radio" aria-checked={activo} title={valor === 'auto' ? 'Automático: como el celular o la computadora' : texto} onClick={() => elegir(valor)}
            className={cn('flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
              activo ? (enBarra ? 'bg-barra-hover text-barra-tinta' : 'bg-superficie text-tinta shadow-sm') : (enBarra ? 'text-barra-tenue' : 'text-tenue'))}>
            <Icono className="size-3.5" aria-hidden /> {texto}
          </button>
        )
      })}
    </div>
  )
}
