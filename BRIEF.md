# Brief para Claude Code — Gestor de Visitas y Rutas (C44 · vis)

> Pegá este archivo completo en Claude Code como primer mensaje (o guardalo como `BRIEF.md` en la raíz del repo y decile "leé BRIEF.md y arrancá por la Fase 0").

---

## 0. Contexto

Soy Facundo Colman, Responsable de TI de **Camping 44 S.A.** (Asunción, Paraguay). Tenemos Odoo 17 Enterprise (Odoo.sh) con un módulo de Studio "Gestión de Visitas" (`x_reportes_de_visita`, ~236 registros) donde los vendedores cargan visitas. Se quedó corto: no hay rutas, no hay zonas reales (la zona se escribe a mano en `x_name`: "Zona Norte", "Zona Este", y a veces el nombre del cliente), no hay planificación semanal ni mapas útiles.

Vamos a construir una **app web externa a Odoo** (PWA, se usa desde el celular del vendedor y desde la PC del supervisor) que:

- **Lee** de Odoo clientes, vendedores, facturación e historial de visitas.
- **Nunca escribe en Odoo** en esta etapa. Toda corrección (ubicación, zona, prospectos, rutas, visitas nuevas) vive en nuestra base (Supabase).
- Planifica rutas semanales por vendedor, registra visitas con GPS real del momento, y muestra mapas de clientes, visitas y calor.

Prefijo de área: **`vis`** (tablas `vis_*`, para no chocar con otros proyectos si se comparte el proyecto de Supabase).

### Fechas duras
| Fecha | Hito |
|---|---|
| Mié 7 – Vie 9 oct | Fase 0 + Fase 1 (MVP piloto) |
| Sáb 10 – Dom 11 oct | Carga de ruta del vendedor piloto, prueba en su celular |
| **Lun 12 – Vie 16 oct** | **Piloto con 1 vendedor** |
| Sáb 17 – Dom 18 oct | Ajustes del piloto + Fase 2 |
| **Lun 19 oct** | **Salida con todos los vendedores** |

Si algo no llega para el 12, se recorta alcance, no se mueve la fecha. El orden de prioridad está en la sección 3.

---

## 1. Stack y reglas de trabajo

- **Next.js 15** (App Router, TypeScript estricto), **Tailwind + shadcn/ui**.
- **Supabase**: Postgres + **PostGIS**, Auth, Storage (fotos), **Realtime** (mapa en vivo de vendedores), RLS en todas las tablas.
- **MapLibre GL JS** con tiles de **OpenFreeMap** (`https://tiles.openfreemap.org/styles/liberty`, sin API key). Clustering y heatmap nativos de MapLibre. Nada de Google Maps API paga.
- **Vercel** para deploy, **GitHub** para el repo (`c44-gestor-visitas`).
- **PWA**: manifest + service worker, instalable en Android, con cola offline para visitas (zonas rurales del norte sin señal: Juan Caballero, Concepción, San Pedro).
- Idioma de la UI: **español (Paraguay)**. Formato de fecha `dd/MM/yyyy`, zona horaria `America/Asuncion`. Moneda Gs. sin decimales.

### Reglas que no se negocian
1. **Credenciales de Odoo solo del lado servidor** (Route Handlers / Server Actions / cron). Nunca en el bundle del cliente, nunca `NEXT_PUBLIC_*`, nunca en el repo.
2. **Cero escrituras a Odoo.** El cliente de Odoo solo expone métodos de lectura (`search_read`, `read_group`, `fields_get`, `search_count`). Si necesitás `write`, `create` o `unlink`, pará y preguntame.
3. `fields` declarado en **todo** `search_read`. Paginar de a 500–1000.
4. many2one de Odoo vuelve como `[id, "nombre"]` o `false` → normalizar siempre.
5. Fechas de Odoo vienen en UTC → convertir a `America/Asuncion` antes de comparar.
6. Multi-compañía: pasar `context: { allowed_company_ids: [ODOO_COMPANY_ID] }` en cada llamada (el Odoo puede tener también a Vitálica).
7. Todo job programado que falle tiene que **fallar ruidoso**: registro en `vis_sync_log` con `ok=false` + aviso visible en el panel admin. Nunca fallar en silencio.
8. Trabajá por fases. Al terminar cada fase: resumen de lo hecho, cómo probarlo, y **pará** hasta que yo confirme.
9. Migraciones SQL versionadas en `supabase/migrations/`. Nada de cambios de esquema a mano.

### Variables de entorno
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # solo servidor
ODOO_URL=https://camping44.odoo.com
ODOO_DB=                          # nombre real de la base Odoo.sh (gcaceres93-camping-main-...)
ODOO_USER=                        # usuario técnico de SOLO LECTURA
ODOO_API_KEY=
ODOO_COMPANY_ID=                  # id de Camping 44 S.A.
CRON_SECRET=                      # protege /api/cron/*
VIS_GPS_PRECISION_MAX_M=100       # rechazar captura con precisión peor que esto
VIS_DIST_ALERTA_M=300             # distancia visita↔cliente que dispara sugerencia de corregir ubicación
VIS_BASE_LAT=                     # punto de salida por defecto (depósito Camping 44)
VIS_BASE_LNG=
VIS_TRACK_INTERVALO_S=60          # cada cuánto se guarda una posición en jornada
VIS_TRACK_DIST_MIN_M=50           # no guardar si se movió menos que esto (ahorra batería y filas)
VIS_SIN_SENAL_MIN=15              # minutos sin posición → el vendedor aparece en gris en el mapa
VIS_JORNADA_CIERRE_AUTO=20:00     # hora a la que se cierran solas las jornadas olvidadas
```

---

## 2. Fase 0 — Descubrimiento en Odoo (hacer PRIMERO, solo lectura)

Escribí `scripts/odoo-discovery.ts` (se corre con `npx tsx`) que use `fields_get` y un `search_read` de muestra (limit 5) para confirmar nombres técnicos y me imprima un reporte. Verificar:

**`res.partner`**: `id, name, vat, phone, mobile, street, street2, city, state_id, country_id, partner_latitude, partner_longitude, user_id, category_id, customer_rank, is_company, parent_id, commercial_partner_id, create_date, write_date, active`. Confirmar si existen `partner_latitude/longitude` (módulo `base_geolocalize`) y si hay algún campo Studio de coordenadas en el partner.

**`res.users`**: vendedores (los que aparecen como `user_id` en partners o como responsables de visitas): `id, name, login, active`.

**`account.move`**: confirmar `move_type, state, invoice_date, commercial_partner_id, amount_untaxed_signed, company_id`.

**`x_reportes_de_visita`** (campos ya conocidos):
- `x_name` (Descripción — hoy se usa como zona en texto libre)
- `x_studio_cliente`, `x_studio_date`
- `x_studio_latitud`, `x_studio_longitud` (coordenadas de la dirección del cliente)
- `x_studio_lat_visita`, `x_studio_long_visita`, `x_studio_gps_visita` (char "lat,long" con 6 decimales), `x_studio_precisin_m`, `x_studio_distancia_al_cliente_m`, `x_studio_capturado_el`, `x_studio_capturado_por`
- `x_studio_hizo_cobranza`, `x_studio_monto_cobrado`, `x_studio_foto_fachada_cliente`
- **A descubrir**: el campo del Responsable/Vendedor, el de Observaciones, Teléfono, Zona/Ciudad, Tipo de Cliente, ¿Hizo Pedido?, Próxima Visita. Listar todos los `x_studio_*` con su tipo y etiqueta.

Además: listar los valores distintos de `x_name` con su conteo (para mapear a zonas) y los valores distintos de Observaciones (para armar el catálogo de resultados).

Salida esperada: `docs/odoo-campos.md` con el mapeo confirmado. **No sigas a la Fase 1 sin que yo lo revise.**

---

## 3. Requerimientos (en orden de prioridad del negocio)

1. **Alta de cliente/prospecto con geolocalización condicionada**: vendedor, razón social, teléfono, y ubicación GPS del celular. *Condicionar* = no se guarda si:
   - falta razón social o teléfono,
   - la precisión GPS es peor que `VIS_GPS_PRECISION_MAX_M` (mostrar "precisión actual: X m, reintentar al aire libre"),
   - ya existe un cliente con el mismo RUC, mismo teléfono normalizado, o a menos de 30 m con nombre parecido (mostrar el posible duplicado y dejar elegir "es este" o "es otro").
2. **Zona de la semana**: nombre de zona, fecha de visita, observaciones. Al abrir una zona o una ruta, **ver lo que se hizo en esa misma zona en los últimos 60 días** (visitas, resultado, última observación por cliente, quién fue).
3. **Totales semanales**: visitas por día y por semana por vendedor (meta 10/día, 50/semana, configurable por vendedor), planificado vs. realizado, agrupado por ciudad/zona, y en el mapa con clustering.
4. **Colores de estado**:
   - 🟢 **Verde – Activo**: cliente de Odoo con al menos una factura publicada en los últimos 6 meses.
   - 🔵 **Azul – Potencial**: prospecto cargado en nuestro sistema (sin `odoo_partner_id`), o partner de Odoo que nunca facturó y se dio de alta hace menos de 6 meses.
   - 🔴 **Rojo – Sin movimiento**: cliente de Odoo sin facturas en los últimos 6 meses (incluye los que nunca facturaron y tienen más de 6 meses de alta).
5. **Rutas con nombre por semana por vendedor**: ej. "Ruta Norte – Sem 42 – Antonio". Una ruta tiene zona, vendedor, semana (lunes de inicio) y paradas por día con orden.
6. **Piloto** con 1 vendedor del 12 al 16 de octubre.
7. **Salida** con todos los vendedores el 19 de octubre.
8. **GPS del vendedor durante la jornada**: saber dónde está cada vendedor ahora y por dónde anduvo en el día. Detalle en la sección 4b.

Extras pedidos (Fase 2 salvo que sobre tiempo):
- Mapas de calor: de clientes, de visitas, y de facturación 6 meses.
- Hoja de ruta optimizada con link a Google Maps para navegar.
- Corrección de ubicación de clientes de Odoo **solo en nuestro sistema**.

---

## 4. Modelo de datos (migración inicial)

Crear `supabase/migrations/0001_vis_init.sql` con esto (ajustar nombres si la Fase 0 encuentra algo distinto):

```sql
create extension if not exists postgis;

-- ── Tipos ──────────────────────────────────────────────
create type vis_rol            as enum ('admin','supervisor','vendedor');
create type vis_origen_ubic    as enum ('odoo','manual','gps_visita');
create type vis_estado_ruta    as enum ('borrador','publicada','cerrada');
create type vis_origen_visita  as enum ('app','odoo_import');

-- ── Vendedores / usuarios de la app ───────────────────
create table vis_vendedores (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid unique references auth.users(id) on delete set null,
  odoo_user_id   int unique,
  nombre         text not null,
  email          text unique not null,
  telefono       text,
  rol            vis_rol not null default 'vendedor',
  meta_diaria    int not null default 10,
  meta_semanal   int not null default 50,
  base_lat       double precision,
  base_lng       double precision,
  activo         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ── Zonas ──────────────────────────────────────────────
create table vis_zonas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text unique not null,          -- "Zona Norte", "Asunción Centro", ...
  color       text not null default '#6366f1',
  poligono    geography(polygon, 4326),       -- opcional, se puede dibujar después
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── Clientes (Odoo + prospectos propios) ──────────────
create table vis_clientes (
  id                      uuid primary key default gen_random_uuid(),
  odoo_partner_id         int unique,          -- null = prospecto creado en la app
  razon_social            text not null,
  ruc                     text,
  telefono                text,
  telefono_norm           text,                -- solo dígitos, con 595 al frente
  direccion               text,
  ciudad                  text,
  departamento            text,
  zona_id                 uuid references vis_zonas(id),
  vendedor_id             uuid references vis_vendedores(id),
  -- Ubicación que viene de Odoo (solo referencia, la pisa el sync)
  lat_odoo                double precision,
  lng_odoo                double precision,
  -- Ubicación VIGENTE en nuestro sistema (la que se usa en mapas y rutas)
  lat                     double precision,
  lng                     double precision,
  ubicacion               geography(point, 4326)
                          generated always as (
                            case when lat is not null and lng is not null
                              then st_setsrid(st_makepoint(lng, lat), 4326)::geography end
                          ) stored,
  origen_ubicacion        vis_origen_ubic,
  ubicacion_precision_m   numeric,
  ubicacion_actualizada_por uuid references vis_vendedores(id),
  ubicacion_actualizada_el  timestamptz,
  -- Indicadores comerciales (los llena el sync)
  odoo_alta_fecha         date,
  ultima_factura_fecha    date,
  facturas_6m             int not null default 0,
  ventas_6m_gs            numeric not null default 0,
  -- Prospectos
  creado_por              uuid references vis_vendedores(id),
  notas                   text,
  activo                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index on vis_clientes using gist (ubicacion);
create index on vis_clientes (zona_id);
create index on vis_clientes (vendedor_id);
create index on vis_clientes (telefono_norm);
create index on vis_clientes (ruc);

-- Historial de cada cambio de ubicación (auditoría)
create table vis_cliente_ubicaciones_hist (
  id           bigserial primary key,
  cliente_id   uuid not null references vis_clientes(id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  precision_m  numeric,
  origen       vis_origen_ubic not null,
  motivo       text,
  usuario_id   uuid references vis_vendedores(id),
  created_at   timestamptz not null default now()
);

-- ── Catálogo de resultados de visita ──────────────────
create table vis_resultados (
  id        serial primary key,
  nombre    text unique not null,
  es_venta  boolean not null default false,
  activo    boolean not null default true,
  orden     int not null default 0
);
-- Semilla tomada de las observaciones que ya cargan los vendedores en Odoo
insert into vis_resultados (nombre, es_venta, orden) values
  ('Hizo pedido', true, 1),
  ('Tiene stock', false, 2),
  ('No se encontraba el comprador', false, 3),
  ('Precios altos / Falta de descuento', false, 4),
  ('Cobranza', false, 5),
  ('Local cerrado', false, 6),
  ('Otro', false, 99);

-- ── Rutas ──────────────────────────────────────────────
create table vis_rutas (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,               -- "Ruta Norte – Sem 42"
  vendedor_id   uuid not null references vis_vendedores(id),
  zona_id       uuid references vis_zonas(id),
  semana_inicio date not null check (extract(isodow from semana_inicio) = 1), -- lunes
  estado        vis_estado_ruta not null default 'borrador',
  notas         text,
  creado_por    uuid references vis_vendedores(id),
  created_at    timestamptz not null default now(),
  unique (vendedor_id, semana_inicio, nombre)
);

create table vis_ruta_paradas (
  id          uuid primary key default gen_random_uuid(),
  ruta_id     uuid not null references vis_rutas(id) on delete cascade,
  cliente_id  uuid not null references vis_clientes(id),
  dia         date not null,
  orden       int not null default 0,
  unique (ruta_id, cliente_id, dia)
);
create index on vis_ruta_paradas (dia);

-- ── Visitas ────────────────────────────────────────────
create table vis_visitas (
  id                   uuid primary key default gen_random_uuid(),
  client_uuid          uuid unique,         -- idempotencia de la cola offline
  cliente_id           uuid not null references vis_clientes(id),
  vendedor_id          uuid references vis_vendedores(id),
  ruta_parada_id       uuid references vis_ruta_paradas(id),
  zona_id              uuid references vis_zonas(id),      -- zona al momento de la visita
  fecha_hora           timestamptz not null default now(),
  lat                  double precision,
  lng                  double precision,
  precision_m          numeric,
  distancia_cliente_m  numeric,
  resultado_id         int references vis_resultados(id),
  hizo_pedido          boolean not null default false,
  hizo_cobranza        boolean not null default false,
  monto_cobrado_gs     numeric,
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

-- ── Seguimiento GPS del vendedor (jornada) ───────────
create table vis_jornadas (
  id            uuid primary key default gen_random_uuid(),
  vendedor_id   uuid not null references vis_vendedores(id),
  inicio        timestamptz not null default now(),
  fin           timestamptz,
  inicio_lat    double precision,
  inicio_lng    double precision,
  km_recorridos numeric,                      -- se calcula al cerrar la jornada
  cierre_auto   boolean not null default false -- true si la cerró el sistema (olvido)
);
create unique index vis_jornada_abierta_unica
  on vis_jornadas (vendedor_id) where fin is null;  -- una sola jornada abierta por vendedor

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
  bateria_pct   int,
  origen        text not null default 'tracking',  -- 'tracking' | 'visita' | 'inicio' | 'fin'
  unique (vendedor_id, fecha_hora)             -- idempotencia de la cola offline
);
create index on vis_posiciones (jornada_id, fecha_hora);
create index on vis_posiciones (vendedor_id, fecha_hora desc);

-- Última posición conocida por vendedor (lo que mira el mapa en vivo)
create table vis_posicion_actual (
  vendedor_id   uuid primary key references vis_vendedores(id),
  jornada_id    uuid references vis_jornadas(id),
  fecha_hora    timestamptz not null,
  lat           double precision not null,
  lng           double precision not null,
  precision_m   numeric,
  bateria_pct   int,
  en_jornada    boolean not null default false
);
-- Trigger: cada insert en vis_posiciones hace upsert en vis_posicion_actual
-- (solo si la nueva fecha_hora es más reciente que la guardada).
-- Habilitar Supabase Realtime SOLO sobre vis_posicion_actual (no sobre vis_posiciones).
-- Retención: pg_cron mensual que borra vis_posiciones de más de 90 días
-- (los km y el resumen de cada jornada quedan en vis_jornadas).

-- ── Log de sincronización ─────────────────────────────
create table vis_sync_log (
  id           bigserial primary key,
  proceso      text not null,               -- 'partners' | 'ventas' | 'visitas_odoo' | 'vendedores'
  inicio       timestamptz not null default now(),
  fin          timestamptz,
  ok           boolean,
  leidos       int,
  insertados   int,
  actualizados int,
  error        text
);

-- ── Vista de clientes con estado (color) ──────────────
create or replace view vis_clientes_v as
select c.*,
  case
    when c.odoo_partner_id is null then 'potencial'
    when c.ultima_factura_fecha >= (current_date - interval '6 months') then 'activo'
    when c.ultima_factura_fecha is null
         and c.odoo_alta_fecha >= (current_date - interval '6 months') then 'potencial'
    else 'inactivo'
  end as estado,
  (select max(v.fecha_hora) from vis_visitas v where v.cliente_id = c.id) as ultima_visita
from vis_clientes c
where c.activo;

-- ── Resumen semanal ───────────────────────────────────
create or replace view vis_resumen_diario as
select
  v.vendedor_id,
  (date_trunc('week', v.fecha_hora at time zone 'America/Asuncion'))::date as semana_inicio,
  (v.fecha_hora at time zone 'America/Asuncion')::date                    as dia,
  count(*)                                   as visitas,
  count(*) filter (where v.hizo_pedido)      as con_pedido,
  count(distinct v.cliente_id)               as clientes_distintos
from vis_visitas v
where v.origen = 'app'
group by 1, 2, 3;

-- updated_at automático
create or replace function vis_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger vis_clientes_touch before update on vis_clientes
  for each row execute function vis_touch_updated_at();
```

### RLS (migración `0002_vis_rls.sql`)
- Función `vis_yo()` → devuelve `id` y `rol` del `vis_vendedores` cuyo `auth_user_id = auth.uid()` y `activo = true`.
- **admin / supervisor**: leen y escriben todo.
- **vendedor**:
  - `vis_clientes`: lee los asignados a él, los que creó, y los que están en paradas de sus rutas; puede insertar prospectos; puede actualizar **solo** columnas de ubicación/teléfono/notas (hacerlo vía RPC `vis_actualizar_ubicacion(...)` con `security definer` que además escribe el historial, en vez de abrir `update` directo).
  - `vis_rutas` / `vis_ruta_paradas`: solo lectura de las suyas con estado `publicada` o `cerrada`.
  - `vis_visitas`: inserta las suyas (`vendedor_id = vis_yo().id`), lee las suyas + las de los últimos 60 días en zonas donde tiene ruta (para el requerimiento 2).
- `vis_sync_log`: solo admin.
- `vis_jornadas` / `vis_posiciones`: el vendedor inserta y lee **solo las suyas**; supervisor/admin leen todas. Nadie puede `update` ni `delete` posiciones desde el cliente (son registro de auditoría).
- `vis_posicion_actual`: el vendedor ve solo la suya; supervisor/admin ven todas. Escribe únicamente el trigger.
- El sync usa `SUPABASE_SERVICE_ROLE_KEY` del lado servidor (salta RLS).

---

## 4b. Seguimiento GPS del vendedor

### Cómo funciona
- El vendedor toca **"Iniciar jornada"** al salir y **"Terminar jornada"** al volver. El GPS se registra **solo entre esos dos momentos**, nunca fuera de horario. Mientras está activo, la app muestra un indicador fijo "📍 Ubicación compartida con tu supervisor".
- Durante la jornada, `navigator.geolocation.watchPosition` (alta precisión) guarda una posición cada `VIS_TRACK_INTERVALO_S` segundos **o** cuando se movió más de `VIS_TRACK_DIST_MIN_M` metros, lo que pase primero. Posiciones con precisión peor a 200 m se descartan.
- Cada visita registrada también guarda un punto con `origen = 'visita'`.
- Las posiciones se acumulan en IndexedDB y se suben en lote cada ~2 minutos (o al recuperar señal). Insert idempotente por `(vendedor_id, fecha_hora)`.
- Se pide **Screen Wake Lock** mientras la jornada está activa y la app en primer plano, y se lee el nivel de batería si el navegador lo permite (Battery API en Chrome Android).
- Jornada olvidada abierta → se cierra sola a `VIS_JORNADA_CIERRE_AUTO` con `cierre_auto = true`.

### Límite real que hay que respetar (no prometer de más)
Una PWA en el navegador **no puede rastrear con la pantalla apagada o la app en segundo plano** de forma confiable: Android pausa el JavaScript. En la práctica:
- Con la app abierta en pantalla (por ejemplo, usándola como navegador de la ruta) → rastreo continuo.
- Con el celular en el bolsillo → **huecos**. Esos huecos se rellenan con los puntos de cada visita y al volver a abrir la app.
- El mapa del supervisor tiene que dejar claro cuándo un punto es viejo: **verde** si la última posición tiene menos de 5 min, **amarillo** 5–15 min, **gris** más de `VIS_SIN_SENAL_MIN` ("sin señal hace 42 min"). Nunca mostrar un punto viejo como si fuera en vivo.
- Si después del piloto se necesita rastreo continuo en segundo plano, la Fase 3 es empaquetar la misma app con **Capacitor** + plugin de geolocalización en background como APK interna. No cambia el backend.

### Qué ve el supervisor
- **Mapa en vivo**: un marcador por vendedor en jornada (iniciales + color de frescura), actualizado por Supabase Realtime sobre `vis_posicion_actual`. Click → nombre, hora de la última posición, batería, visitas del día `7 / 10`, próxima parada de su ruta.
- **Recorrido del día**: elegir vendedor + fecha → polilínea del trayecto (`vis_posiciones` ordenadas), con las visitas como puntos numerados encima y las paradas planificadas no visitadas en otro color. Resumen: hora de inicio, hora de fin, km recorridos, visitas hechas vs. planificadas, tiempo detenido en cada cliente (puntos dentro de 100 m del cliente).
- **Desvíos**: vendedor a más de 2 km de todas las paradas del día por más de 30 min → aparece en una lista de "fuera de ruta" (sin notificaciones push en esta etapa).

### Aviso al personal
Antes del piloto, el vendedor tiene que saber que la app registra su ubicación durante la jornada. En el primer "Iniciar jornada" mostrar un aviso que tiene que aceptar una vez (guardar fecha de aceptación en `vis_vendedores.tracking_aceptado_el timestamptz`, agregar esa columna en la migración).

---

## 5. Integración con Odoo (solo lectura)

`lib/odoo.ts` — cliente JSON-RPC mínimo:
- `odooLogin()` contra `/jsonrpc` service `common` → cachear UID en variable de módulo; ante error de sesión, invalidar y reintentar **una** vez.
- `odooCall(model, method, args, kwargs)` con `execute_kw`; desanidar `error.data.message` al tirar el error.
- Lista blanca de métodos: `search_read`, `read_group`, `search_count`, `fields_get`. Cualquier otro → throw.
- Helper `m2o(v)` → `{ id, name } | null`.

### Procesos de sync (`lib/sync/*.ts`, expuestos en `/api/cron/sync` protegido con `CRON_SECRET` + botón "Sincronizar ahora" en admin)

**a) Vendedores** — `res.users` activos que sean vendedores (los que figuran como `user_id` en partners con `customer_rank > 0` o como responsables en `x_reportes_de_visita`). Upsert por `odoo_user_id`. **No** crea acceso: el admin activa a cada uno y le asigna email/rol.

**b) Clientes** — `res.partner` con dominio `[['customer_rank','>',0], ['parent_id','=',false], ['active','=',true]]` (solo entidades comerciales, no contactos hijos). Incremental por `write_date` > último sync OK. Upsert por `odoo_partner_id`:
- Siempre actualiza: `razon_social, ruc, telefono, telefono_norm, direccion, ciudad, departamento, lat_odoo, lng_odoo, odoo_alta_fecha, vendedor_id` (por mapeo de `user_id`).
- **Regla clave de ubicación**: si `origen_ubicacion` es `null` u `'odoo'` → copiar `lat_odoo/lng_odoo` a `lat/lng` y `origen_ubicacion = 'odoo'`. Si es `'manual'` o `'gps_visita'` → **no tocar `lat/lng`**. Nuestra corrección manda; Odoo no la pisa nunca.
- **Nunca** pisa `zona_id` ni `notas` (son nuestros).

**c) Ventas** — `account.move.read_group` con dominio
`[['move_type','=','out_invoice'], ['state','=','posted'], ['company_id','=',ODOO_COMPANY_ID]]`
agrupado por `commercial_partner_id`:
- Llamada 1 (sin filtro de fecha): `invoice_date:max` → `ultima_factura_fecha`.
- Llamada 2 (con `invoice_date >= hoy - 6 meses`): `amount_untaxed_signed:sum` y `__count` → `ventas_6m_gs`, `facturas_6m`.
- Resetear a 0 los clientes que ya no aparecen en la llamada 2.

**d) Historial de visitas** — importar `x_reportes_de_visita` a `vis_visitas` con `origen = 'odoo_import'`, upsert por `odoo_visita_id`. Mapear `x_name` a `vis_zonas` cuando coincida con un nombre de zona ("Zona Norte", "Zona Sur", "Zona Este"...); si `x_name` es otra cosa (nombre de cliente) dejar `zona_id` con la zona del cliente. Usar `x_studio_lat_visita/long_visita` si existen y son ≠ 0; si no, dejar `lat/lng` null (no inventar con la dirección del cliente).

**Frecuencia**: Vercel Hobby solo permite cron diario → cron 1×/día a las 05:00 Asunción (`0 8 * * *` UTC) + botón manual. Si el plan es Pro, cada 2 h en horario laboral. Cada corrida escribe `vis_sync_log`; si `ok=false`, banner rojo en el panel admin hasta que alguien lo vea.

---

## 6. Pantallas

### Vendedor (mobile-first, PWA)
0. **Jornada** — botón grande "Iniciar jornada" / "Terminar jornada" arriba de todo; mientras está activa, indicador de ubicación compartida y "posiciones pendientes de subir: N".
1. **Hoy** — ruta del día: lista ordenada de paradas + mapa. Cada parada: nombre, color de estado, última visita y última observación, botón **"Llegué / Registrar visita"**, botón llamar (tel:) y WhatsApp (`https://wa.me/<telefono_norm>`). Contador arriba: `7 / 10 hoy · 31 / 50 semana`.
2. **Registrar visita** — captura GPS automática al abrir (`enableHighAccuracy: true, maximumAge: 0, timeout: 20000`), muestra precisión y distancia al cliente. Resultado (catálogo), ¿hizo pedido?, ¿cobranza? + monto, observaciones, próxima visita, foto de fachada (opcional, comprimir a ≤ 1280 px antes de subir). Si la distancia > `VIS_DIST_ALERTA_M`: aviso "Estás a 850 m de la ubicación registrada. ¿El cliente está acá?" → si confirma, llama a `vis_actualizar_ubicacion` con origen `gps_visita` (queda en historial, no va a Odoo).
3. **Nuevo prospecto** — requerimiento 1 completo (validaciones y anti-duplicado).
4. **Mapa** — sus clientes con colores, filtro por estado, "cerca mío" (radio 2/5/10 km con PostGIS `st_dwithin`).
5. **Offline** — si no hay señal, la visita se guarda en IndexedDB con `client_uuid` y se sube sola al volver la conexión. Indicador "3 visitas pendientes de subir". El GPS funciona sin datos.

### Supervisor / Admin (desktop)
1. **Planificador de rutas** — elegir vendedor + semana + zona → mapa con clientes de esa zona (colores), seleccionar en el mapa (click / lazo) o en lista, arrastrar a los días Lun–Vie. Panel lateral: **"Lo hecho en esta zona en los últimos 60 días"** (requerimiento 2). Botón "Ordenar paradas" (vecino más cercano desde la base del vendedor + mejora 2-opt). Botón "Duplicar ruta a otra semana". Publicar → el vendedor la ve.
2. **Tablero semanal** — por vendedor: planificadas vs. realizadas por día, % cumplimiento vs. meta, visitas con pedido, agrupado por ciudad/zona (requerimiento 3). Visitas fuera de ruta marcadas aparte.
3. **Mapa general** — capas conmutables: clientes por estado (verde/azul/rojo), visitas de la semana, prospectos nuevos; **heatmaps** de clientes, de visitas (rango de fechas) y de facturación 6 m (peso = `ventas_6m_gs`). Filtros por vendedor, zona, estado, rango de fechas.
4. **Clientes** — tabla con búsqueda, estado, zona, vendedor, última visita, última factura; ver/corregir ubicación en mapa (arrastrar el pin → origen `manual`, pide motivo); ver historial de ubicaciones. Lista de **discrepancias**: clientes cuya última visita GPS cayó a más de `VIS_DIST_ALERTA_M` de la ubicación vigente.
5. **Zonas** — ABM, color, (opcional) dibujar polígono y asignar clientes automáticamente por `st_contains`.
6. **Vendedores** — activar acceso, rol, metas, punto de salida.
7. **Sync** — log, último estado, botón "Sincronizar ahora".
8. **Vendedores en vivo** — mapa en vivo y recorrido del día (sección 4b).

### Navegación externa
En la ruta del día: botón "Abrir en Google Maps" que arma `https://www.google.com/maps/dir/?api=1&origin=...&destination=...&waypoints=a|b|c&travelmode=driving`, partiendo en tramos de hasta 9 paradas.

---

## 7. Auth

Supabase Auth con **Google** (las cuentas de Google Workspace de la empresa). Al loguear: si el email no está en `vis_vendedores` con `activo = true`, pantalla "Pedile acceso a TI" y no se muestra nada más. Al primer login, vincular `auth_user_id`.

---

## 8. Plan por fases

### Fase 0 — Descubrimiento (sección 2). Parar y mostrarme `docs/odoo-campos.md`.

### Fase 1 — MVP para el piloto (lista para el **domingo 11/10**)
- Repo, Next.js, Supabase, migraciones 0001 y 0002, deploy en Vercel.
- `lib/odoo.ts` + sync de vendedores, clientes y ventas (b y c). El import de visitas (d) también, porque alimenta el requerimiento 2.
- Login + roles.
- Vendedor: Hoy, Registrar visita (GPS + validaciones), Nuevo prospecto, Mapa con colores.
- Supervisor: Planificador de rutas (puede ser selección por lista + días, el lazo en mapa es Fase 2), panel de últimos 60 días por zona, tablero semanal básico.
- PWA instalable. Cola offline **básica** (guardar y reintentar).
- **Jornada + tracking GPS** (iniciar/terminar, captura en primer plano, subida en lote) y **mapa en vivo** del supervisor con Realtime. El recorrido del día con polilínea puede quedar para Fase 2 si no llega.

**Criterios de aceptación Fase 1**
- [ ] Sin jornada iniciada no se guarda ninguna posición de tracking.
- [ ] Con jornada activa y la app abierta, el marcador del vendedor se mueve en el mapa del supervisor sin recargar la página.
- [ ] Apago la pantalla 20 min: el marcador pasa a amarillo y luego a gris con "sin señal hace X min"; al volver a abrir la app se suben las posiciones pendientes sin duplicar.
- [ ] Un vendedor no puede leer posiciones de otro vendedor.
- [ ] Un vendedor con rol `vendedor` no puede ver clientes ni visitas de otro (probarlo con dos usuarios).
- [ ] El sync corrido dos veces seguidas no duplica nada.
- [ ] Corrijo la ubicación de un cliente de Odoo, corro el sync, y la corrección **sigue**.
- [ ] Ninguna llamada a Odoo usa métodos fuera de la lista blanca (test unitario sobre `lib/odoo.ts`).
- [ ] La key de Odoo no aparece en el bundle (`grep` sobre `.next/static`).
- [ ] Alta de prospecto con precisión 150 m → bloqueada con mensaje claro.
- [ ] Alta con teléfono de un cliente existente → muestra el posible duplicado.
- [ ] Visita registrada en modo avión → se sube sola al reconectar, una sola vez.
- [ ] El tablero muestra `x / 10` por día y `x / 50` por semana correctamente con hora de Asunción.
- [ ] Colores: elegir 3 clientes reales y validar contra Odoo que verde/azul/rojo están bien.

### Fase 2 — Durante y después del piloto (para el **19/10**)
- Heatmaps (clientes, visitas, facturación).
- Selección por lazo en mapa, ordenamiento 2-opt, duplicar ruta.
- Zonas con polígono y asignación automática.
- Lista de discrepancias de ubicación.
- Recorrido del día (polilínea, km, tiempo detenido por cliente) y lista de "fuera de ruta".
- Cola offline robusta (fotos incluidas, reintentos con backoff).
- Ajustes que salgan del piloto.

### Fase 3 — Después del lanzamiento (no ahora)
- Opcional: empujar visitas a `x_reportes_de_visita` en Odoo (con dry-run, log previo y batch). **Requiere mi aprobación explícita.**
- Rastreo en segundo plano con la pantalla apagada: empaquetar la PWA con Capacitor como APK interna.
- Alertas de cliente rojo cerca de la ruta, notificaciones push de desvío, reporte semanal automático por mail a Gerencia.

---

## 9. Estructura sugerida

```
c44-gestor-visitas/
├─ app/
│  ├─ (vendedor)/jornada, hoy, visita/[paradaId], prospecto/nuevo, mapa
│  ├─ (admin)/rutas, tablero, mapa, en-vivo, recorrido, clientes, zonas, vendedores, sync
│  ├─ api/cron/sync/route.ts
│  └─ login/
├─ components/map/ (MapLibre: ClientesLayer, HeatLayer, VisitasLayer, Leyenda)
├─ lib/odoo.ts, lib/sync/{vendedores,clientes,ventas,visitas}.ts
├─ lib/geo.ts (haversine, ordenar paradas, link Google Maps)
├─ lib/offline/ (IndexedDB queue: visitas + posiciones)
├─ lib/tracking/ (watchPosition, filtro distancia/intervalo, wake lock, subida en lote)
├─ supabase/migrations/
├─ scripts/odoo-discovery.ts
├─ docs/odoo-campos.md
├─ CLAUDE.md
└─ vercel.json (cron)
```

Creá un `CLAUDE.md` en la raíz con: las reglas de la sección 1, el mapeo de campos confirmado en la Fase 0, y los comandos para correr local, migrar y sincronizar.

---

## 10. Arranque

Empezá por la **Fase 0**. Antes de escribir código, decime qué necesitás que yo te pase (credenciales de un usuario técnico de solo lectura en Odoo, `ODOO_COMPANY_ID`, proyecto de Supabase, punto de salida del depósito) y en qué orden.
