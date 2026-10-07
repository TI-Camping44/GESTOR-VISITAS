'use client'
// Cola offline en IndexedDB: visitas y posiciones esperando subir, más una caché
// de lo último que vio el vendedor (paradas del día) para poder trabajar sin señal.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export type VisitaPendiente = {
  client_uuid: string
  payload: Record<string, unknown>
  creada: number
  intentos: number
  error?: string
  nombreCliente: string
}

export type PosicionPendiente = {
  fecha_hora: string
  lat: number
  lng: number
  precision_m: number | null
  velocidad_kmh: number | null
  bateria_pct: number | null
  origen: 'tracking' | 'visita' | 'inicio' | 'fin'
}

interface Esquema extends DBSchema {
  visitas: { key: string; value: VisitaPendiente }
  posiciones: { key: string; value: PosicionPendiente }
  cache: { key: string; value: { clave: string; guardado: number; datos: unknown } }
}

let db: Promise<IDBPDatabase<Esquema>> | null = null

export function abrir() {
  db ??= openDB<Esquema>('vis-offline', 1, {
    upgrade(d) {
      d.createObjectStore('visitas', { keyPath: 'client_uuid' })
      d.createObjectStore('posiciones', { keyPath: 'fecha_hora' })
      d.createObjectStore('cache', { keyPath: 'clave' })
    },
  })
  return db
}

export async function guardarCache(clave: string, datos: unknown) {
  await (await abrir()).put('cache', { clave, guardado: Date.now(), datos })
}

export async function leerCache<T>(clave: string): Promise<{ guardado: number; datos: T } | null> {
  const r = await (await abrir()).get('cache', clave)
  return r ? { guardado: r.guardado, datos: r.datos as T } : null
}

export async function contarPendientes() {
  const d = await abrir()
  return { visitas: await d.count('visitas'), posiciones: await d.count('posiciones') }
}
