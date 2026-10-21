// Dirección vieja (/visita/<id>): pasa a /visita?c=<id>, que funciona sin señal para cualquier cliente.
import { redirect } from 'next/navigation'

export default async function VisitaVieja({ params, searchParams }: {
  params: Promise<{ clienteId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ clienteId }, q] = await Promise.all([params, searchParams])
  const u = new URLSearchParams({ c: clienteId })
  for (const k of ['parada', 'alta']) { const v = q[k]; if (typeof v === 'string') u.set(k, v) }
  redirect(`/visita?${u}`)
}
