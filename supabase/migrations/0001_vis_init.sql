-- ════════════════════════════════════════════════════════════════════
-- Gestor de Visitas (vis) — esquema inicial
-- Basado en BRIEF.md §4. Diferencias con el brief, a propósito:
--   · telefono_norm es columna generada (vis_normalizar_telefono), así el
--     sync y la app no pueden dejarla desfasada.
--   · vis_config guarda los umbrales que la base hace cumplir (precisión GPS,
--     distancia de alerta). Las VIS_* del entorno los replican para la UI.
--   · Las vistas son security_invoker: respetan el RLS del que consulta.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ── Tipos ───────────────────────────────────────────────────────────
create type vis_rol            as enum ('admin','supervisor','vendedor');
create type vis_origen_ubic    as enum ('odoo','manual','gps_visita');
create type vis_estado_ruta    as enum ('borrador','publicada','cerrada');
create type vis_origen_visita  as enum ('app','odoo_import');

-- ── Utilidades ──────────────────────────────────────────────────────
-- Teléfono → solo dígitos con 595 al frente. "0981 123-456" → "595981123456".
create or replace function vis_normalizar_telefono(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when d is null or d = '' then null
    when d like '595%' then d
    when d like '0%' then '595' || substr(d, 2)
    when length(d) = 9 and d like '9%' then '595' || d
    else d
  end
  from (select regexp_replace(coalesce(t, ''), '\D', '', 'g') as d) x
$$;

-- Texto para comparar nombres: minúsculas, sin acentos, sin "S.A.", "SRL", puntuación.
create or replace function vis_nombre_cmp(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
           regexp_replace(
             ' ' || regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))),
                                   '[^a-z0-9]+', ' ', 'g') || ' ',
             ' (s a|sa|s r l|srl|e i r l|eirl)(?= )', ' ', 'g'),
           ' +', ' ', 'g'))
$$;

-- Fecha de hoy en Asunción.
create or replace function vis_hoy() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Asuncion')::date
$$;

-- ── Configuración que la base hace cumplir ──────────────────────────
create table vis_config (
  id                      boolean primary key default true check (id),
  gps_precision_max_m     numeric not null default 100,
  dist_alerta_m           numeric not null default 300,
  duplicado_radio_m       numeric not null default 30,
  duplicado_similitud     numeric not null default 0.4,
  track_precision_max_m   numeric not null default 200,
  jornada_cierre_auto     time    not null default '20:00',
  base_lat                double precision,
  base_lng                double precision
);
insert into vis_config default values;

-- ── Vendedores / usuarios de la app ────────────────────────────────
create table vis_vendedores (
  id                    uuid primary key default gen_random_uuid(),
  auth_user_id          uuid unique references auth.users(id) on delete set null,
  odoo_user_id          int unique,
  nombre                text not null,
  email                 text unique not null check (email = lower(email)),
  telefono              text,
  rol                   vis_rol not null default 'vendedor',
  meta_diaria           int not null default 10 check (meta_diaria > 0),
  meta_semanal          int not null default 50 check (meta_semanal > 0),
  base_lat              double precision,
  base_lng              double precision,
  tracking_aceptado_el  timestamptz,
  activo                boolean not null default true,
  created_at            timestamptz not null default now()
);

-- ── Zonas ───────────────────────────────────────────────────────────
create table vis_zonas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text unique not null,
  color       text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  poligono    extensions.geography(polygon, 4326),
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── Clientes (Odoo + prospectos propios) ───────────────────────────
create table vis_clientes (
  id                        uuid primary key default gen_random_uuid(),
  odoo_partner_id           int unique,          -- null = prospecto creado en la app
  razon_social              text not null check (btrim(razon_social) <> ''),
  ruc                       text,
  telefono                  text,
  telefono_norm             text generated always as (vis_normalizar_telefono(telefono)) stored,
  direccion                 text,
  ciudad                    text,
  departamento              text,
  zona_id                   uuid references vis_zonas(id) on delete set null,
  vendedor_id               uuid references vis_vendedores(id) on delete set null,
  -- Ubicación que viene de Odoo (referencia; la pisa el sync)
  lat_odoo                  double precision,
  lng_odoo                  double precision,
  -- Ubicación VIGENTE (la que usan mapas y rutas). Odoo nunca pisa una manual/gps_visita.
  lat                       double precision check (lat between -90 and 90),
  lng                       double precision check (lng between -180 and 180),
  ubicacion                 extensions.geography(point, 4326)
                            generated always as (
                              case when lat is not null and lng is not null
                                then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography end
                            ) stored,
  origen_ubicacion          vis_origen_ubic,
  ubicacion_precision_m     numeric,
  ubicacion_actualizada_por uuid references vis_vendedores(id) on delete set null,
  ubicacion_actualizada_el  timestamptz,
  -- Indicadores comerciales (los llena el sync)
  odoo_alta_fecha           date,
  ultima_factura_fecha      date,
  facturas_6m               int not null default 0,
  ventas_6m_gs              numeric not null default 0,
  -- Prospectos
  creado_por                uuid references vis_vendedores(id) on delete set null,
  notas                     text,
  es_ejemplo                boolean not null default false,  -- datos de prueba; se borran antes del piloto
  activo                    boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index on vis_clientes using gist (ubicacion);
create index on vis_clientes (zona_id);
create index on vis_clientes (vendedor_id);
create index on vis_clientes (creado_por);
create index on vis_clientes (telefono_norm);
create index on vis_clientes (ruc);
create index vis_clientes_nombre_trgm on vis_clientes using gin (vis_nombre_cmp(razon_social) extensions.gin_trgm_ops);

-- Historial de cada cambio de ubicación (auditoría)
create table vis_cliente_ubicaciones_hist (
  id           bigserial primary key,
  cliente_id   uuid not null references vis_clientes(id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  precision_m  numeric,
  origen       vis_origen_ubic not null,
  motivo       text,
  usuario_id   uuid references vis_vendedores(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on vis_cliente_ubicaciones_hist (cliente_id, created_at desc);

-- ── Catálogo de resultados de visita ───────────────────────────────
create table vis_resultados (
  id        serial primary key,
  nombre    text unique not null,
  es_venta  boolean not null default false,
  activo    boolean not null default true,
  orden     int not null default 0
);
-- Semilla tomada de las observaciones que ya cargan los vendedores en Odoo.
-- Se ajusta cuando se corra el descubrimiento (docs/odoo-campos.md).
insert into vis_resultados (nombre, es_venta, orden) values
  ('Hizo pedido', true, 1),
  ('Tiene stock', false, 2),
  ('No se encontraba el comprador', false, 3),
  ('Precios altos / Falta de descuento', false, 4),
  ('Cobranza', false, 5),
  ('Local cerrado', false, 6),
  ('Otro', false, 99);

-- ── Rutas ───────────────────────────────────────────────────────────
create table vis_rutas (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,                 -- "Ruta Norte – Sem 42 – Antonio"
  vendedor_id   uuid not null references vis_vendedores(id),
  zona_id       uuid references vis_zonas(id) on delete set null,
  semana_inicio date not null check (extract(isodow from semana_inicio) = 1), -- lunes
  estado        vis_estado_ruta not null default 'borrador',
  notas         text,
  creado_por    uuid references vis_vendedores(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (vendedor_id, semana_inicio, nombre)
);
create index on vis_rutas (vendedor_id, semana_inicio);
create index on vis_rutas (zona_id);

create table vis_ruta_paradas (
  id          uuid primary key default gen_random_uuid(),
  ruta_id     uuid not null references vis_rutas(id) on delete cascade,
  cliente_id  uuid not null references vis_clientes(id),
  dia         date not null,
  orden       int not null default 0,
  unique (ruta_id, cliente_id, dia)
);
create index on vis_ruta_paradas (dia);
create index on vis_ruta_paradas (cliente_id);

-- Las paradas tienen que caer en la semana de su ruta (lunes a domingo).
create or replace function vis_parada_en_semana() returns trigger
language plpgsql set search_path = public as $$
declare v_semana date;
begin
  select semana_inicio into v_semana from vis_rutas where id = new.ruta_id;
  if new.dia < v_semana or new.dia > v_semana + 6 then
    raise exception 'La parada del % no cae en la semana de la ruta (desde el %).',
      to_char(new.dia, 'DD/MM/YYYY'), to_char(v_semana, 'DD/MM/YYYY');
  end if;
  return new;
end $$;
create trigger vis_ruta_paradas_semana before insert or update on vis_ruta_paradas
  for each row execute function vis_parada_en_semana();

-- ── Visitas ─────────────────────────────────────────────────────────
create table vis_visitas (
  id                   uuid primary key default gen_random_uuid(),
  client_uuid          uuid unique,         -- idempotencia de la cola offline
  cliente_id           uuid not null references vis_clientes(id),
  vendedor_id          uuid references vis_vendedores(id),
  ruta_parada_id       uuid references vis_ruta_paradas(id) on delete set null,
  zona_id              uuid references vis_zonas(id) on delete set null,  -- zona al momento de la visita
  fecha_hora           timestamptz not null default now(),
  lat                  double precision,
  lng                  double precision,
  precision_m          numeric,
  distancia_cliente_m  numeric,
  resultado_id         int references vis_resultados(id),
  hizo_pedido          boolean not null default false,
  hizo_cobranza        boolean not null default false,
  monto_cobrado_gs     numeric check (monto_cobrado_gs is null or monto_cobrado_gs >= 0),
  observaciones        text,
  proxima_visita       date,
  fotos                text[] not null default '{}',     -- paths en Storage
  origen               vis_origen_visita not null default 'app',
  odoo_visita_id       int unique,                       -- si viene de x_reportes_de_visita
  capturada_offline    boolean not null default false,
  created_at           timestamptz not null default now()
);
create index on vis_visitas (vendedor_id, fecha_hora);
create index on vis_visitas (cliente_id, fecha_hora desc);
create index on vis_visitas (zona_id, fecha_hora desc);
create index on vis_visitas (ruta_parada_id);

-- ── Seguimiento GPS del vendedor (jornada) ─────────────────────────
create table vis_jornadas (
  id            uuid primary key default gen_random_uuid(),
  vendedor_id   uuid not null references vis_vendedores(id),
  inicio        timestamptz not null default now(),
  fin           timestamptz,
  inicio_lat    double precision,
  inicio_lng    double precision,
  km_recorridos numeric,                      -- se calcula al cerrar la jornada
  cierre_auto   boolean not null default false, -- true si la cerró el sistema (olvido)
  check (fin is null or fin >= inicio)
);
create unique index vis_jornada_abierta_unica
  on vis_jornadas (vendedor_id) where fin is null;  -- una sola jornada abierta por vendedor
create index on vis_jornadas (vendedor_id, inicio desc);

create table vis_posiciones (
  id            bigserial primary key,
  jornada_id    uuid not null references vis_jornadas(id) on delete cascade,
  vendedor_id   uuid not null references vis_vendedores(id),
  fecha_hora    timestamptz not null,          -- hora del dispositivo al capturar
  recibido_el   timestamptz not null default now(),
  lat           double precision not null,
  lng           double precision not null,
  precision_m   numeric,
  velocidad_kmh numeric,
  bateria_pct   int check (bateria_pct is null or bateria_pct between 0 and 100),
  origen        text not null default 'tracking' check (origen in ('tracking','visita','inicio','fin')),
  unique (vendedor_id, fecha_hora)             -- idempotencia de la cola offline
);
create index on vis_posiciones (jornada_id, fecha_hora);
create index on vis_posiciones (vendedor_id, fecha_hora desc);

-- Última posición conocida por vendedor (lo que mira el mapa en vivo)
create table vis_posicion_actual (
  vendedor_id   uuid primary key references vis_vendedores(id) on delete cascade,
  jornada_id    uuid references vis_jornadas(id) on delete set null,
  fecha_hora    timestamptz not null,
  lat           double precision not null,
  lng           double precision not null,
  precision_m   numeric,
  bateria_pct   int,
  en_jornada    boolean not null default false
);

-- Cada posición nueva actualiza la última conocida, solo si es más reciente.
create or replace function vis_posicion_a_actual() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into vis_posicion_actual as pa (vendedor_id, jornada_id, fecha_hora, lat, lng, precision_m, bateria_pct, en_jornada)
  values (new.vendedor_id, new.jornada_id, new.fecha_hora, new.lat, new.lng, new.precision_m, new.bateria_pct,
          new.origen <> 'fin' and exists (select 1 from vis_jornadas j where j.id = new.jornada_id and j.fin is null))
  on conflict (vendedor_id) do update
    set jornada_id = excluded.jornada_id, fecha_hora = excluded.fecha_hora, lat = excluded.lat, lng = excluded.lng,
        precision_m = excluded.precision_m, bateria_pct = coalesce(excluded.bateria_pct, pa.bateria_pct),
        en_jornada = excluded.en_jornada
    where pa.fecha_hora < excluded.fecha_hora;
  return null;
end $$;
create trigger vis_posiciones_actual after insert on vis_posiciones
  for each row execute function vis_posicion_a_actual();

-- ── Log de sincronización ──────────────────────────────────────────
create table vis_sync_log (
  id           bigserial primary key,
  proceso      text not null,               -- 'partners' | 'ventas' | 'visitas_odoo' | 'vendedores'
  inicio       timestamptz not null default now(),
  fin          timestamptz,
  ok           boolean,
  leidos       int,
  insertados   int,
  actualizados int,
  error        text,
  visto_por    uuid references vis_vendedores(id) on delete set null,  -- apaga el banner rojo del admin
  visto_el     timestamptz
);
create index on vis_sync_log (proceso, inicio desc);

-- ── Vista de clientes con estado (color) ───────────────────────────
create or replace view vis_clientes_v with (security_invoker = true) as
select c.*,
  case
    when c.odoo_partner_id is null then 'potencial'
    when c.ultima_factura_fecha >= (vis_hoy() - interval '6 months') then 'activo'
    when c.ultima_factura_fecha is null
         and c.odoo_alta_fecha >= (vis_hoy() - interval '6 months') then 'potencial'
    else 'inactivo'
  end as estado,
  (select max(v.fecha_hora) from vis_visitas v where v.cliente_id = c.id) as ultima_visita
from vis_clientes c
where c.activo;

-- ── Resumen diario (tablero) ───────────────────────────────────────
create or replace view vis_resumen_diario with (security_invoker = true) as
select
  v.vendedor_id,
  (date_trunc('week', v.fecha_hora at time zone 'America/Asuncion'))::date as semana_inicio,
  (v.fecha_hora at time zone 'America/Asuncion')::date                    as dia,
  count(*)                                   as visitas,
  count(*) filter (where v.hizo_pedido)      as con_pedido,
  count(*) filter (where v.ruta_parada_id is null) as fuera_de_ruta,
  count(distinct v.cliente_id)               as clientes_distintos
from vis_visitas v
where v.origen = 'app'
group by 1, 2, 3;

-- updated_at automático
create or replace function vis_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger vis_clientes_touch before update on vis_clientes
  for each row execute function vis_touch_updated_at();
