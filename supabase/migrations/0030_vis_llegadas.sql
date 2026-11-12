-- Llegadas de la visitadora (12/11, Sergio): Noelia arma su ruta en la calle. Cuando llega a un lugar (nuevo o
-- ya cargado) marca «Llegué acá»: queda la hora y el GPS de ese momento, el lugar se suma solo a su ruta de hoy
-- (y si no tiene ruta en la semana, se crea), y Sergio lo ve en En vivo, en el recorrido y en el ruteo.
-- También cuenta como llegada dar de alta un lugar parada ahí, y una visita a un lugar que no estaba en la ruta
-- se suma sola a la ruta del día.

create table vis_llegadas (
  id          uuid primary key default gen_random_uuid(),
  client_uuid uuid unique,                    -- idempotencia (reintentos del celular)
  vendedor_id uuid not null references vis_vendedores(id) on delete cascade,
  lugar_id    uuid not null references vis_clientes(id) on delete cascade,
  parada_id   uuid references vis_ruta_paradas(id) on delete set null,
  fecha_hora  timestamptz not null default now(),
  lat         double precision,
  lng         double precision,
  precision_m numeric,
  created_at  timestamptz not null default now()
);
create index on vis_llegadas (vendedor_id, fecha_hora desc);
create index on vis_llegadas (lugar_id, fecha_hora desc);
alter table vis_llegadas enable row level security;
grant select on vis_llegadas to authenticated;
create policy llegadas_select on vis_llegadas for select to authenticated
  using (vendedor_id = (select vis_mi_id()) or ((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id)));

-- La parada de un lugar en la ruta del día del vendedor: si no está, se agrega al final; si no hay ruta esa
-- semana, se crea publicada. Solo la usan las funciones de abajo (no se expone).
create or replace function vis_parada_del_dia(p_vendedor uuid, p_lugar uuid, p_dia date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_semana date := date_trunc('week', p_dia)::date;
  v_ruta uuid;
  v_parada uuid;
  v_nombre text;
begin
  select pa.id into v_parada from vis_ruta_paradas pa join vis_rutas r on r.id = pa.ruta_id
  where r.vendedor_id = p_vendedor and pa.cliente_id = p_lugar and pa.dia = p_dia and r.estado in ('publicada', 'cerrada')
  limit 1;
  if v_parada is not null then return v_parada; end if;
  select id into v_ruta from vis_rutas where vendedor_id = p_vendedor and semana_inicio = v_semana order by created_at limit 1;
  if v_ruta is null then
    select split_part(nombre, ' ', 1) into v_nombre from vis_vendedores where id = p_vendedor;
    insert into vis_rutas (nombre, vendedor_id, semana_inicio, estado, creado_por)
    values (format('Visita médica – Sem %s – %s', extract(week from v_semana)::int, v_nombre), p_vendedor, v_semana, 'publicada', p_vendedor)
    returning id into v_ruta;
  else
    update vis_rutas set estado = 'publicada' where id = v_ruta and estado = 'borrador';
  end if;
  insert into vis_ruta_paradas (ruta_id, cliente_id, dia, orden)
  values (v_ruta, p_lugar, p_dia, coalesce((select max(orden) from vis_ruta_paradas where ruta_id = v_ruta and dia = p_dia), 0) + 1)
  on conflict (ruta_id, cliente_id, dia) do update set orden = vis_ruta_paradas.orden
  returning id into v_parada;
  return v_parada;
end $$;
revoke execute on function vis_parada_del_dia(uuid, uuid, date) from anon, authenticated, public;

-- «Llegué acá». p: {client_uuid, lugar_id, lat?, lng?, precision_m?, fecha_hora?} → {id, parada_id, ubicacion_guardada}
create or replace function vis_marcar_llegada(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg vis_config;
  v_yo uuid := vis_mi_id();
  v_uuid uuid := coalesce((p ->> 'client_uuid')::uuid, gen_random_uuid());
  v_lugar vis_clientes;
  v_fecha timestamptz := coalesce((p ->> 'fecha_hora')::timestamptz, now());
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
  v_prec numeric := (p ->> 'precision_m')::numeric;
  v_parada uuid;
  v_ll vis_llegadas;
  v_ubic boolean := false;
  v_jornada uuid;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into v_ll from vis_llegadas where client_uuid = v_uuid;
  if found then return jsonb_build_object('id', v_ll.id, 'parada_id', v_ll.parada_id, 'ubicacion_guardada', false, 'duplicada', true); end if;
  select * into v_lugar from vis_clientes where id = (p ->> 'lugar_id')::uuid and categoria = 'lugar' and activo;
  if not found or v_lugar.vendedor_id is distinct from v_yo then raise exception 'No encontramos ese lugar entre los tuyos.'; end if;
  if v_fecha > now() + interval '5 minutes' or v_fecha < now() - interval '2 days' then v_fecha := now(); end if;
  select * into cfg from vis_config;

  v_parada := vis_parada_del_dia(v_yo, v_lugar.id, (v_fecha at time zone 'America/Asuncion')::date);
  insert into vis_llegadas (client_uuid, vendedor_id, lugar_id, parada_id, fecha_hora, lat, lng, precision_m)
  values (v_uuid, v_yo, v_lugar.id, v_parada, v_fecha, v_lat, v_lng, v_prec) returning * into v_ll;

  -- Si el lugar todavía no tiene ubicación, se toma esta (si el GPS es bueno).
  if v_lugar.lat is null and v_lat is not null and v_lng is not null and v_prec is not null and v_prec <= cfg.gps_precision_max_m then
    update vis_clientes set lat = v_lat, lng = v_lng, origen_ubicacion = 'gps_visita', ubicacion_precision_m = v_prec,
      ubicacion_actualizada_por = v_yo, ubicacion_actualizada_el = now() where id = v_lugar.id;
    insert into vis_cliente_ubicaciones_hist (cliente_id, lat, lng, precision_m, origen, motivo, usuario_id)
    values (v_lugar.id, v_lat, v_lng, v_prec, 'gps_visita', 'Primera ubicación, tomada al llegar', v_yo);
    v_ubic := true;
  end if;

  -- Con la jornada abierta, la llegada también mueve su punto en En vivo.
  if v_lat is not null and v_lng is not null then
    select id into v_jornada from vis_jornadas where vendedor_id = v_yo and fin is null order by inicio desc limit 1;
    if v_jornada is not null then
      insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng, precision_m, origen)
      values (v_jornada, v_yo, v_fecha, v_lat, v_lng, v_prec, 'visita') on conflict (vendedor_id, fecha_hora) do nothing;
    end if;
  end if;
  return jsonb_build_object('id', v_ll.id, 'parada_id', v_parada, 'ubicacion_guardada', v_ubic, 'duplicada', false);
end $$;
revoke execute on function vis_marcar_llegada(jsonb) from anon, public;
grant execute on function vis_marcar_llegada(jsonb) to authenticated;

-- Alta de un lugar parada ahí: además cuenta como llegada (se suma a la ruta de hoy).
create or replace function vis_crear_lugar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg vis_config;
  v_yo uuid := vis_mi_id();
  v_nombre text := btrim(coalesce(p ->> 'nombre', ''));
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
  v_prec numeric := (p ->> 'precision_m')::numeric;
  v_id uuid;
  v_parada uuid;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  if v_nombre = '' then raise exception 'Falta el nombre del lugar.'; end if;
  select * into cfg from vis_config;
  if v_lat is null or v_lng is null or v_prec is null then
    raise exception 'Falta la ubicación: activá el GPS y esperá a que tome la posición.';
  end if;
  if v_prec > cfg.gps_precision_max_m then
    raise exception 'La ubicación es poco precisa (% m): esperá unos segundos o salí a cielo abierto.', round(v_prec);
  end if;
  insert into vis_clientes (razon_social, categoria, tipo_lugar, telefono, direccion, ciudad, notas, empresa_id,
    vendedor_id, creado_por, lat, lng, origen_ubicacion, ubicacion_precision_m, ubicacion_actualizada_por, ubicacion_actualizada_el)
  values (v_nombre, 'lugar', nullif(btrim(p ->> 'tipo_lugar'), ''), nullif(btrim(p ->> 'telefono'), ''),
    nullif(btrim(p ->> 'direccion'), ''), nullif(btrim(p ->> 'ciudad'), ''), nullif(btrim(p ->> 'notas'), ''),
    vis_mi_empresa(), v_yo, v_yo, v_lat, v_lng, 'gps_visita', v_prec, v_yo, now())
  returning id into v_id;
  insert into vis_cliente_ubicaciones_hist (cliente_id, lat, lng, precision_m, origen, motivo, usuario_id)
  values (v_id, v_lat, v_lng, v_prec, 'gps_visita', 'Alta de lugar', v_yo);
  v_parada := vis_parada_del_dia(v_yo, v_id, vis_hoy());
  insert into vis_llegadas (vendedor_id, lugar_id, parada_id, fecha_hora, lat, lng, precision_m)
  values (v_yo, v_id, v_parada, now(), v_lat, v_lng, v_prec);
  return jsonb_build_object('ok', true, 'id', v_id, 'parada_id', v_parada);
end $$;
revoke execute on function vis_crear_lugar(jsonb) from anon, public;
grant execute on function vis_crear_lugar(jsonb) to authenticated;

-- Visita de la visitadora a un lugar suyo que no estaba en la ruta del día: se suma sola a la ruta.
create or replace function vis_visita_suma_parada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ruta_parada_id is null and new.vendedor_id is not null
     and exists (select 1 from vis_vendedores v where v.id = new.vendedor_id and v.tipo = 'medica')
     and exists (select 1 from vis_clientes c where c.id = new.cliente_id and c.categoria = 'lugar' and c.vendedor_id = new.vendedor_id) then
    new.ruta_parada_id := vis_parada_del_dia(new.vendedor_id, new.cliente_id, (new.fecha_hora at time zone 'America/Asuncion')::date);
  end if;
  return new;
end $$;
create trigger vis_visitas_suma_parada before insert on vis_visitas
  for each row execute function vis_visita_suma_parada();

-- Ruteo de la semana: suma la hora de llegada (la primera de ese día en ese lugar).
drop function vis_ruteo_semana(uuid, date);
create function vis_ruteo_semana(p_vendedor uuid, p_semana date)
returns table (dia date, orden int, parada_id uuid, lugar_id uuid, lugar text, tipo_lugar text, direccion text, notas text,
               lat double precision, lng double precision, objetivo_id uuid, medico_id uuid, medico text, especialidad text,
               visita_id uuid, fecha_hora timestamptz, resultado text, medico_visitado text, observaciones text,
               proxima_visita date, productos jsonb, llegada timestamptz)
language sql stable security invoker set search_path = public as $$
  select pa.dia, pa.orden, pa.id, c.id, c.razon_social, c.tipo_lugar, c.direccion, c.notas, c.lat, c.lng,
         o.id, o.medico_id, m.nombre, coalesce(nullif(btrim(o.especialidad), ''), m.especialidad),
         v.id, v.fecha_hora, rs.nombre, vm.nombre, v.observaciones, v.proxima_visita, v.productos,
         (select min(l.fecha_hora) from vis_llegadas l where l.vendedor_id = r.vendedor_id and l.lugar_id = pa.cliente_id
            and (l.fecha_hora at time zone 'America/Asuncion')::date = pa.dia)
  from vis_rutas r
  join vis_ruta_paradas pa on pa.ruta_id = r.id
  join vis_clientes c on c.id = pa.cliente_id
  left join vis_parada_objetivos o on o.parada_id = pa.id
  left join vis_medicos m on m.id = o.medico_id
  left join lateral (
    select v.* from vis_visitas v left join vis_medicos x on x.id = v.medico_id
    where v.vendedor_id = r.vendedor_id and v.cliente_id = pa.cliente_id
      and (v.fecha_hora at time zone 'America/Asuncion')::date = pa.dia
      and (o.id is null
           or (o.medico_id is not null and v.medico_id = o.medico_id)
           or (o.medico_id is null and x.especialidad ilike btrim(o.especialidad)))
    order by v.fecha_hora desc limit 1) v on true
  left join vis_medicos vm on vm.id = v.medico_id
  left join vis_resultados rs on rs.id = v.resultado_id
  where r.vendedor_id = p_vendedor and r.semana_inicio = date_trunc('week', p_semana)::date
    and r.estado in ('publicada', 'cerrada', 'borrador')
  order by pa.dia, pa.orden, o.orden, m.nombre
$$;
revoke execute on function vis_ruteo_semana(uuid, date) from anon, public;
grant execute on function vis_ruteo_semana(uuid, date) to authenticated;
