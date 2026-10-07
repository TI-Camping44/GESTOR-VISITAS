'use client'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtFecha, hoyIso, lunesDe, semanaIso, sumarDias } from '@/lib/fechas'

export function SelectorSemana({ semana, alCambiar }: { semana: string; alCambiar: (lunes: string) => void }) {
  const actual = lunesDe(hoyIso())
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-borde bg-superficie p-1">
      <button type="button" aria-label="Semana anterior" className="rounded-md p-1.5 hover:bg-fondo" onClick={() => alCambiar(sumarDias(semana, -7))}><ChevronLeft className="size-4" /></button>
      <span className="px-2 text-sm font-medium tabular">Sem {semanaIso(semana)} · {fmtFecha(semana)} al {fmtFecha(sumarDias(semana, 5))}</span>
      <button type="button" aria-label="Semana siguiente" className="rounded-md p-1.5 hover:bg-fondo" onClick={() => alCambiar(sumarDias(semana, 7))}><ChevronRight className="size-4" /></button>
      {semana !== actual && <button type="button" className="rounded-md px-2 py-1 text-sm text-marca hover:bg-fondo" onClick={() => alCambiar(actual)}>Hoy</button>}
    </div>
  )
}
