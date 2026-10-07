-- ════════════════════════════════════════════════════════════════════
-- Funciones que usa la app.
-- · security definer = validan quién llama y escriben saltando RLS de
--   forma controlada (prospectos, visitas, jornada, ubicación).
-- · security invoker = consultas que respetan el RLS del que llama.
-- Los mensajes de error son para mostrarle al vendedor tal cual.
-- ════════════════════════════════════════════════════════════════════

-- ── Acceso ──────────────────────────────────────────────────────────
-- Al primer login vincula el usuario de Auth con su fila de vis_vendedores (por email).
-- Devuelve null si el email no tiene acceso → pantalla "Pedile acceso a TI".
create or replace function vis_vincular_usuario() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v vis_vendedores;
begin
  if auth.uid() is null or v_email = '' then return null; end if;

  update vis_vendedores set auth_user_id = auth.uid()
  where email = v_email and activo and auth_user_id is null;

  select * into v from vis_vendedores where auth_user_id = auth.uid() and activo;
  if not found then return null; end if;

  return jsonb_build_object('id', v.id, 'nombre', v.nombre, 'email', v.email, 'rol', v.rol,
    'meta_diaria', v.meta_diaria, 'meta_semanal', v.meta_semanal,
    'tracking_aceptado_el', v.tracking_aceptado_el);
end $$;

create or replace function vis_aceptar_tracking() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_fecha timestamptz;
begin
  update vis_vendedores set tracking_aceptado_el = coalesce(tracking_aceptado_el, now())
  where id = vis_mi_id() returning tracking_aceptado_el into v_fecha;
  if v_fecha is null then raise exception 'No tenés acceso a la app.'; end if;
  return v_fecha;
end $$;

-- ── Duplicados de clientes ─────────────────────────────────────────
-- Busca en TODOS los clientes (no solo los del vendedor) y devuelve lo mínimo para decidir.
create or replace function vis_buscar_duplicados(
  p_razon_social text, p_telefono text, p_ruc text, p_lat double precision, p_lng double precision
) returns table (id uuid, razon_social text, telefono text, ruc text, ciudad text, motivo text, distancia_m numeric)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  cfg vis_config;
  v_tel text := vis_normalizar_telefono(p_telefono);
  v_ruc text := nullif(regexp_replace(coalesce(p_ruc, ''), '[^0-9A-Za-z-]', '', 'g'), '');
  v_nombre text := vis_nombre_cmp(p_razon_social);
  v_punto geography := case when p_lat is not null and p_lng is not null
                         then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;
begin
  if vis_mi_id() is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into cfg from vis_config;

  return query
  with candidatos as (
    select c.id, c.razon_social, c.telefono, c.ruc, c.ciudad,
      case
        when v_ruc is not null and regexp_replace(coalesce(c.ruc, ''), '[^0-9A-Za-z-]', '', 'g') = v_ruc then 'Mismo RUC'
        when v_tel is not null and c.telefono_norm = v_tel then 'Mismo teléfono'
        else 'Cerca y con nombre parecido'
      end as motivo,
      case when v_punto is not null and c.ubicacion is not null
        then round(st_distance(c.ubicacion, v_punto)::numeric) end as distancia_m
    from vis_clientes c
    where c.activo and (
      (v_ruc is not null and regexp_replace(coalesce(c.ruc, ''), '[^0-9A-Za-z-]', '', 'g') = v_ruc)
      or (v_tel is not null and c.telefono_norm = v_tel)
      or (v_punto is not null and c.ubicacion is not null
          and st_dwithin(c.ubicacion, v_punto, cfg.duplicado_radio_m)
          and similarity(vis_nombre_cmp(c.razon_social), v_nombre) >= cfg.duplicado_similitud)
    )
  )
  select * from candidatos order by distancia_m nulls last limit 5;
end $$;

-- ── Alta de prospecto con geolocalización condicionada ─────────────
-- p: {razon_social, telefono, ruc?, direccion?, ciudad?, notas?, lat, lng, precision_m, forzar?}
-- Devuelve {ok:true, id} o {ok:false, duplicados:[...]} (si forzar=false y hay posibles duplicados).
create or replace function vis_crear_prospecto(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg vis_config;
  v_yo uuid := vis_mi_id();
  v_razon text := btrim(coalesce(p ->> 'razon_social', ''));
  v_tel text := btrim(coalesce(p ->> 'telefono', ''));
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
  v_prec numeric := (p ->> 'precision_m')::numeric;
  v_dups jsonb;
  v_id uuid;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into cfg from vis_config;

  if v_razon = '' then raise exception 'Falta la razón social.'; end if;
  if v_tel = '' or length(vis_normalizar_telefono(v_tel)) < 9 then raise exception 'Falta el teléfono o está incompleto.'; end if;
  if v_lat is null or v_lng is null or v_prec is null then
    raise exception 'Falta la ubicación GPS. Activá la ubicación del celular y reintentá.';
  end if;
  if v_prec > cfg.gps_precision_max_m then
    raise exception 'Precisión actual: % m. Se necesita % m o menos: reintentá al aire libre.',
      round(v_prec), round(cfg.gps_precision_max_m);
  end if;

  if not coalesce((p ->> 'forzar')::boolean, false) then
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_dups
    from vis_buscar_duplicados(v_razon, v_tel, p ->> 'ruc', v_lat, v_lng) d;
    if jsonb_array_length(v_dups) > 0 then
      return jsonb_build_object('ok', false, 'duplicados', v_dups);
    end if;
  end if;

  insert into vis_clientes (razon_social, telefono, ruc, direccion, ciudad, notas, lat, lng,
    origen_ubicacion, ubicacion_precision_m, ubicacion_actualizada_por, ubicacion_actualizada_el,
    vendedor_id, creado_por)
  values (v_razon, v_tel, nullif(btrim(p ->> 'ruc'), ''), nullif(btrim(p ->> 'direccion'), ''),
    nullif(btrim(p ->> 'ciudad'), ''), nullif(btrim(p ->> 'notas'), ''), v_lat, v_lng,
    'gps_visita', v_prec, v_yo, now(), v_yo, v_yo)
  returning id into v_id;

  insert into vis_cliente_ubicaciones_hist (cliente_id, lat, lng, precision_m, origen, motivo, usuario_id)
  values (v_id, v_lat, v_lng, v_prec, 'gps_visita', 'Alta de prospecto', v_yo);

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ── Corrección de ubicación (solo en nuestro sistema, nunca en Odoo) ─
-- Vendedor: solo origen 'gps_visita' y sobre clientes que puede ver.
-- Supervisor/admin: también 'manual' (arrastrar el pin), con motivo obligatorio.
create or replace function vis_actualizar_ubicacion(
  p_cliente uuid, p_lat double precision, p_lng double precision,
  p_precision numeric, p_origen vis_origen_ubic, p_motivo text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  cfg vis_config;
  v_yo uuid := vis_mi_id();
  v_sup boolean := vis_es_supervisor();
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into cfg from vis_config;
  if p_origen = 'odoo' then raise exception 'La ubicación de Odoo solo la escribe el sync.'; end if;
  if p_origen = 'manual' and not v_sup then raise exception 'Solo un supervisor puede mover el pin a mano.'; end if;
  if p_origen = 'manual' and btrim(coalesce(p_motivo, '')) = '' then raise exception 'Indicá el motivo de la corrección.'; end if;
  if not v_sup and not vis_puede_ver_cliente(p_cliente) then raise exception 'No tenés asignado este cliente.'; end if;
  if p_origen = 'gps_visita' and (p_precision is null or p_precision > cfg.gps_precision_max_m) then
    raise exception 'Precisión actual: % m. Se necesita % m o menos: reintentá al aire libre.',
      coalesce(round(p_precision)::text, '?'), round(cfg.gps_precision_max_m);
  end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Coordenadas inválidas.'; end if;

  update vis_clientes set lat = p_lat, lng = p_lng, origen_ubicacion = p_origen,
    ubicacion_precision_m = p_precision, ubicacion_actualizada_por = v_yo, ubicacion_actualizada_el = now()
  where id = p_cliente;
  if not found then raise exception 'Cliente inexistente.'; end if;

  insert into vis_cliente_ubicaciones_hist (cliente_id, lat, lng, precision_m, origen, motivo, usuario_id)
  values (p_cliente, p_lat, p_lng, p_precision, p_origen, nullif(btrim(p_motivo), ''), v_yo);
end $$;

-- ── Visitas ─────────────────────────────────────────────────────────
-- p: {client_uuid, cliente_id, ruta_parada_id?, fecha_hora?, lat?, lng?, precision_m?, resultado_id?,
--     hizo_pedido?, hizo_cobranza?, monto_cobrado_gs?, observaciones?, proxima_visita?, fotos?, capturada_offline?}
-- Idempotente por client_uuid: reenviar la misma visita devuelve la existente.
create or replace function vis_registrar_visita(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg vis_config;
  v_yo uuid := vis_mi_id();
  v_uuid uuid := (p ->> 'client_uuid')::uuid;
  v_cliente vis_clientes;
  v_parada uuid := (p ->> 'ruta_parada_id')::uuid;
  v_fecha timestamptz := coalesce((p ->> 'fecha_hora')::timestamptz, now());
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
  v_prec numeric := (p ->> 'precision_m')::numeric;
  v_dist numeric;
  v_res vis_resultados;
  v_existente vis_visitas;
  v_id uuid;
  v_jornada uuid;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  if v_uuid is null then raise exception 'Falta client_uuid.'; end if;
  select * into cfg from vis_config;

  select * into v_existente from vis_visitas where client_uuid = v_uuid;
  if found then
    return jsonb_build_object('id', v_existente.id, 'duplicada', true,
      'distancia_cliente_m', v_existente.distancia_cliente_m,
      'alerta_distancia', coalesce(v_existente.distancia_cliente_m > cfg.dist_alerta_m, false));
  end if;

  select * into v_cliente from vis_clientes where id = (p ->> 'cliente_id')::uuid;
  if not found then raise exception 'Cliente inexistente.'; end if;
  if not vis_es_supervisor() and not vis_puede_ver_cliente(v_cliente.id) then
    raise exception 'No tenés asignado este cliente.';
  end if;
  if v_fecha > now() + interval '5 minutes' then raise exception 'La hora de la visita está en el futuro: revisá la hora del celular.'; end if;
  if v_fecha < now() - interval '7 days' then raise exception 'La visita tiene más de 7 días: cargala desde el panel.'; end if;

  if v_parada is not null and not exists (
    select 1 from vis_ruta_paradas rp join vis_rutas r on r.id = rp.ruta_id
    where rp.id = v_parada and rp.cliente_id = v_cliente.id and (r.vendedor_id = v_yo or vis_es_supervisor())
  ) then
    v_parada := null;  -- parada ajena o de otro cliente: se registra como visita fuera de ruta
  end if;

  if v_lat is not null and v_lng is not null and v_cliente.ubicacion is not null then
    v_dist := round(st_distance(v_cliente.ubicacion, st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography)::numeric);
  end if;

  select * into v_res from vis_resultados where id = (p ->> 'resultado_id')::int;

  insert into vis_visitas (client_uuid, cliente_id, vendedor_id, ruta_parada_id, zona_id, fecha_hora, lat, lng,
    precision_m, distancia_cliente_m, resultado_id, hizo_pedido, hizo_cobranza, monto_cobrado_gs, observaciones,
    proxima_visita, fotos, origen, capturada_offline)
  values (v_uuid, v_cliente.id, v_yo, v_parada, v_cliente.zona_id, v_fecha, v_lat, v_lng, v_prec, v_dist,
    v_res.id, coalesce((p ->> 'hizo_pedido')::boolean, false) or coalesce(v_res.es_venta, false),
    coalesce((p ->> 'hizo_cobranza')::boolean, false),
    case when coalesce((p ->> 'hizo_cobranza')::boolean, false) then (p ->> 'monto_cobrado_gs')::numeric end,
    nullif(btrim(p ->> 'observaciones'), ''), (p ->> 'proxima_visita')::date,
    coalesce(array(select jsonb_array_elements_text(p -> 'fotos')), '{}'),
    'app', coalesce((p ->> 'capturada_offline')::boolean, false))
  returning id into v_id;

  -- Cada visita deja un punto en el recorrido si cae dentro de una jornada del vendedor.
  if v_lat is not null and v_lng is not null then
    select id into v_jornada from vis_jornadas
    where vendedor_id = v_yo and inicio <= v_fecha + interval '5 minutes' and (fin is null or fin >= v_fecha)
    order by inicio desc limit 1;
    if v_jornada is not null then
      insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng, precision_m, origen)
      values (v_jornada, v_yo, v_fecha, v_lat, v_lng, v_prec, 'visita')
      on conflict (vendedor_id, fecha_hora) do nothing;
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'duplicada', false, 'distancia_cliente_m', v_dist,
    'alerta_distancia', coalesce(v_dist > cfg.dist_alerta_m, false));
end $$;

-- ── Jornada y tracking ──────────────────────────────────────────────
create or replace function vis_km_jornada(p_jornada uuid) returns numeric
language sql stable set search_path = public, extensions as $$
  select round(coalesce(sum(st_distance(
           st_setsrid(st_makepoint(lng, lat), 4326)::geography,
           st_setsrid(st_makepoint(prev_lng, prev_lat), 4326)::geography)), 0)::numeric / 1000, 2)
  from (
    select lat, lng, lag(lat) over w as prev_lat, lag(lng) over w as prev_lng
    from vis_posiciones where jornada_id = p_jornada
    window w as (order by fecha_hora)
  ) t
  where prev_lat is not null
$$;

-- p_*: posición del momento (opcional: sin GPS igual se abre la jornada).
create or replace function vis_iniciar_jornada(
  p_lat double precision default null, p_lng double precision default null,
  p_precision numeric default null, p_bateria int default null
) returns vis_jornadas
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  j vis_jornadas;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  if (select tracking_aceptado_el from vis_vendedores where id = v_yo) is null then
    raise exception 'Primero tenés que aceptar el aviso de ubicación.';
  end if;

  select * into j from vis_jornadas where vendedor_id = v_yo and fin is null;
  if found then return j; end if;  -- ya estaba abierta

  insert into vis_jornadas (vendedor_id, inicio_lat, inicio_lng) values (v_yo, p_lat, p_lng) returning * into j;
  if p_lat is not null and p_lng is not null then
    insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng, precision_m, bateria_pct, origen)
    values (j.id, v_yo, j.inicio, p_lat, p_lng, p_precision, p_bateria, 'inicio')
    on conflict (vendedor_id, fecha_hora) do nothing;
  end if;
  return j;
end $$;

-- p: [{fecha_hora, lat, lng, precision_m?, velocidad_kmh?, bateria_pct?, origen?}, ...]
-- Solo guarda puntos que caen dentro de una jornada del vendedor (sin jornada → nada).
-- Idempotente por (vendedor_id, fecha_hora). Devuelve cuántos insertó.
create or replace function vis_subir_posiciones(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  cfg vis_config;
  v_yo uuid := vis_mi_id();
  v_n int;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 1000 then raise exception 'Lote inválido (máximo 1000 posiciones).'; end if;
  select * into cfg from vis_config;

  with puntos as (
    select (e ->> 'fecha_hora')::timestamptz as fecha_hora, (e ->> 'lat')::double precision as lat,
           (e ->> 'lng')::double precision as lng, (e ->> 'precision_m')::numeric as precision_m,
           (e ->> 'velocidad_kmh')::numeric as velocidad_kmh, (e ->> 'bateria_pct')::int as bateria_pct,
           coalesce(nullif(e ->> 'origen', ''), 'tracking') as origen
    from jsonb_array_elements(p) e
  ), validos as (
    select pt.*, (
      select j.id from vis_jornadas j
      where j.vendedor_id = v_yo and j.inicio <= pt.fecha_hora + interval '1 minute'
        and (j.fin is null or j.fin >= pt.fecha_hora - interval '1 minute')
      order by j.inicio desc limit 1) as jornada_id
    from puntos pt
    where pt.lat between -90 and 90 and pt.lng between -180 and 180
      and (pt.precision_m is null or pt.precision_m <= cfg.track_precision_max_m)
      and pt.fecha_hora <= now() + interval '5 minutes'
      and pt.origen in ('tracking','visita','inicio','fin')
  ), ins as (
    insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng, precision_m, velocidad_kmh, bateria_pct, origen)
    select jornada_id, v_yo, fecha_hora, lat, lng, precision_m, velocidad_kmh, bateria_pct, origen
    from validos where jornada_id is not null
    order by fecha_hora
    on conflict (vendedor_id, fecha_hora) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $$;

create or replace function vis_terminar_jornada(
  p_lat double precision default null, p_lng double precision default null,
  p_precision numeric default null, p_bateria int default null
) returns vis_jornadas
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  j vis_jornadas;
  v_fin timestamptz := now();
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into j from vis_jornadas where vendedor_id = v_yo and fin is null;
  if not found then raise exception 'No tenés una jornada abierta.'; end if;

  if p_lat is not null and p_lng is not null then
    insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng, precision_m, bateria_pct, origen)
    values (j.id, v_yo, v_fin, p_lat, p_lng, p_precision, p_bateria, 'fin')
    on conflict (vendedor_id, fecha_hora) do nothing;
  end if;

  update vis_jornadas set fin = v_fin, km_recorridos = vis_km_jornada(j.id) where id = j.id returning * into j;
  update vis_posicion_actual set en_jornada = false where vendedor_id = v_yo;
  return j;
end $$;

-- Cierra las jornadas olvidadas abiertas. La llama pg_cron (0004).
-- Una jornada se cierra cuando pasó la hora de cierre de su día (20:00 por defecto)
-- o es de un día anterior. fin = última posición, o la hora de cierre si es más tarde.
create or replace function vis_cerrar_jornadas_olvidadas() returns int
language plpgsql security definer set search_path = public as $$
declare
  cfg vis_config;
  r record;
  v_n int := 0;
begin
  select * into cfg from vis_config;
  for r in
    select j.id, j.vendedor_id, j.inicio,
      ((j.inicio at time zone 'America/Asuncion')::date + cfg.jornada_cierre_auto) at time zone 'America/Asuncion' as corte,
      (select max(p.fecha_hora) from vis_posiciones p where p.jornada_id = j.id) as ultima
    from vis_jornadas j where j.fin is null
  loop
    if (r.corte > r.inicio and now() >= r.corte)
       or (r.inicio at time zone 'America/Asuncion')::date < vis_hoy() then
      update vis_jornadas
      set fin = greatest(r.inicio, coalesce(r.ultima, r.inicio), case when r.corte > r.inicio then least(r.corte, now()) else r.inicio end),
          cierre_auto = true, km_recorridos = vis_km_jornada(r.id)
      where id = r.id;
      update vis_posicion_actual set en_jornada = false where vendedor_id = r.vendedor_id and jornada_id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- ── Consultas (respetan RLS) ───────────────────────────────────────
-- "Cerca mío": clientes visibles a menos de p_radio_m metros.
create or replace function vis_clientes_cercanos(p_lat double precision, p_lng double precision, p_radio_m numeric default 5000)
returns table (id uuid, razon_social text, telefono text, telefono_norm text, ciudad text, lat double precision,
               lng double precision, estado text, ultima_visita timestamptz, distancia_m numeric)
language sql stable security invoker set search_path = public, extensions as $$
  select c.id, c.razon_social, c.telefono, c.telefono_norm, c.ciudad, c.lat, c.lng, c.estado, c.ultima_visita,
         round(st_distance(c.ubicacion, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)::numeric)
  from vis_clientes_v c
  where c.ubicacion is not null
    and st_dwithin(c.ubicacion, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, least(p_radio_m, 50000))
  order by 10
  limit 300
$$;

-- Requerimiento 2: lo hecho en una zona en los últimos N días, una fila por cliente.
create or replace function vis_zona_historial(p_zona uuid, p_dias int default 60)
returns table (cliente_id uuid, razon_social text, ciudad text, estado text, visitas bigint,
               ultima_visita timestamptz, ultimo_resultado text, ultima_observacion text, ultimo_vendedor text,
               hizo_pedido bigint)
language sql stable security invoker set search_path = public as $$
  with v as (
    select v.*, r.nombre as resultado, vd.nombre as vendedor,
           row_number() over (partition by v.cliente_id order by v.fecha_hora desc) as rn
    from vis_visitas v
    left join vis_resultados r on r.id = v.resultado_id
    left join vis_vendedores vd on vd.id = v.vendedor_id
    where v.zona_id = p_zona and v.fecha_hora >= now() - make_interval(days => p_dias)
  )
  select c.id, c.razon_social, c.ciudad, c.estado,
         (select count(*) from v v2 where v2.cliente_id = c.id),
         u.fecha_hora, u.resultado,
         (select v3.observaciones from v v3 where v3.cliente_id = c.id and v3.observaciones is not null order by v3.fecha_hora desc limit 1),
         u.vendedor,
         (select count(*) from v v4 where v4.cliente_id = c.id and v4.hizo_pedido)
  from v u
  join vis_clientes_v c on c.id = u.cliente_id
  where u.rn = 1
  order by u.fecha_hora desc
$$;

-- Paradas de un día para un vendedor, con estado del cliente y lo último que pasó.
create or replace function vis_paradas_dia(p_dia date default null, p_vendedor uuid default null)
returns table (parada_id uuid, ruta_id uuid, ruta_nombre text, orden int, cliente_id uuid, razon_social text,
               telefono text, telefono_norm text, direccion text, ciudad text, lat double precision, lng double precision,
               estado text, ultima_visita timestamptz, ultimo_resultado text, ultima_observacion text,
               visitada boolean)
language sql stable security invoker set search_path = public as $$
  select p.id, r.id, r.nombre, p.orden, c.id, c.razon_social, c.telefono, c.telefono_norm, c.direccion, c.ciudad,
         c.lat, c.lng, c.estado, c.ultima_visita,
         (select rs.nombre from vis_visitas v join vis_resultados rs on rs.id = v.resultado_id
          where v.cliente_id = c.id order by v.fecha_hora desc limit 1),
         (select v.observaciones from vis_visitas v
          where v.cliente_id = c.id and v.observaciones is not null order by v.fecha_hora desc limit 1),
         exists (select 1 from vis_visitas v where v.ruta_parada_id = p.id)
           or exists (select 1 from vis_visitas v where v.cliente_id = c.id and v.vendedor_id = r.vendedor_id
                      and (v.fecha_hora at time zone 'America/Asuncion')::date = p.dia)
  from vis_ruta_paradas p
  join vis_rutas r on r.id = p.ruta_id
  join vis_clientes_v c on c.id = p.cliente_id
  where p.dia = coalesce(p_dia, vis_hoy())
    and r.vendedor_id = coalesce(p_vendedor, vis_mi_id())
    and r.estado in ('publicada','cerrada')
  order by p.orden, c.razon_social
$$;

-- Requerimiento 3: tablero semanal. Una fila por vendedor y día (lunes a sábado).
create or replace function vis_tablero(p_semana date, p_vendedor uuid default null)
returns table (vendedor_id uuid, vendedor text, meta_diaria int, meta_semanal int, dia date,
               planificadas bigint, realizadas bigint, en_ruta bigint, fuera_de_ruta bigint, con_pedido bigint)
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
       and (v.fecha_hora at time zone 'America/Asuncion')::date = d::date)
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

-- ── Permisos de ejecución ──────────────────────────────────────────
revoke execute on all functions in schema public from anon, public;
grant execute on function
  vis_vincular_usuario(), vis_aceptar_tracking(),
  vis_buscar_duplicados(text, text, text, double precision, double precision),
  vis_crear_prospecto(jsonb),
  vis_actualizar_ubicacion(uuid, double precision, double precision, numeric, vis_origen_ubic, text),
  vis_registrar_visita(jsonb),
  vis_iniciar_jornada(double precision, double precision, numeric, int),
  vis_subir_posiciones(jsonb),
  vis_terminar_jornada(double precision, double precision, numeric, int),
  vis_clientes_cercanos(double precision, double precision, numeric),
  vis_zona_historial(uuid, int),
  vis_paradas_dia(date, uuid),
  vis_tablero(date, uuid),
  vis_km_jornada(uuid)
to authenticated;
-- vis_cerrar_jornadas_olvidadas: solo pg_cron / service_role.
