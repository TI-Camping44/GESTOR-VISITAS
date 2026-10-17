-- Mis visitas (pedido de los comerciales, 17/10): en la app, cada vendedor ve a quiénes
-- visitó y qué pasó, por día. Solo sus propias visitas; el nombre del cliente sale aunque
-- después lo hayan reasignado a otro vendedor.
create or replace function vis_mis_visitas(p_desde date, p_hasta date)
returns table (
  id uuid, fecha_hora timestamptz, cliente_id uuid, razon_social text, ciudad text, telefono text, telefono_norm text,
  resultado text, es_venta boolean, hizo_pedido boolean, hizo_cobranza boolean, monto_cobrado_gs numeric,
  observaciones text, proxima_visita date, en_ruta boolean, distancia_cliente_m numeric
)
language sql stable security definer set search_path = public as $$
  select v.id, v.fecha_hora, v.cliente_id, c.razon_social, c.ciudad, c.telefono, c.telefono_norm,
         r.nombre, coalesce(r.es_venta, false), v.hizo_pedido, v.hizo_cobranza, v.monto_cobrado_gs,
         v.observaciones, v.proxima_visita, v.ruta_parada_id is not null, v.distancia_cliente_m
  from vis_visitas v
  join vis_clientes c on c.id = v.cliente_id
  left join vis_resultados r on r.id = v.resultado_id
  where v.vendedor_id = vis_mi_id()
    and v.fecha_hora >= (greatest(p_desde, p_hasta - 92)::timestamp at time zone 'America/Asuncion')
    and v.fecha_hora <  ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')
  order by v.fecha_hora desc
$$;

revoke execute on function vis_mis_visitas(date, date) from anon, public;
grant execute on function vis_mis_visitas(date, date) to authenticated;
