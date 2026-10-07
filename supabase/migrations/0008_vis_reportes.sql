-- ════════════════════════════════════════════════════════════════════
-- Reportes: productividad por vendedor (con km y horas), motivos de las
-- visitas, cobertura por zona y clientes descuidados. Todas respetan el
-- RLS de quien consulta (un vendedor solo se ve a sí mismo).
-- Rangos de fechas en hora de Asunción, ambos extremos incluidos.
-- ════════════════════════════════════════════════════════════════════

-- Km de una jornada: si está cerrada, lo guardado; si sigue abierta, lo recorrido hasta ahora.
create or replace function vis_km_actual(j vis_jornadas) returns numeric
language sql stable set search_path = public as $$
  select coalesce(j.km_recorridos, vis_km_jornada(j.id))
$$;

-- Una fila por vendedor con todo lo que hizo en el período.
create or replace function vis_reporte_vendedores(p_desde date, p_hasta date)
returns table (
  vendedor_id uuid, vendedor text, meta_diaria int, meta_semanal int,
  dias_con_jornada bigint, horas_jornada numeric, km numeric,
  visitas bigint, dias_con_visitas bigint, clientes_distintos bigint, con_pedido bigint,
  cobranzas bigint, cobrado_gs numeric, fuera_de_ruta bigint, planificadas bigint, paradas_visitadas bigint,
  prospectos_nuevos bigint, inactivos_visitados bigint, primera_visita_prom time, ultima_visita_prom time
)
language sql stable security invoker set search_path = public as $$
  with rango as (
    select (p_desde::timestamp at time zone 'America/Asuncion') as desde,
           ((p_hasta + 1)::timestamp at time zone 'America/Asuncion') as hasta
  ),
  v as (
    select v.*, (v.fecha_hora at time zone 'America/Asuncion') as local
    from vis_visitas v, rango
    where v.origen = 'app' and v.fecha_hora >= rango.desde and v.fecha_hora < rango.hasta
  ),
  j as (
    select j.vendedor_id, (j.inicio at time zone 'America/Asuncion')::date as dia,
           extract(epoch from (coalesce(j.fin, least(now(), rango.hasta)) - j.inicio)) / 3600 as horas,
           vis_km_actual(j) as km
    from vis_jornadas j, rango
    where j.inicio >= rango.desde and j.inicio < rango.hasta
  ),
  primeras as (
    select vendedor_id, local::date as dia, min(local::time) as primera, max(local::time) as ultima
    from v group by 1, 2
  )
  select vd.id, vd.nombre, vd.meta_diaria, vd.meta_semanal,
    (select count(distinct dia) from j where j.vendedor_id = vd.id),
    round(coalesce((select sum(horas) from j where j.vendedor_id = vd.id), 0)::numeric, 1),
    round(coalesce((select sum(km) from j where j.vendedor_id = vd.id), 0), 1),
    (select count(*) from v where v.vendedor_id = vd.id),
    (select count(distinct local::date) from v where v.vendedor_id = vd.id),
    (select count(distinct cliente_id) from v where v.vendedor_id = vd.id),
    (select count(*) from v where v.vendedor_id = vd.id and v.hizo_pedido),
    (select count(*) from v where v.vendedor_id = vd.id and v.hizo_cobranza),
    coalesce((select sum(monto_cobrado_gs) from v where v.vendedor_id = vd.id), 0),
    (select count(*) from v where v.vendedor_id = vd.id and v.ruta_parada_id is null),
    (select count(*) from vis_ruta_paradas p join vis_rutas r on r.id = p.ruta_id
      where r.vendedor_id = vd.id and r.estado in ('publicada','cerrada') and p.dia between p_desde and p_hasta),
    (select count(distinct v.ruta_parada_id) from v where v.vendedor_id = vd.id and v.ruta_parada_id is not null),
    (select count(*) from vis_clientes c, rango where c.creado_por = vd.id and c.odoo_partner_id is null
      and c.created_at >= rango.desde and c.created_at < rango.hasta),
    (select count(distinct v.cliente_id) from v join vis_clientes_v c on c.id = v.cliente_id
      where v.vendedor_id = vd.id and c.estado = 'inactivo'),
    (select (avg(extract(epoch from primera)) * interval '1 second')::time from primeras p where p.vendedor_id = vd.id),
    (select (avg(extract(epoch from ultima)) * interval '1 second')::time from primeras p where p.vendedor_id = vd.id)
  from vis_vendedores vd
  where vd.activo and (vis_es_supervisor() or vd.id = vis_mi_id())
    and (vd.rol = 'vendedor' or exists (select 1 from v where v.vendedor_id = vd.id) or exists (select 1 from j where j.vendedor_id = vd.id))
  order by vd.nombre
$$;

-- Resultado de las visitas (por qué no se vendió, etc.).
create or replace function vis_reporte_resultados(p_desde date, p_hasta date, p_vendedor uuid default null)
returns table (resultado text, es_venta boolean, visitas bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(r.nombre, 'Sin resultado'), coalesce(r.es_venta, false), count(*)
  from vis_visitas v left join vis_resultados r on r.id = v.resultado_id
  where v.origen = 'app'
    and v.fecha_hora >= (p_desde::timestamp at time zone 'America/Asuncion')
    and v.fecha_hora < ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')
    and (p_vendedor is null or v.vendedor_id = p_vendedor)
  group by 1, 2
  order by 3 desc
$$;

-- Cobertura por zona: cuántos de sus clientes se visitaron en el período, y los descuidados.
create or replace function vis_reporte_zonas(p_desde date, p_hasta date)
returns table (zona_id uuid, zona text, color text, responsable text, clientes bigint, activos bigint, inactivos bigint,
               visitados bigint, visitas bigint, con_pedido bigint, sin_visita_60d bigint)
language sql stable security invoker set search_path = public as $$
  with v as (
    select v.* from vis_visitas v
    where v.fecha_hora >= (p_desde::timestamp at time zone 'America/Asuncion')
      and v.fecha_hora < ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')
  )
  select z.id, z.nombre, z.color, coalesce(vd.nombre, z.responsable),
    (select count(*) from vis_clientes_v c where c.zona_id = z.id),
    (select count(*) from vis_clientes_v c where c.zona_id = z.id and c.estado = 'activo'),
    (select count(*) from vis_clientes_v c where c.zona_id = z.id and c.estado = 'inactivo'),
    (select count(distinct v.cliente_id) from v join vis_clientes c on c.id = v.cliente_id where c.zona_id = z.id),
    (select count(*) from v join vis_clientes c on c.id = v.cliente_id where c.zona_id = z.id),
    (select count(*) from v join vis_clientes c on c.id = v.cliente_id where c.zona_id = z.id and v.hizo_pedido),
    (select count(*) from vis_clientes_v c where c.zona_id = z.id
       and (c.ultima_visita is null or c.ultima_visita < now() - interval '60 days'))
  from vis_zonas z left join vis_vendedores vd on vd.id = z.vendedor_id
  where z.activo
  order by z.nombre
$$;

-- Clientes descuidados: sin visita hace más de N días (o nunca), primero los que más importan.
create or replace function vis_clientes_sin_visita(p_dias int default 60, p_zona uuid default null)
returns table (id uuid, razon_social text, ciudad text, zona text, vendedor text, estado text,
               ultima_visita timestamptz, ultima_factura_fecha date, ventas_6m_gs numeric)
language sql stable security invoker set search_path = public as $$
  select c.id, c.razon_social, c.ciudad, z.nombre, vd.nombre, c.estado, c.ultima_visita, c.ultima_factura_fecha, c.ventas_6m_gs
  from vis_clientes_v c
  left join vis_zonas z on z.id = c.zona_id
  left join vis_vendedores vd on vd.id = c.vendedor_id
  where (c.ultima_visita is null or c.ultima_visita < now() - make_interval(days => p_dias))
    and (p_zona is null or c.zona_id = p_zona)
  order by c.ventas_6m_gs desc nulls last, c.ultima_visita nulls first, c.razon_social
  limit 500
$$;

grant execute on function
  vis_km_actual(vis_jornadas),
  vis_reporte_vendedores(date, date),
  vis_reporte_resultados(date, date, uuid),
  vis_reporte_zonas(date, date),
  vis_clientes_sin_visita(int, uuid)
to authenticated;
