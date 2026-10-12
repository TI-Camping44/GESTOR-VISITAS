-- El alta de un cliente cuenta como visita (pedido de Facundo, piloto 12/10):
-- si el vendedor sale del formulario sin "Guardar visita", el cliente nuevo igual queda visitado.
-- Si completa el formulario, se actualiza esa misma visita (no se duplica).

-- Resultado propio del alta. Inactivo: no aparece para elegir en el formulario.
insert into vis_resultados (nombre, es_venta, orden, activo)
select 'Cliente nuevo', false, 90, false
where not exists (select 1 from vis_resultados where nombre = 'Cliente nuevo');

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
  v_zona uuid;
  v_visita uuid;
  v_jornada uuid;
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
  returning id, zona_id into v_id, v_zona;

  insert into vis_cliente_ubicaciones_hist (cliente_id, lat, lng, precision_m, origen, motivo, usuario_id)
  values (v_id, v_lat, v_lng, v_prec, 'gps_visita', 'Alta de prospecto', v_yo);

  -- La visita del alta: hecha en el local, con el GPS del alta.
  insert into vis_visitas (client_uuid, cliente_id, vendedor_id, zona_id, fecha_hora, lat, lng, precision_m,
    distancia_cliente_m, resultado_id, observaciones, origen)
  values (gen_random_uuid(), v_id, v_yo, v_zona, now(), v_lat, v_lng, v_prec, 0,
    (select id from vis_resultados where nombre = 'Cliente nuevo'), nullif(btrim(p ->> 'notas'), ''), 'app')
  returning id into v_visita;

  select id into v_jornada from vis_jornadas
  where vendedor_id = v_yo and inicio <= now() + interval '5 minutes' and fin is null
  order by inicio desc limit 1;
  if v_jornada is not null then
    insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng, precision_m, origen)
    values (v_jornada, v_yo, now(), v_lat, v_lng, v_prec, 'visita')
    on conflict (vendedor_id, fecha_hora) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'visita_id', v_visita);
end $$;

-- Si llega visita_id (la del alta), el formulario completa esa visita en vez de crear otra.
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
  v_alta vis_visitas;
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

  -- Visita del alta del mismo vendedor y cliente, del mismo día: se completa.
  select * into v_alta from vis_visitas
  where id = (p ->> 'visita_id')::uuid and vendedor_id = v_yo and cliente_id = v_cliente.id
    and fecha_hora > now() - interval '12 hours';
  if found then
    update vis_visitas set
      client_uuid = v_uuid,
      ruta_parada_id = coalesce(v_parada, ruta_parada_id),
      resultado_id = coalesce(v_res.id, resultado_id),
      hizo_pedido = coalesce((p ->> 'hizo_pedido')::boolean, false) or coalesce(v_res.es_venta, false),
      hizo_cobranza = coalesce((p ->> 'hizo_cobranza')::boolean, false),
      monto_cobrado_gs = case when coalesce((p ->> 'hizo_cobranza')::boolean, false) then (p ->> 'monto_cobrado_gs')::numeric end,
      observaciones = coalesce(nullif(btrim(p ->> 'observaciones'), ''), observaciones),
      proxima_visita = (p ->> 'proxima_visita')::date,
      fotos = coalesce(array(select jsonb_array_elements_text(p -> 'fotos')), '{}'),
      capturada_offline = coalesce((p ->> 'capturada_offline')::boolean, false)
    where id = v_alta.id;
    return jsonb_build_object('id', v_alta.id, 'duplicada', false, 'distancia_cliente_m', v_alta.distancia_cliente_m,
      'alerta_distancia', false);
  end if;

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
