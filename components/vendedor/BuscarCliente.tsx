'use client'
// Visitar a un cliente que no está en la ruta del día: busca entre los clientes del vendedor
// (guardados en el celular, sirve sin señal) y, con señal, también en la base. La visita
// cuenta igual en el día y en el tablero figura como "fuera de ruta".
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { useVendedor } from '@/components/vendedor/Proveedor'
import { Entrada, PuntoEstado, Tarjeta } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { leerCache } from '@/lib/offline/db'
import { urlVisita } from '@/lib/rutas'
import type { EstadoCliente } from '@/lib/database.types'

type Encontrado = { id: string; razon_social: string; ciudad: string | null; direccion: string | null; estado: EstadoCliente | null; ruc?: string | null; vendedor_id?: string | null }
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function BuscarCliente({ paradas }: { paradas: Map<string, string> }) {
  const { perfil, nombreVendedor } = useVendedor()
  const [q, setQ] = useState('')
  const [cartera, setCartera] = useState<Encontrado[]>([])
  const [remotos, setRemotos] = useState<Encontrado[]>([])

  useEffect(() => {
    leerCache<Encontrado[]>(`cartera:${perfil.id}`).then((c) => setCartera(c?.datos ?? [])).catch(() => {})
  }, [perfil.id])

  // Con señal, también los de sus zonas que no son de su cartera.
  useEffect(() => {
    const texto = q.trim().replace(/[,()%*\\]/g, ' ')
    if (texto.length < 3 || !navigator.onLine) { setRemotos([]); return }
    const t = setTimeout(() => {
      void supabaseNavegador().from('vis_clientes_v').select('id, razon_social, ciudad, direccion, estado, ruc, vendedor_id')
        .or(`razon_social.ilike.*${texto}*,ciudad.ilike.*${texto}*,ruc.ilike.*${texto}*`).eq('activo', true).limit(15)
        .then(({ data }) => setRemotos((data ?? []) as Encontrado[]))
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  const resultados = useMemo(() => {
    const n = normal(q.trim())
    if (n.length < 2) return []
    const vistos = new Set<string>()
    return [...cartera, ...remotos].filter((c) => normal(`${c.razon_social} ${c.ciudad ?? ''} ${c.ruc ?? ''}`).includes(n))
      .filter((c) => (vistos.has(c.id) ? false : (vistos.add(c.id), true)))
      .slice(0, 12)
  }, [q, cartera, remotos])

  return (
    <Tarjeta className="flex flex-col gap-2">
      <label htmlFor="buscar-cliente" className="text-sm font-medium">¿Visitar a otro cliente?</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
        <Entrada id="buscar-cliente" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, ciudad o RUC" className="pl-9" autoComplete="off" />
      </div>
      {q.trim().length >= 2 && resultados.length === 0 && (
        <p className="text-sm text-tenue">No aparece entre tus clientes. Si es nuevo, dalo de alta en <Link href="/prospecto/nuevo" className="font-medium text-marca underline">Nuevo cliente</Link>.</p>
      )}
      {resultados.length > 0 && (
        <ul className="flex flex-col divide-y divide-borde">
          {resultados.map((c) => {
            const parada = paradas.get(c.id)
            return (
              <li key={c.id}>
                <Link href={urlVisita(c.id, { parada })} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.razon_social}</span>
                    <span className="flex items-center gap-2 text-xs text-tenue">
                      {c.estado && <PuntoEstado estado={c.estado} />}{c.ciudad ?? 'Sin ciudad'}{parada && ' · en tu ruta de hoy'}
                      {c.vendedor_id && c.vendedor_id !== perfil.id && <span className="text-amber-700 dark:text-amber-300">· de {nombreVendedor(c.vendedor_id)}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-marca">Visitar →</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Tarjeta>
  )
}
