// Reparte los clientes sugeridos en los días de la ruta: toma los de mayor puntaje que entran,
// los agrupa por ciudad (un día = una zona chica, menos km), ordena las ciudades por cercanía
// desde el punto de salida y llena los días en ese orden. Dentro de cada día, orden de visita.
import { distanciaM, ordenarParadas, type Punto } from './geo'

export type Candidato = { cliente_id: string; ciudad: string | null; lat: number | null; lng: number | null; puntaje: number }
export type Asignacion<T extends Candidato> = { dia: string; orden: number; c: T }

const clave = (ciudad: string | null) =>
  (ciudad ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim() || '~sin ciudad'

export function repartirEnDias<T extends Candidato>(cands: T[], capacidad: { dia: string; libres: number }[], origen: Punto | null): Asignacion<T>[] {
  const total = capacidad.reduce((s, d) => s + Math.max(0, d.libres), 0)
  const elegidos = [...cands].sort((a, b) => b.puntaje - a.puntaje).slice(0, total)

  // Grupos por ciudad con su centro.
  const grupos = new Map<string, T[]>()
  for (const c of elegidos) grupos.set(clave(c.ciudad), [...(grupos.get(clave(c.ciudad)) ?? []), c])
  const lista = [...grupos.values()].map((items) => {
    const conUbic = items.filter((i) => i.lat != null && i.lng != null)
    const centro = conUbic.length
      ? { lat: conUbic.reduce((s, i) => s + i.lat!, 0) / conUbic.length, lng: conUbic.reduce((s, i) => s + i.lng!, 0) / conUbic.length }
      : null
    return { items: items.sort((a, b) => b.puntaje - a.puntaje), centro }
  })

  // Ciudades en orden de cercanía (vecino más cercano); las sin ubicación al final.
  const conCentro = lista.filter((g) => g.centro)
  const orden: typeof lista = []
  let actual: Punto | null = origen ?? conCentro[0]?.centro ?? null
  while (conCentro.length) {
    let i = 0
    if (actual) for (let k = 1; k < conCentro.length; k++) if (distanciaM(actual, conCentro[k]!.centro!) < distanciaM(actual, conCentro[i]!.centro!)) i = k
    const g = conCentro.splice(i, 1)[0]!
    orden.push(g)
    actual = g.centro
  }
  orden.push(...lista.filter((g) => !g.centro))

  // Llenar los días en ese orden.
  const fila = orden.flatMap((g) => g.items)
  const porDia = new Map<string, T[]>()
  let k = 0
  for (const d of capacidad) {
    const tomar = fila.slice(k, k + Math.max(0, d.libres))
    k += tomar.length
    if (tomar.length) porDia.set(d.dia, tomar)
  }

  // Orden de visita dentro de cada día.
  const salida: Asignacion<T>[] = []
  for (const [dia, items] of porDia) {
    const ubic = items.filter((i) => i.lat != null && i.lng != null).map((i) => ({ i, lat: i.lat!, lng: i.lng! }))
    const resto = items.filter((i) => i.lat == null || i.lng == null)
    const ordenados = [...ordenarParadas(ubic, origen).map((x) => x.i), ...resto]
    ordenados.forEach((c, n) => salida.push({ dia, orden: n + 1, c }))
  }
  return salida
}
