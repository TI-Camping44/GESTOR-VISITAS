-- Corrección de Fitway (TI-0115, 17/11, Sergio corrigió su dato de 0037):
--   - «FITWAY-SUCURLSA MARKET PLACE» (Odoo 21433) es el local de Marketplace Av. España.
--   - «FITWAY-CASA CENTRAL» (Odoo 21430) es el local de Pacheco / Charles de Gaulle.
-- En 0037 la Casa Central se había quedado con el GPS y la visita de Marketplace, y se creó aparte la sucursal
-- «FITWAY-PACHECO / CHARLES DE GAULLE». Sergio ya había puesto las dos en las rutas de Sem 47 y 48.
-- Se deja todo en su lugar, incluidas las paradas (así las rutas siguen yendo a los mismos locales):
--   1) Casa Central → Market Place: GPS, visitas y paradas (Marketplace), y Market Place pasa a Hugo.
--   2) Pacheco (alta manual de 0037) → Casa Central: GPS, visitas y paradas; la sucursal Pacheco queda inactiva.
-- Solo corre si la sucursal manual de Pacheco sigue activa (no se aplica dos veces).

do $$
declare
  v_vit  uuid := (select id from vis_empresas where nombre = 'Vitalica');
  v_hugo uuid := (select id from vis_vendedores where email = 'hugojara@vitalica.com.py');
  cc vis_clientes;  -- Casa Central (Odoo 21430)
  mp vis_clientes;  -- Market Place (Odoo 21433)
  pa vis_clientes;  -- Pacheco, alta manual de 0037
begin
  select * into cc from vis_clientes where odoo_partner_id = 21430;
  select * into mp from vis_clientes where odoo_partner_id = 21433;
  select * into pa from vis_clientes where razon_social = 'LICHTON S.A. - FITWAY · FITWAY-PACHECO / CHARLES DE GAULLE' and empresa_id = v_vit and activo;
  if cc.id is null or mp.id is null or pa.id is null then return; end if;

  -- 1) Lo de Marketplace, de la Casa Central a Market Place.
  update vis_visitas set cliente_id = mp.id where cliente_id = cc.id;
  update vis_ruta_paradas rp set cliente_id = mp.id where rp.cliente_id = cc.id
    and not exists (select 1 from vis_ruta_paradas x where x.ruta_id = rp.ruta_id and x.cliente_id = mp.id and x.dia = rp.dia);
  update vis_clientes set lat = cc.lat, lng = cc.lng, origen_ubicacion = cc.origen_ubicacion, ubicacion_precision_m = cc.ubicacion_precision_m,
    ubicacion_actualizada_por = cc.ubicacion_actualizada_por, ubicacion_actualizada_el = cc.ubicacion_actualizada_el,
    vendedor_id = coalesce(v_hugo, vendedor_id),
    notas = concat_ws(E'\n', nullif(notas, ''), 'Según Sergio (17/11/2026): es la sucursal de Marketplace Av. España.')
  where id = mp.id;
  if cc.lat is not null then
    insert into vis_cliente_ubicaciones_hist (cliente_id, lat, lng, precision_m, origen, motivo, usuario_id)
    values (mp.id, cc.lat, cc.lng, cc.ubicacion_precision_m, 'gps_visita',
            'GPS de Marketplace Av. España (prospecto «Fitway – Av españa» de Hugo), corrección de Sergio (TI-0115, 17/11/2026)', cc.ubicacion_actualizada_por);
  end if;

  -- 2) Lo de Pacheco, de la sucursal manual a la Casa Central.
  update vis_visitas set cliente_id = cc.id where cliente_id = pa.id;
  update vis_ruta_paradas rp set cliente_id = cc.id where rp.cliente_id = pa.id
    and not exists (select 1 from vis_ruta_paradas x where x.ruta_id = rp.ruta_id and x.cliente_id = cc.id and x.dia = rp.dia);
  update vis_llegadas set lugar_id = cc.id where lugar_id = pa.id;
  update vis_no_visitados set lugar_id = cc.id where lugar_id = pa.id;
  update vis_clientes set lat = pa.lat, lng = pa.lng, origen_ubicacion = pa.origen_ubicacion, ubicacion_precision_m = pa.ubicacion_precision_m,
    ubicacion_actualizada_por = pa.ubicacion_actualizada_por, ubicacion_actualizada_el = pa.ubicacion_actualizada_el,
    notas = 'Según Sergio (17/11/2026): la Casa Central es la sucursal de Pacheco / Charles de Gaulle.'
  where id = cc.id;
  if pa.lat is not null then
    insert into vis_cliente_ubicaciones_hist (cliente_id, lat, lng, precision_m, origen, motivo, usuario_id)
    values (cc.id, pa.lat, pa.lng, pa.ubicacion_precision_m, 'gps_visita',
            'GPS de Pacheco / Charles de Gaulle (prospecto «Fitway – Pacheco» de Hugo), corrección de Sergio (TI-0115, 17/11/2026)', pa.ubicacion_actualizada_por);
  end if;
  update vis_clientes set activo = false,
    notas = concat_ws(E'\n', nullif(notas, ''), 'Unida con «' || cc.razon_social || '» el 17/11/2026: es el mismo local (corrección de Sergio, TI-0115).')
  where id = pa.id;

  -- Las notas de los prospectos fusionados en 0037 apuntan a donde quedaron sus visitas.
  update vis_clientes set notas = notas || E'\n' || 'Corrección 17/11/2026: la visita y la ubicación quedaron en «' || mp.razon_social || '» (Marketplace Av. España).'
  where razon_social = 'Fitway' and direccion = 'Av españa' and odoo_partner_id is null and not activo and notas like '%FITWAY-CASA CENTRAL%';
  update vis_clientes set notas = notas || E'\n' || 'Corrección 17/11/2026: la visita y la ubicación quedaron en «' || cc.razon_social || '» (Pacheco / Charles de Gaulle).'
  where razon_social = 'Fitway' and direccion = 'Pacheco' and odoo_partner_id is null and not activo and notas like '%FITWAY-PACHECO%';
end $$;
