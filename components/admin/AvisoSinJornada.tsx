'use client'
// Tablero: quién registró visitas hoy sin iniciar la jornada (pedido de Sergio, 27/11). Sin jornada no se guarda el
// recorrido ni se lo ve en En vivo: solo quedan las visitas. La app le avisa al vendedor; esto se lo muestra al supervisor.
import { useEffect, useState } from 'react'
import { Aviso } from '@/components/ui'
import { usePanel } from '@/components/admin/PanelModo'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtSoloHora, hoyIso, sumarDias } from '@/lib/fechas'

type Fila = { nombre: string; visitas: number; primera: string }

export function AvisoSinJornada() {
  const { delModo } = usePanel()
  const [filas, setFilas] = useState<Fila[]>([])
  useEffect(() => {
    let vivo = true
    const sb = supabaseNavegador()
    const desde = new Date(`${hoyIso()}T00:00:00-03:00`).toISOString()
    const hasta = new Date(`${sumarDias(hoyIso(), 1)}T00:00:00-03:00`).toISOString()
    void Promise.all([
      sb.from('vis_vendedores').select('id, nombre').eq('activo', true),
      sb.from('vis_visitas').select('vendedor_id, fecha_hora').gte('fecha_hora', desde).lt('fecha_hora', hasta).limit(5000),
      sb.from('vis_jornadas').select('vendedor_id, inicio, fin').or(`fin.is.null,fin.gte.${desde}`).lt('inicio', hasta).limit(2000),
    ]).then(([rv, rs, rj]) => {
      if (!vivo) return
      const conJornada = new Set((rj.data ?? []).map((j) => j.vendedor_id))
      const m = new Map<string, Fila>()
      for (const v of rs.data ?? []) {
        if (!v.vendedor_id || conJornada.has(v.vendedor_id) || !delModo(v.vendedor_id)) continue
        const nombre = (rv.data ?? []).find((x) => x.id === v.vendedor_id)?.nombre
        if (!nombre) continue
        const f = m.get(v.vendedor_id) ?? { nombre, visitas: 0, primera: v.fecha_hora }
        f.visitas++; if (v.fecha_hora < f.primera) f.primera = v.fecha_hora
        m.set(v.vendedor_id, f)
      }
      setFilas([...m.values()].sort((a, b) => b.visitas - a.visitas))
    })
    return () => { vivo = false }
  }, [delModo])
  if (!filas.length) return null
  return (
    <Aviso tipo="alerta">
      <p className="font-medium">Hoy sin iniciar la jornada</p>
      <ul className="mt-1 text-sm">
        {filas.map((f) => <li key={f.nombre}><b>{f.nombre}</b>: {f.visitas} visita{f.visitas === 1 ? '' : 's'} desde las {fmtSoloHora(f.primera)}, sin jornada. No se guarda su recorrido ni aparece en En vivo.</li>)}
      </ul>
      <p className="mt-1 text-xs">La app ya le avisa al registrar una visita; pedile que toque «Iniciar jornada» a la mañana.</p>
    </Aviso>
  )
}
