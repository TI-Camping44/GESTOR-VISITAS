-- Arreglo de datos (02/11): la sincronización con Odoo leía solo los primeros 1000 clientes de la app
-- (límite de filas de Supabase) y a los demás les pisaba la ubicación corregida en la calle con la de Odoo.
-- Ya se lee todo (lib/sync/odoo.ts, leerTodo). Acá se vuelve a la última ubicación tomada en la calle
-- o cargada a mano, que quedó en el historial.
with ultima as (
  select distinct on (h.cliente_id) h.cliente_id, h.lat, h.lng, h.precision_m, h.origen, h.usuario_id, h.created_at
  from vis_cliente_ubicaciones_hist h
  where h.origen in ('manual', 'gps_visita')
  order by h.cliente_id, h.created_at desc, h.id desc
)
update vis_clientes c set
  lat = u.lat, lng = u.lng, origen_ubicacion = u.origen, ubicacion_precision_m = u.precision_m,
  ubicacion_actualizada_por = u.usuario_id, ubicacion_actualizada_el = u.created_at
from ultima u
where u.cliente_id = c.id
  and (c.origen_ubicacion is null or c.origen_ubicacion not in ('manual', 'gps_visita'));
