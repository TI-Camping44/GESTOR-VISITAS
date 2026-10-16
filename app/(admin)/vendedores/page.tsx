'use client'
// Usuarios (BRIEF §6 supervisor 6): dar acceso (por email), rol, empresa, metas, punto de salida.
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
import type { Empresa, Perfil, Rol, Vendedor } from '@/lib/database.types'

const ROLES: Record<Rol, string> = { vendedor: 'Vendedor', supervisor: 'Supervisor', admin: 'Admin' }
const AMBAS = 'ambas'
const coordTexto = (lat: number | null, lng: number | null) => (lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : '')

export default function Vendedores() {
  const sb = supabaseNavegador()
  const [lista, setLista] = useState<Vendedor[]>([])
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [nuevo, setNuevo] = useState({ nombre: '', email: '', telefono: '', rol: 'vendedor' as Rol, empresa: '' })
  const [empresas, setEmpresas] = useState<Empresa[]>([])
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
    sb.from('vis_config').select('base_lat, base_lng').maybeSingle().then(({ data }) => setDeposito(coordTexto(data?.base_lat ?? null, data?.base_lng ?? null)))
  }, [sb, cargar])

  const esAdmin = perfil?.rol === 'admin'
  const soyTI = esAdmin && !!perfil?.multi_empresa
  const editable = (v: Vendedor) => esAdmin && (soyTI || v.empresa_id === perfil?.empresa_id)
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre ?? ''
  const empresaDe = (v: Pick<Vendedor, 'empresa_id' | 'multi_empresa'>) =>
    v.multi_empresa ? empresas.map((e) => e.nombre).join(' y ') : nombreEmpresa(v.empresa_id)

  async function asignarEmpresa(v: Vendedor, valor: string) {
    setError(null); setOk(null)
    const ambas = valor === AMBAS
    const { error } = await sb.rpc('vis_asignar_empresa', { p_vendedor: v.id, p_empresa: ambas ? v.empresa_id : valor, p_ambas: ambas })
    if (error) setError(mensajeError(error))
    else setOk(`${v.nombre}: ${ambas ? 'acceso a todas las empresas' : `ahora es de ${nombreEmpresa(valor)}`}.`)
    void cargar()
  }

  async function actualizar(id: string, cambios: Partial<Pick<Vendedor, 'nombre' | 'telefono' | 'rol' | 'meta_diaria' | 'meta_semanal' | 'base_lat' | 'base_lng' | 'activo'>>) {
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
      .insert({ nombre: nuevo.nombre.trim(), email, rol: nuevo.rol, telefono: nuevo.telefono.trim() || null }).select('*').single()
    if (error) return setError(error.code === '23505' ? 'Ese email ya tiene acceso.' : mensajeError(error))
    if (soyTI && nuevo.empresa && (nuevo.empresa === AMBAS || nuevo.empresa !== data.empresa_id)) {
      const ambas = nuevo.empresa === AMBAS
      const { error: e2 } = await sb.rpc('vis_asignar_empresa', { p_vendedor: data.id, p_empresa: ambas ? data.empresa_id : nuevo.empresa, p_ambas: ambas })
      if (e2) { setError(`${data.nombre} quedó en ${nombreEmpresa(data.empresa_id)}: ${mensajeError(e2)}`); void cargar(); return }
    }
    const r = await enviarInvitacion(data.id)
    if ('ok' in r) setOk(`${data.nombre} ya tiene acceso y le mandamos la invitación a ${data.email}.`)
    else setError(`${data.nombre} ya tiene acceso, pero no se pudo mandar la invitación: ${r.error}`)
    setNuevo({ nombre: '', email: '', telefono: '', rol: 'vendedor', empresa: '' })
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
                <Selector id="v-rol" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value as Rol })}>
                  {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Selector>
              </div>
              {soyTI && (
                <div>
                  <Etiqueta htmlFor="v-empresa">Empresa</Etiqueta>
                  <Selector id="v-empresa" value={nuevo.empresa || (perfil?.empresa_id ?? '')} onChange={(e) => setNuevo({ ...nuevo, empresa: e.target.value })}>
                    {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                    <option value={AMBAS}>Ambas</option>
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
        <table className="w-full min-w-[1120px] text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-tenue">
              <th className="px-4 py-2 font-medium">Nombre / email</th><th className="px-2 py-2 font-medium">Rol</th><th className="px-2 py-2 font-medium">Empresa</th>
              <th className="px-2 py-2 font-medium">Meta día</th><th className="px-2 py-2 font-medium">Meta semana</th>
              <th className="px-2 py-2 font-medium">Punto de salida</th><th className="px-2 py-2 font-medium">Estado / invitar</th><th className="px-4 py-2 font-medium">Activo</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((v) => (
              <tr key={v.id} className={`border-b border-borde last:border-0 ${v.activo ? '' : 'opacity-50'}`}>
                <td className="px-4 py-2">
                  <p className="font-medium">{v.nombre}</p><p className="text-xs text-tenue">{v.email}</p>
                  <Entrada disabled={!editable(v)} type="tel" inputMode="tel" defaultValue={v.telefono ?? ''} placeholder="celular" className="mt-1 min-h-8 w-40 py-1 text-xs" aria-label={`Celular de ${v.nombre}`}
                    onBlur={(e) => { const t = e.target.value.trim() || null; if (t !== v.telefono) void actualizar(v.id, { telefono: t }) }} />
                </td>
                <td className="px-2 py-2">
                  <Selector disabled={!editable(v)} value={v.rol} onChange={(e) => void actualizar(v.id, { rol: e.target.value as Rol })} className="w-36" aria-label="Rol">
                    {Object.entries(ROLES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </Selector>
                </td>
                <td className="px-2 py-2">
                  {soyTI ? (
                    <Selector value={v.multi_empresa ? AMBAS : v.empresa_id} onChange={(e) => void asignarEmpresa(v, e.target.value)} className="w-40" aria-label={`Empresa de ${v.nombre}`}>
                      {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                      <option value={AMBAS}>Ambas</option>
                    </Selector>
                  ) : (
                    <span className="text-xs">{v.multi_empresa ? 'Ambas' : nombreEmpresa(v.empresa_id)}</span>
                  )}
                </td>
                <td className="px-2 py-2"><Entrada disabled={!editable(v)} type="number" min={1} defaultValue={v.meta_diaria} className="w-20" aria-label="Meta diaria"
                  onBlur={(e) => { const n = Number(e.target.value); if (n > 0 && n !== v.meta_diaria) void actualizar(v.id, { meta_diaria: n }) }} /></td>
                <td className="px-2 py-2"><Entrada disabled={!editable(v)} type="number" min={1} defaultValue={v.meta_semanal} className="w-20" aria-label="Meta semanal"
                  onBlur={(e) => { const n = Number(e.target.value); if (n > 0 && n !== v.meta_semanal) void actualizar(v.id, { meta_semanal: n }) }} /></td>
                <td className="px-2 py-2"><Entrada disabled={!editable(v)} defaultValue={coordTexto(v.base_lat, v.base_lng)} placeholder="usa el del depósito" className="w-52" aria-label="Punto de salida"
                  onBlur={(e) => {
                    const t = e.target.value.trim()
                    const p = t ? leerCoordenadas(t) : null
                    if (t && !p) { setError(`Coordenadas inválidas para ${v.nombre}.`); return }
                    if ((p?.lat ?? null) !== v.base_lat || (p?.lng ?? null) !== v.base_lng) void actualizar(v.id, { base_lat: p?.lat ?? null, base_lng: p?.lng ?? null })
                  }} /></td>
                <td className="px-2 py-2 text-xs">
                  {v.auth_user_id ? <Insignia className="bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200">ingresó</Insignia> : <Insignia>nunca ingresó</Insignia>}
                  {v.tracking_aceptado_el && <p className="mt-1 text-tenue">Aviso GPS aceptado {fmtFecha(v.tracking_aceptado_el)}</p>}
                  {editable(v) && v.activo && <Invitacion id={v.id} v={v} empresa={empresaDe(v)} />}
                </td>
                <td className="px-4 py-2"><input type="checkbox" disabled={!editable(v)} checked={v.activo} onChange={(e) => void actualizar(v.id, { activo: e.target.checked })} aria-label="Activo" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tarjeta>
    </div>
  )
}
