'use client'
// Visita médica → Ruteo de la semana: lugares por día, a quién ver, llegadas reales y resultados.
import { RuteoMedico } from '@/components/admin/RuteoMedico'
import { Vacio } from '@/components/ui'
import { useVisitadoras } from '@/components/admin/medica/datos'

export default function Ruteo() {
  const visitadoras = useVisitadoras()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Ruteo de la semana</h1>
        <p className="text-sm text-tenue">Por día: los lugares, a qué médico o especialidad ir, la hora real de llegada y el resultado. Se puede cargar desde la planilla.</p>
      </div>
      {visitadoras.length ? <RuteoMedico visitadoras={visitadoras.filter((v) => v.activo)} /> : <Vacio titulo="No hay visitadoras" />}
    </div>
  )
}
