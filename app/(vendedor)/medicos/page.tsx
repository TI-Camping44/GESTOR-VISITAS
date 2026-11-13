'use client'
// Visita médica: todos los médicos de la visitadora, con dónde atienden y si les toca visita.
// Con señal, de la base; sin señal, los guardados en el celular.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Building2, MessageCircle, Pencil, Phone, Plus, Search } from 'lucide-react'
import { useVendedor } from '@/components/vendedor/Proveedor'
import { Aviso, Entrada, Tarjeta, Vacio } from '@/components/ui'
import { supabaseNavegador } from '@/lib/supabase/client'
import { guardarCache, leerCache } from '@/lib/offline/db'
import { hace } from '@/lib/fechas'
import { cn, linkTel, linkWhatsApp } from '@/lib/utils'
import { urlLugar, urlVisitaMedico } from '@/lib/rutas'
import { tocaVisitar } from '@/lib/medicos'
import type { Medico } from '@/lib/database.types'

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function PaginaMedicos() {
  const { perfil } = useVendedor()
  const [medicos, setMedicos] = useState<Medico[] | null>(null)
  const [sinSenal, setSinSenal] = useState(false)
  const [q, setQ] = useState('')
  const [soloToca, setSoloToca] = useState(false)
  const clave = `medicos:${perfil.id}`

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const c = await leerCache<Medico[]>(clave).catch(() => null)
      if (c && vivo) setMedicos(c.datos)
      const { data, error } = await supabaseNavegador().from('vis_medicos_v').select('*').order('nombre').limit(3000)
      if (!vivo) return
      if (data) { setMedicos(data); setSinSenal(false); void guardarCache(clave, data) }
      else if (error) { setSinSenal(true); if (!c) setMedicos([]) }
    })()
    return () => { vivo = false }
  }, [clave])

  const tocan = useMemo(() => (medicos ?? []).filter((m) => tocaVisitar(m)).length, [medicos])
  const visibles = useMemo(() => {
    const t = normal(q.trim())
    return (medicos ?? [])
      .filter((m) => !soloToca || tocaVisitar(m))
      .filter((m) => !t || normal([m.nombre, m.especialidad, ...m.lugares.map((l) => l.nombre)].filter(Boolean).join(' ')).includes(t))
      .sort((a, b) => Number(tocaVisitar(b)) - Number(tocaVisitar(a)) || a.nombre.localeCompare(b.nombre, 'es'))
  }, [medicos, q, soloToca])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Mis médicos</h1>
        <div className="flex gap-2">
          <Link href="/lugar/nuevo" className="inline-flex items-center gap-1 rounded-lg border border-borde px-2.5 py-1.5 text-sm font-medium"><Building2 className="size-4 text-marca" aria-hidden /> Lugar</Link>
          <Link href="/medicos/nuevo" className="inline-flex items-center gap-1 rounded-lg bg-marca px-2.5 py-1.5 text-sm font-medium text-sobre-marca"><Plus className="size-4" aria-hidden /> Médico</Link>
        </div>
      </div>
      {sinSenal && <Aviso tipo="alerta">Sin señal: mostrando los médicos guardados en el celular.</Aviso>}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
        <Entrada aria-label="Buscar médico" className="pl-9" placeholder="Nombre, especialidad o lugar" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex gap-2" role="group" aria-label="Filtrar">
        {[false, true].map((v) => (
          <button key={String(v)} type="button" aria-pressed={soloToca === v} onClick={() => setSoloToca(v)}
            className={cn('rounded-full border px-3 py-1 text-sm', soloToca === v ? 'border-marca bg-marca text-sobre-marca' : 'border-borde bg-superficie')}>
            {v ? `Les toca visita (${tocan})` : `Todos (${medicos?.length ?? 0})`}
          </button>
        ))}
      </div>

      {medicos && medicos.length === 0 && !sinSenal && (
        <Vacio titulo="Todavía no cargaste médicos">Primero cargá el lugar (hospital, consultorio) y después sus médicos, o tocá «Médico».</Vacio>
      )}
      <ul className="flex flex-col gap-3">
        {visibles.map((m) => {
          const toca = tocaVisitar(m)
          const tel = linkTel(m.telefono)
          const wa = linkWhatsApp(m.telefono_norm)
          return (
            <li key={m.id}>
              <Tarjeta>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{m.nombre}</p>
                    <p className="text-sm text-tenue">{m.especialidad ?? 'Sin especialidad'}</p>
                  </div>
                  {toca && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">toca visita</span>}
                </div>
                <p className="mt-1 text-xs text-tenue">Última visita: {m.ultima_visita ? hace(m.ultima_visita) : 'nunca'} · cada {m.frecuencia_dias} días</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {m.lugares.map((l) => (
                    <li key={l.lugar_id} className="flex items-center justify-between gap-2 text-sm">
                      <Link href={urlLugar(l.lugar_id)} className="min-w-0 truncate"><Building2 className="mr-1 inline size-3.5 text-tenue" aria-hidden />{l.nombre}{l.horario && <span className="text-tenue"> · {l.horario}</span>}</Link>
                      <Link href={urlVisitaMedico(l.lugar_id, m.id)} className="shrink-0 font-medium text-marca">Visitar →</Link>
                    </li>
                  ))}
                  {m.lugares.length === 0 && <li className="text-sm text-tenue">Sin lugar: editalo para indicar dónde atiende.</li>}
                </ul>
                <div className="mt-3 flex gap-2">
                  {tel && <a href={tel} className="inline-flex items-center gap-1 rounded-lg border border-borde px-2.5 py-1.5 text-sm"><Phone className="size-4" aria-hidden /> Llamar</a>}
                  {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-borde px-2.5 py-1.5 text-sm"><MessageCircle className="size-4" aria-hidden /> WhatsApp</a>}
                  <Link href={`/medicos/nuevo?id=${m.id}`} className="inline-flex items-center gap-1 rounded-lg border border-borde px-2.5 py-1.5 text-sm"><Pencil className="size-4" aria-hidden /> Editar</Link>
                </div>
              </Tarjeta>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
