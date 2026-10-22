import 'server-only'
// Sincronización con Odoo (BRIEF §5), solo lectura de Odoo:
//  1. vendedores: usuarios de Odoo que facturaron, reconocidos por email con los de la app.
//  2. ventas: última factura y ventas de 6 meses por cliente, y su vendedor (el de la última factura de 12 meses).
//  3. clientes: alta/actualización de los partners que interesan, con la regla de ubicación.
// Cada paso deja su fila en vis_sync_log; si falla, falla ruidoso (banner en el panel).
import { m2o, odooCall, odooConfig, odooLogin, odooVersion, searchReadAll } from '@/lib/odoo'
import { supabaseServicio } from '@/lib/supabase/servicio'
import { fechaIso, sumarDias } from '@/lib/fechas'
import { filaCliente, vendedorPorFacturas, type GrupoFacturas, type PartnerOdoo } from './reglas'

type Fila = Record<string, unknown>
const DOMINIO_CLIENTES = [['customer_rank', '>', 0], ['parent_id', '=', false], ['active', '=', true]]
const CAMPOS_PARTNER = ['id', 'name', 'vat', 'phone', 'mobile', 'street', 'street2', 'city', 'state_id', 'partner_latitude', 'partner_longitude', 'create_date', 'user_id']
const LOTE = 500

function dominioFacturas(desde?: string) {
  const { companyId } = odooConfig()
  return [
    ['move_type', '=', 'out_invoice'], ['state', '=', 'posted'],
    ...(companyId !== null ? [['company_id', '=', companyId]] : []),
    ...(desde ? [['invoice_date', '>=', desde]] : []),
  ]
}

const lotes = <T,>(xs: T[], n = LOTE) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n))

// ── Revisión (para el panel, antes de sincronizar) ─────────────────────
export type Revision = {
  version: string
  usuario: string
  companias: { id: number; nombre: string }[]
  companiaElegida: number | null
  clientesOdoo: number
  facturas12m: number
  vendedores: { odooId: number; nombre: string; email: string | null; facturas: number; enApp: string | null }[]
  camposFaltantes: string[]
}

export async function revisarOdoo(): Promise<Revision> {
  const cfg = odooConfig()
  const ver = await odooVersion()
  const uid = await odooLogin(true)
  const [yo] = await odooCall<Fila[]>('res.users', 'search_read', [[['id', '=', uid]]], { fields: ['name', 'login'] })
  const companias = await odooCall<Fila[]>('res.company', 'search_read', [[]], { fields: ['id', 'name'], order: 'id asc' })
  const [cPartner, cMove] = await Promise.all([
    odooCall<Record<string, unknown>>('res.partner', 'fields_get', [], { attributes: ['type'] }),
    odooCall<Record<string, unknown>>('account.move', 'fields_get', [], { attributes: ['type'] }),
  ])
  const faltan = [
    ...CAMPOS_PARTNER.filter((c) => !(c in cPartner)).map((c) => `res.partner.${c}`),
    ...['invoice_user_id', 'commercial_partner_id', 'invoice_date', 'amount_untaxed_signed'].filter((c) => !(c in cMove)).map((c) => `account.move.${c}`),
  ]
  const desde12 = sumarDias(fechaIso(), -365)
  const [clientesOdoo, porVendedor] = await Promise.all([
    odooCall<number>('res.partner', 'search_count', [DOMINIO_CLIENTES]),
    odooCall<Fila[]>('account.move', 'read_group', [dominioFacturas(desde12), ['invoice_user_id'], ['invoice_user_id']], { lazy: false }),
  ])
  const ids = porVendedor.map((g) => m2o(g.invoice_user_id)?.id).filter((x): x is number => !!x)
  const usuarios = ids.length ? await odooCall<Fila[]>('res.users', 'search_read', [[['id', 'in', ids]]], { fields: ['id', 'name', 'login'], context: { active_test: false } }) : []
  const { data: app } = await supabaseServicio().from('vis_vendedores').select('nombre, email')
  const porEmail = new Map((app ?? []).map((v) => [v.email.toLowerCase(), v.nombre]))
  return {
    version: String((ver as { server_version?: string }).server_version ?? ''),
    usuario: `${yo?.name ?? ''} (${yo?.login ?? ''})`,
    companias: companias.map((c) => ({ id: Number(c.id), nombre: String(c.name) })),
    companiaElegida: cfg.companyId,
    clientesOdoo,
    facturas12m: porVendedor.reduce((s, g) => s + Number(g.__count ?? 0), 0),
    vendedores: porVendedor.map((g) => {
      const u = usuarios.find((x) => x.id === m2o(g.invoice_user_id)?.id)
      const email = typeof u?.login === 'string' ? u.login.toLowerCase() : null
      return { odooId: Number(u?.id ?? 0), nombre: String(u?.name ?? m2o(g.invoice_user_id)?.name ?? 'Sin vendedor'), email, facturas: Number(g.__count ?? 0), enApp: email ? porEmail.get(email) ?? null : null }
    }).sort((a, b) => b.facturas - a.facturas),
    camposFaltantes: faltan,
  }
}

// ── Sincronización ─────────────────────────────────────────────────────
type Paso = { proceso: string; leidos: number; insertados: number; actualizados: number }
export type ResultadoSync = { ok: boolean; pasos: Paso[]; error?: string }

async function conLog(proceso: string, fn: () => Promise<Omit<Paso, 'proceso'>>): Promise<Paso> {
  const sb = supabaseServicio()
  const { data: log } = await sb.from('vis_sync_log').insert({ proceso }).select('id').single()
  try {
    const r = await fn()
    if (log) await sb.from('vis_sync_log').update({ fin: new Date().toISOString(), ok: true, ...r }).eq('id', log.id)
    return { proceso, ...r }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (log) await sb.from('vis_sync_log').update({ fin: new Date().toISOString(), ok: false, error: msg.slice(0, 1000) }).eq('id', log.id)
    throw e
  }
}

export async function sincronizarOdoo(): Promise<ResultadoSync> {
  const pasos: Paso[] = []
  try {
    const sb = supabaseServicio()
    const hoy = fechaIso()
    const desde6m = sumarDias(hoy, -183)
    const desde12m = sumarDias(hoy, -365)
    const desde24m = sumarDias(hoy, -730)

    // 1. Vendedores: usuario de Odoo ↔ usuario de la app, por email.
    const odooAApp = new Map<number, string>()
    const empresaDe = new Map<string, string>() // vendedor de la app → su empresa
    pasos.push(await conLog('vendedores', async () => {
      const grupos = await odooCall<Fila[]>('account.move', 'read_group', [dominioFacturas(desde24m), ['invoice_user_id'], ['invoice_user_id']], { lazy: false })
      const ids = grupos.map((g) => m2o(g.invoice_user_id)?.id).filter((x): x is number => !!x)
      const usuarios = ids.length ? await odooCall<Fila[]>('res.users', 'search_read', [[['id', 'in', ids]]], { fields: ['id', 'login'], context: { active_test: false } }) : []
      const { data: app, error } = await sb.from('vis_vendedores').select('id, email, odoo_user_id, empresa_id')
      if (error) throw new Error(error.message)
      for (const v of app ?? []) empresaDe.set(v.id, v.empresa_id)
      let actualizados = 0
      for (const u of usuarios) {
        const v = (app ?? []).find((x) => typeof u.login === 'string' && x.email.toLowerCase() === u.login.toLowerCase())
        if (!v) continue
        odooAApp.set(Number(u.id), v.id)
        if (v.odoo_user_id !== Number(u.id)) {
          await sb.from('vis_vendedores').update({ odoo_user_id: null }).eq('odoo_user_id', Number(u.id)).neq('id', v.id)
          const { error: e2 } = await sb.from('vis_vendedores').update({ odoo_user_id: Number(u.id) }).eq('id', v.id)
          if (e2) throw new Error(e2.message)
          actualizados++
        }
      }
      // También los que ya tenían odoo_user_id cargado a mano.
      for (const v of app ?? []) if (v.odoo_user_id && !odooAApp.has(v.odoo_user_id)) odooAApp.set(v.odoo_user_id, v.id)
      return { leidos: usuarios.length, insertados: 0, actualizados }
    }))

    // 2. Ventas por cliente y vendedor de la última factura.
    const ultima = new Map<number, string>()
    const ventas6m = new Map<number, { monto: number; facturas: number }>()
    let duenio = new Map<number, number>()
    pasos.push(await conLog('ventas', async () => {
      const [todas, seis, porVendedor] = await Promise.all([
        odooCall<Fila[]>('account.move', 'read_group', [dominioFacturas(), ['commercial_partner_id', 'ultima:max(invoice_date)'], ['commercial_partner_id']], { lazy: false }),
        odooCall<Fila[]>('account.move', 'read_group', [dominioFacturas(desde6m), ['commercial_partner_id', 'amount_untaxed_signed:sum'], ['commercial_partner_id']], { lazy: false }),
        odooCall<Fila[]>('account.move', 'read_group', [dominioFacturas(desde12m), ['commercial_partner_id', 'invoice_user_id', 'ultima:max(invoice_date)', 'amount_untaxed_signed:sum'], ['commercial_partner_id', 'invoice_user_id']], { lazy: false }),
      ])
      for (const g of todas) { const p = m2o(g.commercial_partner_id)?.id; if (p && typeof g.ultima === 'string') ultima.set(p, g.ultima) }
      for (const g of seis) { const p = m2o(g.commercial_partner_id)?.id; if (p) ventas6m.set(p, { monto: Math.round(Number(g.amount_untaxed_signed ?? 0)), facturas: Number(g.__count ?? 0) }) }
      duenio = vendedorPorFacturas(porVendedor.map((g): GrupoFacturas => ({
        partnerId: m2o(g.commercial_partner_id)?.id ?? 0, userId: m2o(g.invoice_user_id)?.id ?? null,
        ultima: typeof g.ultima === 'string' ? g.ultima : null, monto: Number(g.amount_untaxed_signed ?? 0),
      })))
      return { leidos: todas.length, insertados: 0, actualizados: ventas6m.size }
    }))

    // 3. Clientes: los que facturaron en 2 años, los que ya están en la app y los de la cartera de un vendedor de la app.
    pasos.push(await conLog('clientes', async () => {
      const { data: actuales, error } = await sb.from('vis_clientes').select('id, odoo_partner_id, origen_ubicacion, vendedor_id').not('odoo_partner_id', 'is', null)
      if (error) throw new Error(error.message)
      const existentes = new Map((actuales ?? []).map((c) => [c.odoo_partner_id!, c]))
      const ids = new Set<number>([...existentes.keys()])
      for (const [p, f] of ultima) if (f >= desde24m) ids.add(p)
      const conCartera = odooAApp.size
        ? await searchReadAll<PartnerOdoo & { user_id?: unknown }>('res.partner', [...DOMINIO_CLIENTES, ['user_id', 'in', [...odooAApp.keys()]]], CAMPOS_PARTNER, { pageSize: 1000 })
        : []
      const partners = new Map<number, PartnerOdoo & { user_id?: unknown }>(conCartera.map((p) => [p.id, p]))
      const faltan = [...ids].filter((id) => !partners.has(id))
      for (const lote of lotes(faltan, 1000)) {
        for (const p of await odooCall<(PartnerOdoo & { user_id?: unknown })[]>('res.partner', 'search_read', [[['id', 'in', lote]]], { fields: CAMPOS_PARTNER, context: { active_test: false } })) partners.set(p.id, p)
      }

      const conUbicacion: Fila[] = []
      const sinUbicacion: Fila[] = []
      let insertados = 0
      let actualizados = 0
      for (const p of partners.values()) {
        const ex = existentes.get(p.id)
        const { fila, pisaUbicacion } = filaCliente(p, ex?.origen_ubicacion, !!ex)
        const v6 = ventas6m.get(p.id)
        fila.ultima_factura_fecha = ultima.get(p.id) ?? null
        fila.ventas_6m_gs = v6?.monto ?? 0
        fila.facturas_6m = v6?.facturas ?? 0
        // Vendedor: el de la última factura de 12 meses; si no hay, el de la ficha de Odoo; si no está en la app, el que tenía.
        // Un cliente que ya es de un vendedor de otra empresa (Vitalica) no se le saca: se leen solo las facturas de esta.
        const odooUser = duenio.get(p.id) ?? m2o(p.user_id)?.id
        const nuevo = odooUser ? odooAApp.get(odooUser) : undefined
        const otraEmpresa = !!(nuevo && ex?.vendedor_id && empresaDe.get(ex.vendedor_id) !== empresaDe.get(nuevo))
        fila.vendedor_id = (otraEmpresa ? ex?.vendedor_id : nuevo) ?? ex?.vendedor_id ?? null
        ;(pisaUbicacion ? conUbicacion : sinUbicacion).push(fila)
        if (ex) actualizados++
        else insertados++
      }
      for (const grupo of [conUbicacion, sinUbicacion]) {
        for (const lote of lotes(grupo)) {
          const { error: e } = await sb.from('vis_clientes').upsert(lote as never, { onConflict: 'odoo_partner_id' })
          if (e) throw new Error(e.message)
        }
      }
      return { leidos: partners.size, insertados, actualizados }
    }))
    return { ok: true, pasos }
  } catch (e) {
    return { ok: false, pasos, error: e instanceof Error ? e.message : String(e) }
  }
}
