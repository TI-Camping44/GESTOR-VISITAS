-- ════════════════════════════════════════════════════════════════════
-- 1) Próximas visitas: la "próxima visita" que carga el vendedor se vuelve
--    un pendiente hasta que alguien visite al cliente.
-- 2) Ruta sugerida: candidatos de la zona de la ruta con un puntaje que
--    prioriza próximas visitas, clientes en rojo, los que más compran y los
--    que hace más tiempo no se visitan. El reparto por días lo hace la app.
-- Ambas respetan el RLS de quien consulta.
-- ════════════════════════════════════════════════════════════════════

-- Pendientes: clientes cuya ÚLTIMA visita dejó una próxima visita para hoy o antes de p_hasta.
create or replace function vis_proximas_visitas(p_hasta date default null)
returns table (cliente_id uuid, razon_social text, ciudad text, direccion text, telefono text, telefono_norm text,
               lat double precision, lng double precision, estado text, zona_id uuid, vendedor_id uuid,
               proxima_visita date, ultima_visita timestamptz, ultima_observacion text, dias_vencida int)
language sql stable security invoker set search_path = public as $$
  with ult as (
    select distinct on (v.cliente_id) v.cliente_id, v.fecha_hora, v.proxima_visita, v.observaciones
    from vis_visitas v
    order by v.cliente_id, v.fecha_hora desc
  )
  select c.id, c.razon_social, c.ciudad, c.direccion, c.telefono, c.telefono_norm, c.lat, c.lng, c.estado,
         c.zona_id, c.vendedor_id, u.proxima_visita, u.fecha_hora, u.observaciones,
         greatest(0, vis_hoy() - u.proxima_visita)
  from ult u
  join vis_clientes_v c on c.id = u.cliente_id
  where u.proxima_visita is not null
    and u.proxima_visita <= coalesce(p_hasta, vis_hoy())
  order by u.proxima_visita, c.razon_social
$$;

-- Candidatos para una ruta, con puntaje y motivos. Excluye los que ya están en la ruta y los
-- visitados en los últimos 14 días (salvo que tengan la próxima visita en esa semana).
create or replace function vis_sugerir_paradas(p_ruta uuid)
returns table (cliente_id uuid, razon_social text, ciudad text, lat double precision, lng double precision,
               estado text, puntaje numeric, motivos text[], proxima_visita date, ultima_visita timestamptz,
               ventas_6m_gs numeric)
language sql stable security invoker set search_path = public as $$
  with r as (select * from vis_rutas where id = p_ruta),
  ult as (
    select distinct on (v.cliente_id) v.cliente_id, v.fecha_hora, v.proxima_visita
    from vis_visitas v order by v.cliente_id, v.fecha_hora desc
  ),
  base as (
    select c.*, u.fecha_hora as u_fecha, u.proxima_visita as u_prox, r.semana_inicio
    from vis_clientes_v c
    cross join r
    left join ult u on u.cliente_id = c.id
    where ((r.zona_id is not null and c.zona_id = r.zona_id) or (r.zona_id is null and c.vendedor_id = r.vendedor_id))
      and not exists (select 1 from vis_ruta_paradas p where p.ruta_id = r.id and p.cliente_id = c.id)
      and (u.fecha_hora is null or u.fecha_hora < now() - interval '14 days' or u.proxima_visita <= r.semana_inicio + 6)
  ),
  ref as (  -- "compra mucho" = cuartil superior de ventas de los candidatos
    select coalesce(percentile_cont(0.75) within group (order by ventas_6m_gs) filter (where ventas_6m_gs > 0), 0) as p75 from base
  ),
  puntuado as (
    select b.*,
      (case when b.u_prox is not null and b.u_prox <= b.semana_inicio + 6 then 100 else 0 end)
      + (case when b.estado = 'inactivo' then 60 else 0 end)
      + (case when ref.p75 > 0 and b.ventas_6m_gs >= ref.p75 then 40 when b.ventas_6m_gs > 0 then 15 else 0 end)
      + (case when b.u_fecha is null then 45 else least(90, extract(day from now() - b.u_fecha))::numeric / 2 end)
      + (case when b.odoo_partner_id is null then 20 else 0 end) as pts,
      array_remove(array[
        case when b.u_prox is not null and b.u_prox < b.semana_inicio then 'Próxima visita vencida'
             when b.u_prox is not null and b.u_prox <= b.semana_inicio + 6 then 'Próxima visita esta semana' end,
        case when b.estado = 'inactivo' then 'Sin movimiento: recuperar' end,
        case when ref.p75 > 0 and b.ventas_6m_gs >= ref.p75 then 'De los que más compran' end,
        case when b.u_fecha is null then 'Nunca visitado'
             when b.u_fecha < now() - interval '60 days' then 'Sin visita hace más de 60 días' end,
        case when b.odoo_partner_id is null then 'Prospecto' end
      ], null) as mot
    from base b cross join ref
  )
  select id, razon_social, ciudad, lat, lng, estado, round(pts, 1), mot, u_prox, u_fecha, ventas_6m_gs
  from puntuado
  order by pts desc, razon_social
  limit 400
$$;

grant execute on function vis_proximas_visitas(date), vis_sugerir_paradas(uuid) to authenticated;
