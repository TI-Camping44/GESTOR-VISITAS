-- GPS en segundo plano (05/11, Sergio y Facundo): la app web solo registra posiciones con la pantalla
-- prendida (Android la pausa al bloquear el celular), así que el recorrido sale en líneas rectas.
-- Agregado, sin tocar el tracking de la app: el vendedor puede instalar Traccar Client (gratis),
-- que manda la ubicación cada minuto aunque el celular esté bloqueado, a /api/gps con su código.
-- Solo se guarda mientras su jornada está abierta (igual que el tracking de la app).

create table vis_gps_dispositivos (
  vendedor_id        uuid primary key references vis_vendedores(id) on delete cascade,
  codigo             text not null unique check (length(codigo) >= 10),
  creado_el          timestamptz not null default now(),
  ultima_recibida_el timestamptz,   -- último envío del celular (con o sin jornada abierta)
  ultima_posicion_el timestamptz    -- última posición guardada (con jornada abierta)
);
alter table vis_gps_dispositivos enable row level security;
grant select on vis_gps_dispositivos to authenticated;
create policy gps_dispositivos_select on vis_gps_dispositivos for select to authenticated
  using (vendedor_id = (select vis_mi_id()) or ((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id)));

-- Las posiciones de Traccar se distinguen de las de la app.
alter table vis_posiciones drop constraint vis_posiciones_origen_check;
alter table vis_posiciones add constraint vis_posiciones_origen_check
  check (origen in ('tracking', 'visita', 'inicio', 'fin', 'traccar'));

-- Mi código para Traccar (se crea la primera vez). p_nuevo: cambiarlo (el anterior deja de servir).
create or replace function vis_mi_gps(p_nuevo boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  v vis_gps_dispositivos;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into v from vis_gps_dispositivos where vendedor_id = v_yo;
  if not found then
    insert into vis_gps_dispositivos (vendedor_id, codigo)
    values (v_yo, 'c44' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 13)) returning * into v;
  elsif p_nuevo then
    update vis_gps_dispositivos set codigo = 'c44' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 13),
      ultima_recibida_el = null, ultima_posicion_el = null
    where vendedor_id = v_yo returning * into v;
  end if;
  return jsonb_build_object('codigo', v.codigo, 'ultima_recibida_el', v.ultima_recibida_el, 'ultima_posicion_el', v.ultima_posicion_el);
end $$;
revoke execute on function vis_mi_gps(boolean) from anon, public;
grant execute on function vis_mi_gps(boolean) to authenticated;

-- Lo llama /api/gps con la service_role (nadie más). p: [{fecha_hora, lat, lng, precision_m?, velocidad_kmh?, bateria_pct?}]
-- → {vendedor_id, recibidas, guardadas}, o null si el código no existe.
create or replace function vis_gps_recibir(p_codigo text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg vis_config;
  v_vend uuid;
  v_n int;
  v_ult timestamptz;
begin
  select d.vendedor_id into v_vend from vis_gps_dispositivos d join vis_vendedores v on v.id = d.vendedor_id
  where d.codigo = btrim(p_codigo) and v.activo;
  if v_vend is null then return null; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 1000 then raise exception 'Lote inválido (máximo 1000 posiciones).'; end if;
  select * into cfg from vis_config;
  with puntos as (
    select (e ->> 'fecha_hora')::timestamptz as fecha_hora, (e ->> 'lat')::double precision as lat,
           (e ->> 'lng')::double precision as lng, (e ->> 'precision_m')::numeric as precision_m,
           (e ->> 'velocidad_kmh')::numeric as velocidad_kmh,
           least(100, greatest(0, (e ->> 'bateria_pct')::numeric))::int as bateria_pct
    from jsonb_array_elements(p) e
  ), validos as (
    select pt.*, (
      select j.id from vis_jornadas j
      where j.vendedor_id = v_vend and j.inicio <= pt.fecha_hora and (j.fin is null or j.fin >= pt.fecha_hora)
      order by j.inicio desc limit 1) as jornada_id
    from puntos pt
    where pt.lat between -90 and 90 and pt.lng between -180 and 180 and not (pt.lat = 0 and pt.lng = 0)
      and (pt.precision_m is null or pt.precision_m <= cfg.track_precision_max_m)
      and pt.fecha_hora <= now() + interval '5 minutes' and pt.fecha_hora > now() - interval '7 days'
  ), ins as (
    insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng, precision_m, velocidad_kmh, bateria_pct, origen)
    select jornada_id, v_vend, fecha_hora, lat, lng, precision_m, velocidad_kmh, bateria_pct, 'traccar'
    from validos where jornada_id is not null
    order by fecha_hora
    on conflict (vendedor_id, fecha_hora) do nothing
    returning fecha_hora
  )
  select count(*), max(fecha_hora) into v_n, v_ult from ins;
  update vis_gps_dispositivos set ultima_recibida_el = now(),
    ultima_posicion_el = greatest(ultima_posicion_el, v_ult)
  where vendedor_id = v_vend;
  return jsonb_build_object('vendedor_id', v_vend, 'recibidas', jsonb_array_length(p), 'guardadas', v_n);
end $$;
revoke execute on function vis_gps_recibir(text, jsonb) from anon, authenticated, public;
grant execute on function vis_gps_recibir(text, jsonb) to service_role;
