-- Visita médica (Vitalica, 02/11): una visitadora visita médicos en hospitales, sanatorios y consultorios.
--  · vis_vendedores.tipo: 'ventas' (lo de siempre) o 'medica' (la app muestra médicos y lugares).
--  · Lugares: son clientes con categoria = 'lugar' (hospital, consultorio…), de su empresa (empresa_id),
--    así el mapa, las rutas, la cola offline y la visita siguen sirviendo igual.
--  · Médicos: no están en Odoo, los carga la visitadora. Un médico atiende en uno o más lugares
--    y en un lugar atienden varios (vis_medico_lugares).
--  · Visita a un médico: vis_visitas con medico_id y los productos presentados / muestras dejadas.
--  · Productos: lista de la empresa que carga el admin (vis_productos).
--  · Resultados de visita médica: vis_resultados.tipo = 'medica'.

-- ── Tipo de usuario ────────────────────────────────────────────────
alter table vis_vendedores add column tipo text not null default 'ventas' check (tipo in ('ventas', 'medica'));
grant insert (tipo), update (tipo) on vis_vendedores to authenticated;

-- ── Lugares ────────────────────────────────────────────────────────
alter table vis_clientes
  add column categoria text not null default 'cliente' check (categoria in ('cliente', 'lugar')),
  add column tipo_lugar text;

-- La vista de clientes suma las columnas nuevas (sucursales y lugares) al final.
create or replace view vis_clientes_v with (security_invoker = true) as
select c.id, c.odoo_partner_id, c.razon_social, c.ruc, c.telefono, c.telefono_norm, c.direccion, c.ciudad, c.departamento, c.zona_id, c.vendedor_id, c.lat_odoo, c.lng_odoo, c.lat, c.lng, c.ubicacion, c.origen_ubicacion, c.ubicacion_precision_m, c.ubicacion_actualizada_por, c.ubicacion_actualizada_el, c.odoo_alta_fecha, c.ultima_factura_fecha, c.facturas_6m, c.ventas_6m_gs, c.creado_por, c.notas, c.es_ejemplo, c.activo, c.created_at, c.updated_at,
  case
    when c.odoo_partner_id is null then 'potencial'
    when c.ultima_factura_fecha >= (vis_hoy() - interval '6 months') then 'activo'
    when c.ultima_factura_fecha is null
         and c.odoo_alta_fecha >= (vis_hoy() - interval '6 months') then 'potencial'
    else 'inactivo'
  end as estado,
  (select max(v.fecha_hora) from vis_visitas v where v.cliente_id = c.id) as ultima_visita,
  c.cliente_padre_id, c.empresa_id, c.categoria, c.tipo_lugar
from vis_clientes c
where c.activo;

-- ── Médicos ────────────────────────────────────────────────────────
create table vis_medicos (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references vis_empresas(id) on delete cascade,
  nombre          text not null check (btrim(nombre) <> ''),
  especialidad    text,
  telefono        text,
  telefono_norm   text generated always as (vis_normalizar_telefono(telefono)) stored,
  email           text,
  notas           text,
  frecuencia_dias int not null default 30 check (frecuencia_dias between 1 and 365),
  visitadora_id   uuid references vis_vendedores(id) on delete set null,
  creado_por      uuid references vis_vendedores(id) on delete set null,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on vis_medicos (empresa_id, visitadora_id);
create trigger vis_medicos_updated before update on vis_medicos for each row execute function vis_touch_updated_at();

create table vis_medico_lugares (
  medico_id  uuid not null references vis_medicos(id) on delete cascade,
  lugar_id   uuid not null references vis_clientes(id) on delete cascade,
  horario    text,
  primary key (medico_id, lugar_id)
);
create index on vis_medico_lugares (lugar_id);

-- ── Productos ──────────────────────────────────────────────────────
create table vis_productos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references vis_empresas(id) on delete cascade,
  nombre      text not null check (btrim(nombre) <> ''),
  activo      boolean not null default true,
  orden       int not null default 0,
  unique (empresa_id, nombre)
);

-- ── Visitas a médicos ──────────────────────────────────────────────
alter table vis_visitas
  add column medico_id uuid references vis_medicos(id) on delete set null,
  add column productos jsonb not null default '[]';  -- [{"producto": "…", "muestras": 2}]
create index on vis_visitas (medico_id, fecha_hora desc) where medico_id is not null;

alter table vis_resultados add column tipo text not null default 'ventas' check (tipo in ('ventas', 'medica'));
insert into vis_resultados (nombre, es_venta, orden, tipo) values
  ('Presentó productos', false, 1, 'medica'),
  ('Dejó muestras', false, 2, 'medica'),
  ('No estaba / no atendió', false, 3, 'medica'),
  ('Pidió volver otro día', false, 4, 'medica'),
  ('Otro motivo', false, 99, 'medica')
on conflict (nombre) do nothing;

-- Médicos con su última visita y sus lugares (respeta el RLS de quien consulta).
create view vis_medicos_v with (security_invoker = true) as
select m.*,
  (select max(v.fecha_hora) from vis_visitas v where v.medico_id = m.id) as ultima_visita,
  coalesce((select jsonb_agg(jsonb_build_object('lugar_id', l.lugar_id, 'nombre', c.razon_social, 'horario', l.horario) order by c.razon_social)
            from vis_medico_lugares l join vis_clientes c on c.id = l.lugar_id where l.medico_id = m.id), '[]') as lugares
from vis_medicos m
where m.activo;

-- ── Permisos ───────────────────────────────────────────────────────
alter table vis_medicos enable row level security;
alter table vis_medico_lugares enable row level security;
alter table vis_productos enable row level security;
grant select, insert, update on vis_medicos, vis_medico_lugares, vis_productos to authenticated;
grant delete on vis_medico_lugares, vis_productos to authenticated;
grant select on vis_medicos_v to authenticated;

-- La visitadora ve y edita sus médicos; el supervisor, los de su empresa.
create policy medicos_select on vis_medicos for select to authenticated
  using (empresa_id = (select vis_mi_empresa())
         and ((select vis_es_supervisor()) or visitadora_id = (select vis_mi_id()) or creado_por = (select vis_mi_id())));
create policy medicos_insert on vis_medicos for insert to authenticated
  with check (empresa_id = (select vis_mi_empresa())
              and ((select vis_es_supervisor()) or (visitadora_id = (select vis_mi_id()) and creado_por = (select vis_mi_id()))));
create policy medicos_update on vis_medicos for update to authenticated
  using (empresa_id = (select vis_mi_empresa())
         and ((select vis_es_supervisor()) or visitadora_id = (select vis_mi_id()) or creado_por = (select vis_mi_id())))
  with check (empresa_id = (select vis_mi_empresa())
              and ((select vis_es_supervisor()) or visitadora_id = (select vis_mi_id())));

-- Médico ↔ lugar: si veo el médico (y el lugar, al agregarlo).
create policy medico_lugares_select on vis_medico_lugares for select to authenticated
  using (exists (select 1 from vis_medicos m where m.id = medico_id));
create policy medico_lugares_write on vis_medico_lugares for all to authenticated
  using (exists (select 1 from vis_medicos m where m.id = medico_id))
  with check (exists (select 1 from vis_medicos m where m.id = medico_id) and exists (select 1 from vis_clientes c where c.id = lugar_id));

-- Productos: los ve la empresa; los carga su admin.
create policy productos_select on vis_productos for select to authenticated
  using (empresa_id = (select vis_mi_empresa()));
create policy productos_write on vis_productos for all to authenticated
  using ((select vis_es_admin()) and empresa_id = (select vis_mi_empresa()))
  with check ((select vis_es_admin()) and empresa_id = (select vis_mi_empresa()));

-- ── Alta de un lugar (desde la app, parado en el lugar) ─────────────
-- p: {nombre, tipo_lugar?, telefono?, direccion?, ciudad?, notas?, lat, lng, precision_m}
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
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke execute on function vis_crear_lugar(jsonb) from anon, public;
grant execute on function vis_crear_lugar(jsonb) to authenticated;

-- ── Perfil: incluye el tipo ────────────────────────────────────────
create or replace function vis_vincular_usuario() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v vis_vendedores;
  v_empresa uuid;
  v_equipo vis_equipos;
begin
  if auth.uid() is null or v_email = '' then return null; end if;

  update vis_vendedores set auth_user_id = auth.uid()
  where email = v_email and activo and auth_user_id is null;

  select * into v from vis_vendedores where auth_user_id = auth.uid() and activo;
  if not found then return null; end if;
  v_empresa := case when v.multi_empresa then coalesce(v.empresa_activa, v.empresa_id) else v.empresa_id end;
  select * into v_equipo from vis_equipos where id = v.equipo_id and empresa_id = v_empresa;

  return jsonb_build_object('id', v.id, 'nombre', v.nombre, 'email', v.email, 'rol', v.rol,
    'meta_diaria', v.meta_diaria, 'meta_semanal', v.meta_semanal,
    'tracking_aceptado_el', v.tracking_aceptado_el,
    'empresa_id', v_empresa, 'empresa', (select nombre from vis_empresas where id = v_empresa),
    'multi_empresa', v.multi_empresa, 'equipo_id', v_equipo.id, 'equipo', v_equipo.nombre, 'tipo', v.tipo);
end $$;

-- ── Visita: médico y productos ─────────────────────────────────────
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
  v_medico uuid := (p ->> 'medico_id')::uuid;
  v_productos jsonb := case when jsonb_typeof(p -> 'productos') = 'array' then p -> 'productos' else '[]'::jsonb end;
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
  if v_medico is not null and not exists (
    select 1 from vis_medicos m
    where m.id = v_medico and m.activo and m.empresa_id = vis_mi_empresa()
      and (vis_es_supervisor() or m.visitadora_id = v_yo or m.creado_por = v_yo)
  ) then
    raise exception 'No tenés asignado este médico.';
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
    proxima_visita, fotos, origen, capturada_offline, medico_id, productos)
  values (v_uuid, v_cliente.id, v_yo, v_parada, v_cliente.zona_id, v_fecha, v_lat, v_lng, v_prec, v_dist,
    v_res.id, coalesce((p ->> 'hizo_pedido')::boolean, false) or coalesce(v_res.es_venta, false),
    coalesce((p ->> 'hizo_cobranza')::boolean, false),
    case when coalesce((p ->> 'hizo_cobranza')::boolean, false) then (p ->> 'monto_cobrado_gs')::numeric end,
    nullif(btrim(p ->> 'observaciones'), ''), (p ->> 'proxima_visita')::date,
    coalesce(array(select jsonb_array_elements_text(p -> 'fotos')), '{}'),
    'app', coalesce((p ->> 'capturada_offline')::boolean, false), v_medico, v_productos)
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

-- Los lugares no generan «Altas a revisar».
create or replace function vis_alerta_alta() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_empresa uuid;
  v_dueno uuid;
  v_vecinos jsonb;
begin
  -- Solo altas hechas en la app (no lo que trae el sync de Odoo).
  if new.creado_por is null or new.odoo_partner_id is not null or new.categoria = 'lugar' then return new; end if;
  select empresa_id into v_empresa from vis_vendedores where id = new.creado_por;
  select z.vendedor_id into v_dueno from vis_zonas z where z.id = new.zona_id and z.vendedor_id <> new.creado_por;
  if new.ubicacion is not null then
    select coalesce(jsonb_agg(x order by x.distancia_m), '[]') into v_vecinos from (
      select c.id as cliente_id, c.razon_social, v.id as vendedor_id, v.nombre as vendedor,
             round(st_distance(c.ubicacion, new.ubicacion)::numeric) as distancia_m
      from vis_clientes c join vis_vendedores v on v.id = c.vendedor_id
      where c.id <> new.id and c.activo and c.ubicacion is not null and c.vendedor_id <> new.creado_por
        and v.empresa_id = v_empresa and st_dwithin(c.ubicacion, new.ubicacion, 300)
      order by 5 limit 5
    ) x;
  end if;
  if v_dueno is not null or jsonb_array_length(coalesce(v_vecinos, '[]')) > 0 then
    insert into vis_alertas_alta (cliente_id, vendedor_id, zona_id, dueno_zona_id, vecinos)
    values (new.id, new.creado_por, case when v_dueno is not null then new.zona_id end, v_dueno, coalesce(v_vecinos, '[]'));
  end if;
  return new;
end $$;

-- Mis visitas: si fue a un médico, «Médico · Lugar».
create or replace function vis_mis_visitas(p_desde date, p_hasta date)
returns table (
  id uuid, fecha_hora timestamptz, cliente_id uuid, razon_social text, ciudad text, telefono text, telefono_norm text,
  resultado text, es_venta boolean, hizo_pedido boolean, hizo_cobranza boolean, monto_cobrado_gs numeric,
  observaciones text, proxima_visita date, en_ruta boolean, distancia_cliente_m numeric
)
language sql stable security definer set search_path = public as $$
  select v.id, v.fecha_hora, v.cliente_id, coalesce(m.nombre || ' · ', '') || c.razon_social, c.ciudad, c.telefono, c.telefono_norm,
         r.nombre, coalesce(r.es_venta, false), v.hizo_pedido, v.hizo_cobranza, v.monto_cobrado_gs,
         v.observaciones, v.proxima_visita, v.ruta_parada_id is not null, v.distancia_cliente_m
  from vis_visitas v
  join vis_clientes c on c.id = v.cliente_id
  left join vis_resultados r on r.id = v.resultado_id
  left join vis_medicos m on m.id = v.medico_id
  where v.vendedor_id = vis_mi_id()
    and v.fecha_hora >= (greatest(p_desde, p_hasta - 92)::timestamp at time zone 'America/Asuncion')
    and v.fecha_hora <  ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')
  order by v.fecha_hora desc
$$;
