import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { COLOR_ESTADO, ETIQUETA_ESTADO } from '@/lib/config'
import type { EstadoCliente } from '@/lib/database.types'

type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma' | 'exito'
const VARIANTES: Record<Variante, string> = {
  primario: 'bg-marca text-white hover:bg-marca-oscuro disabled:bg-marca/50',
  secundario: 'bg-superficie text-tinta border border-borde hover:bg-fondo',
  peligro: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  exito: 'bg-green-600 text-white hover:bg-green-700 disabled:bg-green-600/50',
  fantasma: 'text-tinta hover:bg-fondo',
}

export const Boton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; grande?: boolean }>(
  function Boton({ className, variante = 'primario', grande, ...p }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca',
          grande ? 'min-h-14 px-5 text-lg' : 'min-h-10 px-4 text-sm',
          VARIANTES[variante],
          className,
        )}
        {...p}
      />
    )
  },
)

export function Tarjeta({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-borde bg-superficie p-4', className)}>{children}</div>
}

export function Etiqueta({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return <label htmlFor={htmlFor} className={cn('mb-1 block text-sm font-medium text-tinta', className)}>{children}</label>
}

const campo = 'w-full rounded-lg border border-borde bg-superficie px-3 py-2 text-base text-tinta placeholder:text-tenue focus:border-marca focus:outline-none focus:ring-2 focus:ring-marca/20'

export const Entrada = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Entrada({ className, ...p }, ref) {
  return <input ref={ref} className={cn(campo, className)} {...p} />
})

export function AreaTexto({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(campo, 'min-h-20', className)} {...p} />
}

export function Selector({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(campo, 'pr-8', className)} {...p} />
}

export function Aviso({ tipo = 'info', children, className }: { tipo?: 'info' | 'error' | 'ok' | 'alerta'; children: ReactNode; className?: string }) {
  const estilos = {
    info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100',
    error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100',
    ok: 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100',
    alerta: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
  }[tipo]
  return <div role={tipo === 'error' ? 'alert' : 'status'} className={cn('rounded-lg border px-3 py-2 text-sm', estilos, className)}>{children}</div>
}

export function PuntoEstado({ estado, conTexto }: { estado: EstadoCliente | null | undefined; conTexto?: boolean }) {
  const e = estado ?? 'potencial'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-tenue">
      <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: COLOR_ESTADO[e] }} aria-hidden />
      {conTexto ? ETIQUETA_ESTADO[e] : <span className="sr-only">{ETIQUETA_ESTADO[e]}</span>}
    </span>
  )
}

export function Insignia({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full bg-fondo px-2 py-0.5 text-xs font-medium text-tenue', className)}>{children}</span>
}

export function Vacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-borde px-4 py-10 text-center">
      <p className="font-medium text-tinta">{titulo}</p>
      {children && <div className="mt-1 text-sm text-tenue">{children}</div>}
    </div>
  )
}
