// Días de la semana en que atiende un médico (leídos del horario), como chips Lun … Sáb.
import { DIAS_SEMANA } from '@/lib/medicos'
import { cn } from '@/lib/utils'

export function ChipsDias({ dias }: { dias: number[] }) {
  if (!dias.length) return null
  return (
    <span className="inline-flex flex-wrap gap-1" aria-label={`Atiende: ${dias.map((d) => DIAS_SEMANA[d - 1]!.largo).join(', ')}`}>
      {DIAS_SEMANA.slice(0, 6).map((d) => (
        <span key={d.n} aria-hidden className={cn('rounded px-1 text-[0.7rem] font-semibold leading-5',
          dias.includes(d.n) ? 'bg-marca text-sobre-marca' : 'bg-fondo text-tenue/60')}>{d.corto}</span>
      ))}
    </span>
  )
}
