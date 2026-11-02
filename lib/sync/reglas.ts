// Reglas de la sincronización con Odoo, sin red ni base: se prueban en tests/sync.test.ts.

/** Facturas de un cliente agrupadas por vendedor (account.move.read_group por commercial_partner_id + invoice_user_id). */
export type GrupoFacturas = { partnerId: number; userId: number | null; ultima: string | null; monto: number }

/**
 * De quién es cada cliente: el vendedor de su última factura. Si dos vendedores facturaron
 * el mismo último día, el de mayor monto. Facturas sin vendedor no cuentan.
 */
export function vendedorPorFacturas(grupos: GrupoFacturas[]): Map<number, number> {
  const mejor = new Map<number, GrupoFacturas>()
  for (const g of grupos) {
    if (g.userId == null || !g.ultima) continue
    const actual = mejor.get(g.partnerId)
    if (!actual || g.ultima > actual.ultima! || (g.ultima === actual.ultima && g.monto > actual.monto)) mejor.set(g.partnerId, g)
  }
  return new Map([...mejor].map(([p, g]) => [p, g.userId!]))
}

export type PartnerOdoo = {
  id: number
  name: string | false
  vat?: string | false
  phone?: string | false
  mobile?: string | false
  street?: string | false
  street2?: string | false
  city?: string | false
  state_id?: [number, string] | false
  partner_latitude?: number | false
  partner_longitude?: number | false
  create_date?: string | false
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Teléfono usable: sin el apóstrofo que agrega el export y sin rellenos como "." o "999999999". */
export function telefonoOdoo(p: PartnerOdoo): string | null {
  for (const v of [p.mobile, p.phone]) {
    const t = texto(v)?.replace(/^'+/, '') ?? null
    const digitos = t?.replace(/\D/g, '') ?? ''
    if (t && digitos.length >= 6 && !/^(\d)\1+$/.test(digitos)) return t
  }
  return null
}

/** Coordenadas de Odoo usables (0,0 o fuera de rango = sin ubicación). */
export function coordenadasOdoo(p: PartnerOdoo): { lat: number; lng: number } | null {
  const lat = typeof p.partner_latitude === 'number' ? p.partner_latitude : 0
  const lng = typeof p.partner_longitude === 'number' ? p.partner_longitude : 0
  if (!lat || !lng || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

/**
 * Fila de vis_clientes a partir del partner de Odoo. Nunca toca zona, notas ni prospectos propios.
 * Ubicación: si la vigente es de Odoo (o no hay), se copia la de Odoo; si la corrigió alguien
 * (manual / gps_visita), Odoo no la pisa.
 */
export function filaCliente(p: PartnerOdoo, origenActual: string | null | undefined, existe: boolean) {
  const coords = coordenadasOdoo(p)
  const fila: Record<string, unknown> = {
    odoo_partner_id: p.id,
    razon_social: texto(p.name) ?? `Cliente Odoo ${p.id}`,
    ruc: texto(p.vat),
    telefono: telefonoOdoo(p),
    direccion: [texto(p.street), texto(p.street2)].filter(Boolean).join(', ') || null,
    ciudad: texto(p.city)?.replace(/\s*\([^)]*\)\s*$/, '') || null, // "ASUNCION (DISTRITO)" → "ASUNCION"
    departamento: Array.isArray(p.state_id) ? p.state_id[1] : null,
    lat_odoo: coords?.lat ?? null,
    lng_odoo: coords?.lng ?? null,
    odoo_alta_fecha: texto(p.create_date)?.slice(0, 10) ?? null,
  }
  const pisaUbicacion = !existe || origenActual == null || origenActual === 'odoo'
  if (pisaUbicacion) {
    fila.lat = coords?.lat ?? null
    fila.lng = coords?.lng ?? null
    fila.origen_ubicacion = coords ? 'odoo' : null
  }
  return { fila, pisaUbicacion }
}

// ── Sucursales (Vitalica) ──────────────────────────────────────────────
/** Una factura de Vitalica con sus contactos: cliente (partner_id), entrega (partner_shipping_id) y empresa (commercial_partner_id). */
export type FacturaSucursal = { partnerId: number | null; entregaId: number | null; empresaId: number | null; userId: number | null; fecha: string | null; monto: number }

/** A qué sucursal va la factura: la dirección de entrega si es otra que la empresa; si no, el cliente si es otro. */
export function sucursalDeFactura(f: FacturaSucursal): number | null {
  if (f.entregaId && f.empresaId && f.entregaId !== f.empresaId) return f.entregaId
  if (f.partnerId && f.empresaId && f.partnerId !== f.empresaId) return f.partnerId
  return null
}

export type ResumenSucursal = { empresaId: number; ultima: string | null; ventas6m: number; facturas6m: number }

/** Por sucursal: su empresa, la última factura, lo vendido en 6 meses y el vendedor de la última factura de 12 meses. */
export function resumirSucursales(facturas: FacturaSucursal[], desde6m: string, desde12m: string) {
  const resumen = new Map<number, ResumenSucursal>()
  const grupos = new Map<string, GrupoFacturas>()
  for (const f of facturas) {
    const s = sucursalDeFactura(f)
    if (!s || !f.empresaId) continue
    const r = resumen.get(s) ?? { empresaId: f.empresaId, ultima: null, ventas6m: 0, facturas6m: 0 }
    if (f.fecha && (!r.ultima || f.fecha > r.ultima)) r.ultima = f.fecha
    if (f.fecha && f.fecha >= desde6m) { r.ventas6m += f.monto; r.facturas6m++ }
    resumen.set(s, r)
    if (f.fecha && f.fecha >= desde12m && f.userId != null) {
      const k = `${s}:${f.userId}`
      const g = grupos.get(k) ?? { partnerId: s, userId: f.userId, ultima: null, monto: 0 }
      if (!g.ultima || f.fecha > g.ultima) g.ultima = f.fecha
      g.monto += f.monto
      grupos.set(k, g)
    }
  }
  for (const r of resumen.values()) r.ventas6m = Math.round(r.ventas6m)
  return { resumen, vendedor: vendedorPorFacturas([...grupos.values()]) }
}

/** Nombre de la sucursal en la app: "EMPRESA · SUCURSAL". Las direcciones de entrega suelen no tener nombre: va la calle o la ciudad. */
export function nombreSucursal(empresa: string | null, p: PartnerOdoo): string {
  const propio = texto(p.name) ?? texto(p.street) ?? texto(p.city)?.replace(/\s*\([^)]*\)\s*$/, '') ?? `Sucursal ${p.id}`
  return empresa && !propio.toUpperCase().startsWith(empresa.toUpperCase()) ? `${empresa} · ${propio}` : propio
}

/** Tipos de contacto hijo que pueden ser una sucursal. Un "contacto" es una persona y comparte la dirección de la empresa. */
export const TIPOS_SUCURSAL = ['delivery', 'other', 'invoice']
