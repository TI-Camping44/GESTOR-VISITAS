// Sincronización diaria con Odoo (cron de Vercel, vercel.json). Protegida con CRON_SECRET.
import { sincronizarOdoo } from '@/lib/sync/odoo'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET?.trim()
  if (!secreto || req.headers.get('authorization') !== `Bearer ${secreto}`) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }
  const r = await sincronizarOdoo()
  return Response.json(r, { status: r.ok ? 200 : 500 })
}
