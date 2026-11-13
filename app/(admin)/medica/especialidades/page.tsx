'use client'
// Visita médica → Especialidades: cuántos médicos hay de cada una, en cuántos lugares, cuántos se
// visitaron en el período y a cuántos les toca visita. Tocar una abre sus médicos.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Boton, Selector, Tarjeta, Vacio } from '@/components/ui'
import { descargarCsv } from '@/lib/csv'
import { hoyIso, sumarDias } from '@/lib/fechas'
import { tocaVisitar } from '@/lib/medicos'
import { useParamUrl } from '@/lib/useParamUrl'
import { agruparEspecialidades, leerVisitas, useMedicos, useVisitadoras } from '@/components/admin/medica/datos'

const PERIODOS = [{ dias: '30', texto: 'Últimos 30 días' }, { dias: '60', texto: 'Últimos 60 días' }, { dias: '90', texto: 'Últimos 90 días' }]

export default function Especialidades() {
  const { medicos } = useMedicos()
  const visitadoras = useVisitadoras()
  const [dias, setDias] = useParamUrl('dias', '30')
  const [visitados, setVisitados] = useState<Set<string> | null>(null)

  useEffect(() => {
    if (!visitadoras.length) return
    let vivo = true
    leerVisitas(visitadoras.map((v) => v.id), sumarDias(hoyIso(), -Number(dias)), hoyIso())
      .then((v) => { if (vivo) setVisitados(new Set(v.map((x) => x.medico_id).filter((x): x is string => !!x))) }).catch(() => {})
    return () => { vivo = false }
  }, [visitadoras, dias])

  const filas = useMemo(() => agruparEspecialidades(medicos ?? []).map((g) => {
    const vis = g.medicos.filter((m) => visitados?.has(m.id)).length
    return {
      ...g, vis,
      lugares: new Set(g.medicos.flatMap((m) => m.lugares.map((l) => l.lugar_id))).size,
      toca: g.medicos.filter((m) => tocaVisitar(m)).length,
      cobertura: g.medicos.length ? Math.round((vis / g.medicos.length) * 100) : 0,
    }
  }), [medicos, visitados])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Especialidades</h1>
        <p className="text-sm text-tenue">Cuántos médicos hay de cada especialidad y cuántos se visitaron. Las escritas distinto («Clínica Medica» y «Clínica médica») se cuentan juntas.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Selector aria-label="Período" value={dias} onChange={(e) => setDias(e.target.value)} className="w-auto">
          {PERIODOS.map((p) => <option key={p.dias} value={p.dias}>{p.texto}</option>)}
        </Selector>
        <Boton variante="secundario" className="ml-auto" disabled={!filas.length} onClick={() => descargarCsv(`especialidades_${hoyIso()}`, [
          { titulo: 'Especialidad', valor: (f: (typeof filas)[number]) => f.nombre },
          { titulo: 'Médicos', valor: (f: (typeof filas)[number]) => f.medicos.length },
          { titulo: 'Lugares', valor: (f: (typeof filas)[number]) => f.lugares },
          { titulo: `Visitados (${dias} días)`, valor: (f: (typeof filas)[number]) => f.vis },
          { titulo: 'Cobertura %', valor: (f: (typeof filas)[number]) => f.cobertura },
          { titulo: 'Les toca visita', valor: (f: (typeof filas)[number]) => f.toca },
        ], filas)}>Excel</Boton>
      </div>
      <Tarjeta className="overflow-x-auto p-0">
        {medicos === null ? <div className="m-4 h-40 animate-pulse rounded-xl bg-borde/40" /> : filas.length === 0 ? <div className="p-4"><Vacio titulo="Todavía no hay médicos" /></div> : (
          <table className="w-full min-w-[640px] text-sm tabular">
            <thead><tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="px-4 py-2 font-medium">Especialidad</th><th className="px-2 py-2 text-right font-medium">Médicos</th><th className="px-2 py-2 text-right font-medium">Lugares</th>
              <th className="px-2 py-2 font-medium">Visitados en el período</th><th className="px-2 py-2 text-right font-medium">Les toca visita</th>
            </tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.clave} className="border-b border-borde last:border-0">
                  <td className="px-4 py-2"><Link href={`/medica/medicos?esp=${encodeURIComponent(f.clave)}`} className="font-medium hover:text-marca hover:underline">{f.nombre}</Link></td>
                  <td className="px-2 py-2 text-right">{f.medicos.length}</td>
                  <td className="px-2 py-2 text-right">{f.lugares}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-28 overflow-hidden rounded-full bg-fondo" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={f.cobertura} aria-label={`${f.cobertura}% visitados`}>
                        <div className="h-full rounded-full bg-marca" style={{ width: `${f.cobertura}%` }} />
                      </div>
                      <span>{visitados ? `${f.vis} de ${f.medicos.length}` : '–'}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">{f.toca ? <Link href={`/medica/medicos?esp=${encodeURIComponent(f.clave)}&toca=1`} className="hover:underline">{f.toca}</Link> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>
    </div>
  )
}
