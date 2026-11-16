-- Visitas no concretadas en la venta mayorista (TI-0115, 16/11): el vendedor marca en Hoy, en una parada de su ruta,
-- que no pudo hacer la visita y por qué. Hasta ahora «No pude visitar» era solo de la visitadora médica (0032), y en
-- la venta una parada sin visita quedaba como «no visitó» sin motivo.
-- Mismo registro (vis_no_visitados), con motivos de venta. Solo sobre una parada que ya está en su ruta publicada
-- de ese día: no suma paradas (la planificación no cambia). Se ve en el tablero: realizadas, no concretadas y
-- pendientes, por día, por vendedor y por ruta (zona y semana del ciclo).

alter table vis_no_visitados drop constraint vis_no_visitados_motivo_check;
alter table vis_no_visitados add constraint vis_no_visitados_motivo_check check (motivo in (
  'sin_medicos', 'sin_acceso', 'cerrado', 'licencia', 'otro',          -- visita médica (0032); «cerrado» y «otro» también en venta
  'encargado_ausente', 'sin_tiempo', 'reprogramado'));                 -- venta

-- Texto de cada motivo (el mismo que muestra la app: lib/medicos.ts MOTIVOS_NO_VISITA y MOTIVOS_NO_VISITA_VENTA).
create or replace function vis_texto_motivo_no_visita(p_motivo text) returns text
language sql immutable as $$
  select case p_motivo
    when 'sin_medicos' then 'No había médicos'
    when 'sin_acceso' then 'Sin acceso: no me dejaron pasar'
    when 'cerrado' then 'Estaba cerrado'
    when 'licencia' then 'Médico de vacaciones o con licencia'
    when 'encargado_ausente' then 'No estaba el encargado o comprador'
    when 'sin_tiempo' then 'No me dio el tiempo'
    when 'reprogramado' then 'El cliente pidió que vuelva otro día'
    else 'Otro motivo' end
$$;

-- p: {client_uuid, lugar_id, motivo, observaciones?, lat?, lng?, precision_m?, fecha_hora?}
-- lugar_id: un lugar de la visitadora (categoria 'lugar') o un cliente que está en la ruta publicada de ese día del vendedor.
create or replace function vis_marcar_no_visitado(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  v_uuid uuid := coalesce((p ->> 'client_uuid')::uuid, gen_random_uuid());
  v_lugar vis_clientes;
  v_motivo text := btrim(coalesce(p ->> 'motivo', ''));
  v_obs text := nullif(btrim(coalesce(p ->> 'observaciones', '')), '');
  v_fecha timestamptz := coalesce((p ->> 'fecha_hora')::timestamptz, now());
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
  v_prec numeric := (p ->> 'precision_m')::numeric;
  v_dia date;
  v_parada uuid;
  v_n vis_no_visitados;
  v_jornada uuid;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into v_n from vis_no_visitados where client_uuid = v_uuid;
  if found then return jsonb_build_object('id', v_n.id, 'parada_id', v_n.parada_id, 'duplicada', true); end if;
  if v_fecha > now() + interval '5 minutes' or v_fecha < now() - interval '2 days' then v_fecha := now(); end if;
  v_dia := (v_fecha at time zone 'America/Asuncion')::date;
  select * into v_lugar from vis_clientes where id = (p ->> 'lugar_id')::uuid and activo;
  if not found then raise exception 'No encontramos ese cliente.'; end if;
  if v_lugar.categoria = 'lugar' then
    -- Visita médica (0032): un lugar suyo; si no estaba en la ruta del día, se suma.
    if v_lugar.vendedor_id is distinct from v_yo then raise exception 'No encontramos ese lugar entre los tuyos.'; end if;
    if v_motivo not in ('sin_medicos', 'sin_acceso', 'cerrado', 'licencia', 'otro') then raise exception 'Elegí el motivo.'; end if;
    v_parada := vis_parada_del_dia(v_yo, v_lugar.id, v_dia);
  else
    -- Venta: solo una parada de su ruta publicada de ese día.
    select pa.id into v_parada from vis_ruta_paradas pa join vis_rutas r on r.id = pa.ruta_id
    where r.vendedor_id = v_yo and r.estado in ('publicada', 'cerrada') and pa.cliente_id = v_lugar.id and pa.dia = v_dia
    order by pa.orden limit 1;
    if v_parada is null then raise exception 'Ese cliente no está en tu ruta de hoy.'; end if;
    if v_motivo not in ('cerrado', 'encargado_ausente', 'sin_tiempo', 'reprogramado', 'otro') then raise exception 'Elegí el motivo.'; end if;
  end if;
  if v_motivo = 'otro' and v_obs is null then raise exception 'Escribí qué pasó.'; end if;
  insert into vis_no_visitados (client_uuid, vendedor_id, lugar_id, parada_id, fecha_hora, motivo, observaciones, lat, lng, precision_m)
  values (v_uuid, v_yo, v_lugar.id, v_parada, v_fecha, v_motivo, v_obs, v_lat, v_lng, v_prec)
  returning * into v_n;
  -- Con la jornada abierta, también mueve su punto en En vivo.
  if v_lat is not null and v_lng is not null then
    select id into v_jornada from vis_jornadas where vendedor_id = v_yo and fin is null order by inicio desc limit 1;
    if v_jornada is not null then
      insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng, precision_m, origen)
      values (v_jornada, v_yo, v_fecha, v_lat, v_lng, v_prec, 'visita') on conflict (vendedor_id, fecha_hora) do nothing;
    end if;
  end if;
  return jsonb_build_object('id', v_n.id, 'parada_id', v_n.parada_id, 'duplicada', false);
end $$;
revoke execute on function vis_marcar_no_visitado(jsonb) from anon, public;
grant execute on function vis_marcar_no_visitado(jsonb) to authenticated;

-- Tablero: suma «no_concretadas» (paradas de la ruta de ese día marcadas «No pude visitar» y sin visita).
drop function vis_tablero(date, uuid);
create function vis_tablero(p_semana date, p_vendedor uuid default null)
returns table (vendedor_id uuid, vendedor text, meta_diaria int, meta_semanal int, dia date,
               planificadas bigint, realizadas bigint, en_ruta bigint, fuera_de_ruta bigint, con_pedido bigint, no_concretadas bigint)
language sql stable security invoker set search_path = public as $$
  select vd.id, vd.nombre, vd.meta_diaria, vd.meta_semanal, d::date,
    (select count(*) from vis_ruta_paradas p join vis_rutas r on r.id = p.ruta_id
     where r.vendedor_id = vd.id and r.estado in ('publicada','cerrada') and p.dia = d::date),
    (select count(*) from vis_visitas v where v.vendedor_id = vd.id and v.origen = 'app'
       and (v.fecha_hora at time zone 'America/Asuncion')::date = d::date),
    (select count(*) from vis_visitas v where v.vendedor_id = vd.id and v.origen = 'app' and v.ruta_parada_id is not null
       and (v.fecha_hora at time zone 'America/Asuncion')::date = d::date),
    (select count(*) from vis_visitas v where v.vendedor_id = vd.id and v.origen = 'app' and v.ruta_parada_id is null
       and (v.fecha_hora at time zone 'America/Asuncion')::date = d::date),
    (select count(*) from vis_visitas v where v.vendedor_id = vd.id and v.origen = 'app' and v.hizo_pedido
       and (v.fecha_hora at time zone 'America/Asuncion')::date = d::date),
    (select count(*) from vis_ruta_paradas p join vis_rutas r on r.id = p.ruta_id
     where r.vendedor_id = vd.id and r.estado in ('publicada','cerrada') and p.dia = d::date
       and exists (select 1 from vis_no_visitados n where n.vendedor_id = vd.id and n.lugar_id = p.cliente_id
                   and (n.fecha_hora at time zone 'America/Asuncion')::date = p.dia)
       and not exists (select 1 from vis_visitas v where v.vendedor_id = vd.id and v.cliente_id = p.cliente_id
                       and (v.fecha_hora at time zone 'America/Asuncion')::date = p.dia))
  from vis_vendedores vd
  cross join generate_series(p_semana, p_semana + 5, interval '1 day') d
  where vd.activo
    and (p_vendedor is null or vd.id = p_vendedor)
    and (vis_es_supervisor() or vd.id = vis_mi_id())
    and (vd.rol = 'vendedor' or exists (select 1 from vis_visitas v where v.vendedor_id = vd.id
         and v.fecha_hora >= (p_semana::timestamp at time zone 'America/Asuncion')
         and v.fecha_hora <  ((p_semana + 7)::timestamp at time zone 'America/Asuncion')))
  order by vd.nombre, d
$$;
revoke execute on function vis_tablero(date, uuid) from anon, public;
grant execute on function vis_tablero(date, uuid) to authenticated;

-- Detalle del tablero (0029): en «En la ruta y no visitó», el motivo si lo marcó como no concretada
-- (resultado = texto del motivo, observaciones = la suya). Misma firma y columnas.
create or replace function vis_tablero_detalle(p_vendedor uuid, p_desde date, p_hasta date)
returns table (tipo text, dia date, fecha_hora timestamptz, cliente_id uuid, razon_social text, ciudad text, estado text,
               resultado text, observaciones text, motivo_no_interesa text, en_ruta boolean, ultima_anterior timestamptz, zona text)
language sql stable security invoker set search_path = public as $$
  with rango as (
    select (p_desde::timestamp at time zone 'America/Asuncion') as ini, ((p_hasta + 1)::timestamp at time zone 'America/Asuncion') as fin
  ), visitas as (
    select v.* from vis_visitas v, rango
    where v.vendedor_id = p_vendedor and v.origen = 'app' and v.fecha_hora >= rango.ini and v.fecha_hora < rango.fin
  ), paradas as (
    select pa.id, pa.dia, pa.cliente_id, r.zona_id from vis_ruta_paradas pa join vis_rutas r on r.id = pa.ruta_id
    where r.vendedor_id = p_vendedor and r.estado in ('publicada', 'cerrada') and pa.dia between p_desde and p_hasta
  )
  select 'visita', (v.fecha_hora at time zone 'America/Asuncion')::date, v.fecha_hora, c.id, c.razon_social, c.ciudad, c.estado,
         rs.nombre, v.observaciones, n.motivo, v.ruta_parada_id is not null,
         (select max(a.fecha_hora) from vis_visitas a where a.cliente_id = v.cliente_id and a.fecha_hora < v.fecha_hora), z.nombre
  from visitas v
  join vis_clientes_v c on c.id = v.cliente_id
  left join vis_resultados rs on rs.id = v.resultado_id
  left join vis_cliente_no_interesa n on n.cliente_id = c.id and n.empresa_id = vis_mi_empresa()
  left join vis_zonas z on z.id = v.zona_id
  union all
  select 'ruta', pa.dia, nv.fecha_hora, c.id, c.razon_social, c.ciudad, c.estado,
         case when nv.motivo is not null then 'No concretada: ' || vis_texto_motivo_no_visita(nv.motivo) end,
         nv.observaciones, null, true, c.ultima_visita, z.nombre
  from paradas pa
  join vis_clientes_v c on c.id = pa.cliente_id
  left join vis_zonas z on z.id = pa.zona_id
  left join lateral (
    select n.fecha_hora, n.motivo, n.observaciones from vis_no_visitados n
    where n.vendedor_id = p_vendedor and n.lugar_id = pa.cliente_id and (n.fecha_hora at time zone 'America/Asuncion')::date = pa.dia
    order by n.fecha_hora desc limit 1) nv on true
  where not exists (select 1 from visitas v where v.ruta_parada_id = pa.id
                    or (v.cliente_id = pa.cliente_id and (v.fecha_hora at time zone 'America/Asuncion')::date = pa.dia))
  union all
  select 'zona', null, null, c.id, c.razon_social, c.ciudad, c.estado, null, null, null, false, c.ultima_visita, z.nombre
  from vis_clientes_v c
  join vis_zonas z on z.id = c.zona_id
  where c.vendedor_id = p_vendedor
    and c.zona_id in (select zona_id from paradas where zona_id is not null)
    and not exists (select 1 from visitas v where v.cliente_id = c.id)
    and not exists (select 1 from paradas pa where pa.cliente_id = c.id)
  order by 1, 3, 2, 5
$$;
revoke execute on function vis_tablero_detalle(uuid, date, date) from anon, public;
grant execute on function vis_tablero_detalle(uuid, date, date) to authenticated;

-- Cumplimiento por ruta de la semana (tablero «Por ruta, zona y semana del ciclo»): cada ruta publicada o cerrada
-- con su zona y, si es de un ciclo, el ciclo y la semana del ciclo. Paradas planificadas, realizadas (con visita
-- de ese vendedor a ese cliente ese día), no concretadas (con «No pude visitar» y sin visita) y pendientes (el resto:
-- si el día ya pasó, quedó sin visitar).
create or replace function vis_tablero_rutas(p_semana date)
returns table (ruta_id uuid, ruta text, vendedor_id uuid, vendedor text, zona text, ciclo text, ciclo_semana int, ciclo_semanas int,
               planificadas bigint, realizadas bigint, no_concretadas bigint, pendientes bigint, vencidas bigint)
language sql stable security invoker set search_path = public as $$
  with p as (
    select r.id as ruta_id, pa.dia, pa.cliente_id, r.vendedor_id,
           exists (select 1 from vis_visitas v where v.vendedor_id = r.vendedor_id and v.cliente_id = pa.cliente_id
                   and v.origen = 'app' and (v.fecha_hora at time zone 'America/Asuncion')::date = pa.dia) as visitada,
           exists (select 1 from vis_no_visitados n where n.vendedor_id = r.vendedor_id and n.lugar_id = pa.cliente_id
                   and (n.fecha_hora at time zone 'America/Asuncion')::date = pa.dia) as no_concretada
    from vis_rutas r join vis_ruta_paradas pa on pa.ruta_id = r.id
    where r.semana_inicio = date_trunc('week', p_semana)::date and r.estado in ('publicada', 'cerrada')
  )
  select r.id, r.nombre, vd.id, vd.nombre, z.nombre, c.nombre,
         coalesce(r.ciclo_semana, case when c.id is not null then vis_ciclo_semana(c.inicio, c.semanas, r.semana_inicio) end), c.semanas,
         count(p.*), count(p.*) filter (where p.visitada),
         count(p.*) filter (where not p.visitada and p.no_concretada),
         count(p.*) filter (where not p.visitada and not p.no_concretada),
         count(p.*) filter (where not p.visitada and not p.no_concretada and p.dia < vis_hoy())
  from vis_rutas r
  join vis_vendedores vd on vd.id = r.vendedor_id
  left join vis_zonas z on z.id = r.zona_id
  left join vis_ciclos c on c.id = r.ciclo_id
  left join p on p.ruta_id = r.id
  where r.semana_inicio = date_trunc('week', p_semana)::date and r.estado in ('publicada', 'cerrada')
  group by r.id, r.nombre, vd.id, vd.nombre, z.nombre, c.id, c.nombre, c.inicio, c.semanas, r.ciclo_semana, r.semana_inicio
  order by z.nombre nulls last, vd.nombre, r.nombre
$$;
revoke execute on function vis_tablero_rutas(date) from anon, public;
grant execute on function vis_tablero_rutas(date) to authenticated;
