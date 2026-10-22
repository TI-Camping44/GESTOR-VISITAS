-- Aviso al dar de alta un cliente (pedido de Facundo, 22/10): si donde se levanta la ubicación
-- hay clientes de otro vendedor de la empresa, decir de quién son (zona de otro vendedor).
-- El vendedor no ve los clientes ajenos (RLS): esta función devuelve solo nombre, vendedor y distancia.
create or replace function vis_vecinos_de_otros(p_lat double precision, p_lng double precision, p_radio_m numeric default 300)
returns table (razon_social text, vendedor text, distancia_m numeric)
language sql stable security definer set search_path = public, extensions as $$
  select c.razon_social, v.nombre,
         round(st_distance(c.ubicacion, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)::numeric)
  from vis_clientes c join vis_vendedores v on v.id = c.vendedor_id
  where vis_mi_id() is not null and c.activo and c.ubicacion is not null
    and c.vendedor_id <> vis_mi_id() and v.empresa_id = vis_mi_empresa()
    and st_dwithin(c.ubicacion, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, least(coalesce(p_radio_m, 300), 1000))
  order by 3
  limit 5
$$;
revoke execute on function vis_vecinos_de_otros(double precision, double precision, numeric) from anon, public;
grant execute on function vis_vecinos_de_otros(double precision, double precision, numeric) to authenticated;
