// Vista del panel (servidor y navegador): «Ventas» o «Visita médica». Ver components/admin/PanelModo.tsx.
export type ModoPanel = 'ventas' | 'medica'
export const COOKIE_MODO = 'vis_panel'
const COMUNES = ['/vendedores', '/ver-como']

/** La vista propia de una dirección: /medica/… es visita médica, Usuarios y Ver la app como… no tienen
 *  (usan la última), y el resto es ventas. */
export function modoPropio(ruta: string): ModoPanel | null {
  if (ruta === '/medica' || ruta.startsWith('/medica/') || ruta.startsWith('/visita-medica')) return 'medica'
  return COMUNES.some((c) => ruta === c || ruta.startsWith(`${c}/`)) ? null : 'ventas'
}
