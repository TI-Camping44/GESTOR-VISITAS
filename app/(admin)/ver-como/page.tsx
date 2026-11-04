// Ver la app como un vendedor o la visitadora médica, en solo lectura: lo que ve en el celular,
// con su ruta, sus clientes o lugares y sus visitas. Para revisar o explicar sin pedirle el teléfono.
import { Smartphone, Stethoscope } from 'lucide-react'
import { requerirSupervisor } from '@/lib/sesion'
import { supabaseServidor } from '@/lib/supabase/server'
import { Aviso, Tarjeta, Vacio } from '@/components/ui'
import { verComo } from './acciones'

export default async function PaginaVerComo({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requerirSupervisor()
  const { error } = await searchParams
  const sb = await supabaseServidor()
  const { data } = await sb.rpc('vis_para_ver_como')
  const gente = data ?? []
  // Grupos: vendedores de cada empresa y visitadoras médicas de cada empresa.
  const grupos = new Map<string, typeof gente>()
  for (const v of gente) {
    const g = v.tipo === 'medica' ? `Visita médica · ${v.empresa}` : `Vendedores · ${v.empresa}`
    grupos.set(g, [...(grupos.get(g) ?? []), v])
  }
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Ver la app como…</h1>
        <p className="text-sm text-tenue">Abrí la app del celular de un vendedor o de la visitadora tal como la ve: su ruta de hoy, sus clientes o lugares, sus médicos y sus visitas. Es <b>solo para mirar</b>: no inicia jornada ni guarda visitas. Para volver, «Salir de la vista» arriba de la app.</p>
      </div>
      {error && <Aviso tipo="error">No se pudo abrir esa vista.</Aviso>}
      {gente.length === 0 && <Vacio titulo="No hay vendedores para mirar">Solo aparecen los vendedores y visitadoras activos de tu gente.</Vacio>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...grupos].map(([titulo, lista]) => (
          <Tarjeta key={titulo} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 font-semibold">
              {lista[0]?.tipo === 'medica' ? <Stethoscope className="size-4 text-marca" aria-hidden /> : <Smartphone className="size-4 text-marca" aria-hidden />}
              {titulo}
            </h2>
            <ul className="flex flex-col gap-2">
              {lista.map((v) => (
                <li key={v.id}>
                  <form action={verComo}>
                    <input type="hidden" name="vendedor" value={v.id} />
                    <button type="submit" className="flex w-full items-center justify-between gap-2 rounded-lg border border-borde px-3 py-2 text-left text-sm hover:bg-fondo">
                      <span className="font-medium">{v.nombre}{v.equipo && <span className="font-normal text-tenue"> · {v.equipo}</span>}</span>
                      <span className="shrink-0 text-marca">Ver su app →</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </Tarjeta>
        ))}
      </div>
    </div>
  )
}
