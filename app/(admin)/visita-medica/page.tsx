import { redirect } from 'next/navigation'

// La página única de visita médica se dividió en secciones (Actividad, Médicos, Lugares…): /medica.
export default function VisitaMedica() {
  redirect('/medica')
}
