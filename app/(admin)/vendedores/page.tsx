'use client'
// Usuarios (BRIEF §6 supervisor 6): dar acceso (por email), rol, empresa, equipo, metas, punto de salida.
// Solo el admin modifica; el supervisor ve la lista. El admin de todas las empresas (TI) elige
// la empresa de cada uno (una o Ambas); el admin de una empresa gestiona solo la suya.
// También el punto de salida del depósito y la invitación por correo (se manda sola al dar acceso).
import { useCallback, useEffect, useState } from 'react'
import { Aviso, Boton, Entrada, Etiqueta, Insignia, Selector, Tarjeta } from '@/components/ui'
import { Invitacion } from '@/components/admin/Invitacion'
import { enviarInvitacion } from './acciones'
import { supabaseNavegador } from '@/lib/supabase/client'
import { fmtFecha } from '@/lib/fechas'
import { leerCoordenadas } from '@/lib/geo'
import { mensajeError } from '@/lib/utils'
import type { Empresa, Equipo, Perfil, Rol, TipoUsuario, Vendedor } from '@/lib/database.types'

// Rol y app en un solo selector: la visitadora médica es un vendedor con la app de visita médica.
type RolApp = Rol | 'medica'
const ROLES: Record<RolApp, string> = { vendedor: 'Vendedor', medica: 'Visitadora médica', supervisor: 'Supervisor', admin: 'Admin' }
const rolApp = (v: Pick<Vendedor, 'rol' | 'tipo'>): RolApp => (v.rol === 'vendedor' && v.tipo === 'medica' ? 'medica' : v.rol)
const desdeRolApp = (x: RolApp): { rol: Rol; tipo: TipoUsuario } => (x === 'medica' ? { rol: 'vendedor', tipo: 'medica' } : { rol: x, tipo: 'ventas' })
const AMBAS = 'ambas'
const CHICO = 'min-h-9 px-2 py-1 text-sm' // casilleros de la tabla
const LISTA = CHICO + ' pr-6' // selectores: lugar para la flechita
const coordTexto = (lat: number | null, lng: number | null) => (lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : '')

export default function Vendedores() {
  const sb = supabaseNavegador()
  const [lista, setLista] = useState<Vendedor[]>([])
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [nuevo, setNuevo] = useState({ nombre: '', email: '', telefono: '', rol: 'vendedor' as RolApp, empresa: '', equipo: '' })
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [deposito, setDeposito] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await sb.from('vis_vendedores').select('*').order('activo', { ascending: false }).order('nombre')
    if (error) setError(mensajeError(error))
    else setLista(data ?? [])
  }, [sb])

  useEffect(() => {
    void cargar()
    sb.rpc('vis_vincular_usuario').then(({ data }) => setPerfil((data as Perfil | null) ?? null))
    sb.from('vis_empresas').select('id, nombre').order('created_at').then(({ data }) => setEmpresas(data ?? []))
    sb.from('vis_equipos').select('id, empresa_id, nombre').order('created_at').then(({ data }) => setEquipos(data ?? []))
    sb.from('vis_config').select('base_lat, base_lng').maybeSingle().then(({ data }) => setDeposito(coordTexto(data?.base_lat ?? null, data?.base_lng ?? null)))
  }, [sb, cargar])

  const esAdmin = perfil?.rol === 'admin'
  const soyTI = esAdmin && !!perfil?.multi_empresa
  const editable = (v: Vendedor) => esAdmin && (soyTI || v.empresa_id === perfil?.empresa_id)
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre ?? ''
  const empresaDe = (v: Pick<Vendedor, 'empresa_id' | 'multi_empresa'>) =>
    v.multi_empresa ? empresas.map((e) => e.nombre).join(' y ') : nombreEmpresa(v.empresa_id)

  // Equipos (Mayorista / Venta externa): los cambia un admin sin equipo de esa empresa, o TI.
  const equiposDe = (empresaId: string | null | undefined) => equipos.filter((q) => q.empresa_id === empresaId)
  const nombreEquipo = (id: string | null) => equipos.find((q) => q.id === id)?.nombre ?? ''
  const puedeEquipo = (v: Vendedor) => esAdmin && !v.multi_empresa && equiposDe(v.empresa_id).length > 0
    && (soyTI || (v.empresa_id === perfil?.empresa_id && !perfil?.equipo_id))
  const hayEquipos = equipos.length > 0
  const empresaNueva = nuevo.empresa && nuevo.empresa !== AMBAS ? nuevo.empresa : nuevo.empresa === AMBAS ? null : perfil?.empresa_id

  async function asignarEquipo(v: Vendedor, equipo: string) {
    setError(null); setOk(null)
    const { error } = await sb.rpc('vis_asignar_equipo', { p_vendedor: v.id, p_equipo: equipo || null })
    if (error) setError(mensajeError(error))
    else setOk(`${v.nombre}: ${equipo ? `ahora es de ${nombreEquipo(equipo)}` : 'sin equipo (lo ven solo admins y gerencia)'}.`)
    void cargar()
  }

  async function asignarEmpresa(v: Vendedor, valor: string) {
    setError(null); setOk(null)
    const ambas = valor === AMBAS
    const { error } = await sb.rpc('vis_asignar_empresa', { p_vendedor: v.id, p_empresa: ambas ? v.empresa_id : valor, p_ambas: ambas })
    if (error) setError(mensajeError(error))
    else setOk(`${v.nombre}: ${ambas ? 'acceso a todas las empresas' : `ahora es de ${nombreEmpresa(valor)}`}.`)
    void cargar()
  }

  async function actualizar(id: string, cambios: Partial<Pick<Vendedor, 'nombre' | 'telefono' | 'rol' | 'tipo' | 'meta_diaria' | 'meta_semanal' | 'base_lat' | 'base_lng' | 'activo'>>) {
    setError(null)
    const { error } = await sb.from('vis_vendedores').update(cambios).eq('id', id)
    if (error) setError(mensajeError(error))
    void cargar()
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    const email = nuevo.email.trim().toLowerCase()
    if (!nuevo.nombre.trim() || !email.includes('@')) return setError('Completá nombre y email.')
    setError(null); setOk(null)
    const { data, error } = await sb.from('vis_vendedores')
      .insert({ nombre: nuevo.nombre.trim(), email, ...desdeRolApp(nuevo.rol), telefono: nuevo.telefono.trim() || null }).select('*').single()
    if (error) return setError(error.code === '23505' ? 'Ese email ya tiene acceso.' : mensajeError(error))
    if (soyTI && nuevo.empresa && (nuevo.empresa === AMBAS || nuevo.empresa !== data.empresa_id)) {
      const ambas = nuevo.empresa === AMBAS
      const { error: e2 } = await sb.rpc('vis_asignar_empresa', { p_vendedor: data.id, p_empresa: ambas ? data.empresa_id : nuevo.empresa, p_ambas: ambas })
      if (e2) { setError(`${data.nombre} quedó en ${nombreEmpresa(data.empresa_id)}: ${mensajeError(e2)}`); void cargar(); return }
    }
    if (nuevo.equipo) {
      const { error: e3 } = await sb.rpc('vis_asignar_equipo', { p_vendedor: data.id, p_equipo: nuevo.equipo })
      if (e3) { setError(`${data.nombre} quedó sin equipo: ${mensajeError(e3)}`); void cargar(); return }
    }
    const r = await enviarInvitacion(data.id)
    if ('ok' in r) setOk(`${data.nombre} ya tiene acceso y le mandamos la invitación a ${data.email}.`)
    else setError(`${data.nombre} ya tiene acceso, pero no se pudo mandar la invitación: ${r.error}`)
    setNuevo({ nombre: '', email: '', telefono: '', rol: 'vendedor', empresa: '', equipo: '' })
    void cargar()
  }

  async function guardarDeposito() {
    const p = deposito.trim() ? leerCoordenadas(deposito) : null
    if (deposito.trim() && !p) return setError('Coordenadas del depósito inválidas.')
    const { error } = await sb.from('vis_config').update({ base_lat: p?.lat ?? null, base_lng: p?.lng ?? null }).eq('id', true)
    if (error) setError(mensajeError(error))
    else setOk('Punto de salida del depósito guardado.')
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Usuarios y accesos</h1>
      {perfil && !esAdmin && <Aviso tipo="info">Solo un admin puede dar acceso o cambiar metas.</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}

      {esAdmin && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta>
            <h2 className="mb-3 font-semibold">Dar acceso</h2>
            <form onSubmit={crear} className="grid gap-3 sm:grid-cols-2">
              <div><Etiqueta htmlFor="v-nombre">Nombre</Etiqueta><Entrada id="v-nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
              <div><Etiqueta htmlFor="v-email">Email (cuenta Google de la empresa)</Etiqueta><Entrada id="v-email" type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} /></div>
              <div><Etiqueta htmlFor="v-tel">Celular (opcional, para WhatsApp)</Etiqueta><Entrada id="v-tel" type="tel" inputMode="tel" placeholder="0981 123 456" value={nuevo.telefono} onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} /></div>
              <div>
                <Etiqueta htmlFor="v-rol">Rol</Etiqueta>
                <Selector id="v-rol" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value as RolApp })}>
                  {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Selector>
              </div>
              {soyTI && (
                <div>
                  <Etiqueta htmlFor="v-empresa">Empresa</Etiqueta>
                  <Selector id="v-empresa" value={nuevo.empresa || (perfil?.empresa_id ?? '')} onChange={(e) => setNuevo({ ...nuevo, empresa: e.target.value, equipo: '' })}>
                    {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                    <option value={AMBAS}>Ambas</option>
                  </Selector>
                </div>
              )}
              {(soyTI || !perfil?.equipo_id) && equiposDe(empresaNueva).length > 0 && (
                <div>
                  <Etiqueta htmlFor="v-equipo">Equipo</Etiqueta>
                  <Selector id="v-equipo" value={nuevo.equipo} onChange={(e) => setNuevo({ ...nuevo, equipo: e.target.value })}>
                    <option value="">Sin equipo (todos)</option>
                    {equiposDe(empresaNueva).map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
                  </Selector>
                </div>
              )}
              <Boton type="submit" className="self-end">Dar acceso y enviar invitación</Boton>
            </form>
          </Tarjeta>
          <Tarjeta>
            <h2 className="mb-1 font-semibold">Punto de salida del depósito</h2>
            <p className="mb-3 text-sm text-tenue">Se usa para ordenar las paradas cuando el vendedor no tiene uno propio. Pegá coordenadas o un link de Google Maps.</p>
            <div className="flex gap-2">
              <Entrada value={deposito} onChange={(e) => setDeposito(e.target.value)} placeholder="-25.2637, -57.5759" aria-label="Coordenadas del depósito" />
              <Boton variante="secundario" onClick={() => void guardarDeposito()}>Guardar</Boton>
            </div>
          </Tarjeta>
        </div>
      )}

      <Tarjeta className="overflow-x-auto p-0">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue [&>th]:whitespace-nowrap [&>th]:px-1.5 [&>th]:py-2.5 [&>th]:font-medium [&>th:first-child]:pl-4 [&>th:last-child]:pr-4">
              <th>Usuario</th><th>Rol</th><th>Empresa</th>{hayEquipos && <th>Equipo</th>}
              <th>Meta día / sem.</th><th>Punto de salida</th><th>Acceso · activo</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((v) => {
              const ed = editable(v)
              return (
                <tr key={v.id} className={`border-b border-borde align-middle last:border-0 [&>td]:px-1.5 [&>td]:py-2.5 [&>td:first-child]:pl-4 [&>td:last-child]:pr-4 ${v.activo ? '' : 'opacity-50'}`}>
                  <td>
                    <div className="w-52">
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={v.nombre}>{v.nombre}</p>
                        <p className="truncate text-xs text-tenue" title={v.email}>{v.email}</p>
                        <input disabled={!ed} type="tel" inputMode="tel" defaultValue={v.telefono ?? ''} placeholder="+ celular" aria-label={`Celular de ${v.nombre}`}
                          className="-ml-1 mt-0.5 w-36 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-tenue hover:border-borde focus:border-borde focus:bg-superficie focus:outline-none disabled:hover:border-transparent"
                          onBlur={(e) => { const t = e.target.value.trim() || null; if (t !== v.telefono) void actualizar(v.id, { telefono: t }) }} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <Selector disabled={!ed || v.id === perfil?.id} value={rolApp(v)} onChange={(e) => void actualizar(v.id, desdeRolApp(e.target.value as RolApp))} className={LISTA + ' w-44'} aria-label={`Rol de ${v.nombre}`}
                      title={v.id === perfil?.id ? 'Tu propio rol lo cambia otro admin. Para ver la app de un vendedor: «Ver la app como…».' : undefined}>
                      {Object.entries(ROLES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </Selector>
                  </td>
                  <td>
                    {soyTI ? (
                      <Selector value={v.multi_empresa ? AMBAS : v.empresa_id} onChange={(e) => void asignarEmpresa(v, e.target.value)} className={LISTA + ' w-32'} aria-label={`Empresa de ${v.nombre}`}>
                        {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                        <option value={AMBAS}>Ambas</option>
                      </Selector>
                    ) : (
                      <span className="whitespace-nowrap">{v.multi_empresa ? 'Ambas' : nombreEmpresa(v.empresa_id)}</span>
                    )}
                  </td>
                  {hayEquipos && (
                    <td>
                      {puedeEquipo(v) ? (
                        <Selector value={v.equipo_id ?? ''} onChange={(e) => void asignarEquipo(v, e.target.value)} className={LISTA + ' w-32'} aria-label={`Equipo de ${v.nombre}`}
                          title={v.rol !== 'admin' && !v.multi_empresa && !v.equipo_id ? 'Sin equipo: no lo ve ningún supervisor de equipo' : undefined}>
                          <option value="">Sin equipo</option>
                          {equiposDe(v.empresa_id).map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
                        </Selector>
                      ) : (
                        <span className="whitespace-nowrap text-tenue">{nombreEquipo(v.equipo_id) || '—'}</span>
                      )}
                    </td>
                  )}
                  <td>
                    <div className="flex items-center gap-1">
                      <Entrada disabled={!ed} type="number" min={1} defaultValue={v.meta_diaria} className={CHICO + ' w-12 px-1 text-center'} aria-label={`Meta diaria de ${v.nombre}`}
                        onBlur={(e) => { const n = Number(e.target.value); if (n > 0 && n !== v.meta_diaria) void actualizar(v.id, { meta_diaria: n }) }} />
                      <span className="text-tenue">/</span>
                      <Entrada disabled={!ed} type="number" min={1} defaultValue={v.meta_semanal} className={CHICO + ' w-14 px-1 text-center'} aria-label={`Meta semanal de ${v.nombre}`}
                        onBlur={(e) => { const n = Number(e.target.value); if (n > 0 && n !== v.meta_semanal) void actualizar(v.id, { meta_semanal: n }) }} />
                    </div>
                  </td>
                  <td>
                    <Entrada disabled={!ed} defaultValue={coordTexto(v.base_lat, v.base_lng)} placeholder="el del depósito" className={CHICO + ' w-32'} aria-label={`Punto de salida de ${v.nombre}`}
                      onBlur={(e) => {
                        const t = e.target.value.trim()
                        const p = t ? leerCoordenadas(t) : null
                        if (t && !p) { setError(`Coordenadas inválidas para ${v.nombre}.`); return }
                        if ((p?.lat ?? null) !== v.base_lat || (p?.lng ?? null) !== v.base_lng) void actualizar(v.id, { base_lat: p?.lat ?? null, base_lng: p?.lng ?? null })
                      }} />
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      {v.auth_user_id
                        ? <Insignia className="bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" >ingresó</Insignia>
                        : <Insignia>nunca ingresó</Insignia>}
                      {v.tracking_aceptado_el && <span className="whitespace-nowrap text-xs text-tenue" title={`Aceptó el aviso de ubicación el ${fmtFecha(v.tracking_aceptado_el)}`}>GPS ✓</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      {ed && v.activo && <Invitacion compacto id={v.id} v={v} empresa={empresaDe(v)} />}
                      <input type="checkbox" className="ml-auto size-4 accent-[var(--c-marca)]" disabled={!ed || v.id === perfil?.id} checked={v.activo} title={v.activo ? 'Activo (destildá para quitarle el acceso)' : 'Inactivo'}
                        onChange={(e) => void actualizar(v.id, { activo: e.target.checked })} aria-label={`Activo: ${v.nombre}`} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Tarjeta>
    </div>
  )
}
