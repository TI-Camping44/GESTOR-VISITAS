-- Ciclos de rutas (TI-0115, 16/11, pedido de Sergio para la venta mayorista de Vitalica): la planificación es
-- zona → semana → día → punto de venta, en ciclos de hasta 4 semanas que se repiten solos.
--
-- Un ciclo es de un vendedor, empieza un lunes y dura 1 a 4 semanas. Las rutas de esas primeras semanas son las
-- «semanas modelo» (ciclo_id = el ciclo, ciclo_modelo_id nulo): se arman con el planificador de siempre.
-- Pasado el primer ciclo, cada semana se genera sola copiando las rutas modelo que le tocan
-- (semana 5 = modelo 1, semana 6 = modelo 2…), con las paradas en los mismos días y en el mismo orden.
-- Las rutas generadas llevan ciclo_modelo_id = la ruta modelo y se pueden tocar como cualquier otra
-- (son una excepción de esa semana: el modelo no cambia). Cambiar el modelo afecta lo que todavía no se generó;
-- «Rehacer» vuelve a copiar las semanas futuras.
-- pg_cron genera cada día la semana actual y las 2 siguientes (vis_generar_ciclos_todos).

create table vis_ciclos (
  id          uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references vis_vendedores(id) on delete cascade,
  nombre      text not null check (btrim(nombre) <> ''),
  inicio      date not null check (extract(isodow from inicio) = 1), -- lunes de la semana 1
  semanas     int  not null default 4 check (semanas between 1 and 4),
  activo      boolean not null default true,
  creado_por  uuid references vis_vendedores(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on vis_ciclos (vendedor_id);

alter table vis_rutas
  add column ciclo_id uuid references vis_ciclos(id) on delete set null,
  add column ciclo_semana int check (ciclo_semana between 1 and 4),
  add column ciclo_modelo_id uuid references vis_rutas(id) on delete set null;
create index on vis_rutas (ciclo_id);
-- Una ruta modelo se copia una sola vez por semana.
create unique index vis_rutas_ciclo_copia_unica on vis_rutas (ciclo_modelo_id, semana_inicio) where ciclo_modelo_id is not null;

alter table vis_ciclos enable row level security;
grant select, insert, update, delete on vis_ciclos to authenticated;
create policy ciclos_select on vis_ciclos for select to authenticated
  using ((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id));
create policy ciclos_write on vis_ciclos for all to authenticated
  using ((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id))
  with check ((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id));

-- Qué semana del ciclo es la del lunes p_lunes (1..semanas). Antes del inicio: null.
create or replace function vis_ciclo_semana(p_inicio date, p_semanas int, p_lunes date) returns int
language sql immutable as $$
  select case when p_lunes < p_inicio then null
              else ((p_lunes - p_inicio) / 7) % p_semanas + 1 end
$$;

-- "Sem NN" del nombre pasa a la semana nueva (igual que «Duplicar» en el planificador).
create or replace function vis_renombrar_semana(p_nombre text, p_lunes date) returns text
language sql immutable as $$
  select case when p_nombre ~* 'Sem\s*\d+'
              then regexp_replace(p_nombre, 'Sem\s*\d+', 'Sem ' || extract(week from p_lunes)::int, 'i')
              else p_nombre || ' – Sem ' || extract(week from p_lunes)::int end
$$;

-- Genera las semanas de un ciclo desde la semana actual hasta p_semanas_adelante semanas después.
-- Solo semanas posteriores al primer ciclo (esas son las modelo). Devuelve cuántas rutas creó.
-- Interna: la llaman vis_generar_ciclo (supervisor, con permisos) y vis_generar_ciclos_todos (pg_cron).
create or replace function vis_generar_ciclo_interno(p_ciclo uuid, p_semanas_adelante int) returns int
language plpgsql security definer set search_path = public as $$
declare
  c vis_ciclos;
  v_lunes date;
  v_desde date := date_trunc('week', vis_hoy())::date;
  v_k int;
  m vis_rutas;
  v_nueva uuid;
  v_n int := 0;
begin
  select * into c from vis_ciclos where id = p_ciclo;
  if not found or not c.activo then return 0; end if;
  for v_lunes in
    select g::date from generate_series(greatest(v_desde, c.inicio + 7 * c.semanas), v_desde + 7 * p_semanas_adelante, interval '7 days') g
  loop
    v_k := vis_ciclo_semana(c.inicio, c.semanas, v_lunes);
    for m in
      select * from vis_rutas
      where ciclo_id = c.id and ciclo_modelo_id is null and vendedor_id = c.vendedor_id
        and semana_inicio = c.inicio + 7 * (v_k - 1) and estado <> 'cerrada'
      order by nombre
    loop
      if exists (select 1 from vis_rutas where ciclo_modelo_id = m.id and semana_inicio = v_lunes) then continue; end if;
      insert into vis_rutas (nombre, vendedor_id, zona_id, semana_inicio, estado, notas, creado_por, ciclo_id, ciclo_semana, ciclo_modelo_id)
      values (vis_renombrar_semana(m.nombre, v_lunes), m.vendedor_id, m.zona_id, v_lunes, m.estado, m.notas, null, c.id, v_k, m.id)
      on conflict (vendedor_id, semana_inicio, nombre) do nothing
      returning id into v_nueva;
      if v_nueva is null then continue; end if; -- ya había una ruta con ese nombre esa semana: no se pisa
      insert into vis_ruta_paradas (ruta_id, cliente_id, dia, orden)
      select v_nueva, p.cliente_id, p.dia + (v_lunes - m.semana_inicio), p.orden
      from vis_ruta_paradas p join vis_clientes cl on cl.id = p.cliente_id
      where p.ruta_id = m.id and cl.activo
      on conflict (ruta_id, cliente_id, dia) do nothing;
      v_n := v_n + 1;
      v_nueva := null;
    end loop;
  end loop;
  return v_n;
end $$;
revoke execute on function vis_generar_ciclo_interno(uuid, int) from anon, authenticated, public;

-- Desde el panel: «Generar próximas semanas» y «Rehacer semanas futuras» (p_rehacer: borra las rutas generadas
-- de las semanas siguientes a la actual que todavía no tienen visitas, llegadas ni «no pude visitar», y las vuelve a copiar
-- del modelo; la semana en curso no se toca).
create or replace function vis_generar_ciclo(p_ciclo uuid, p_semanas_adelante int default 2, p_rehacer boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c vis_ciclos;
  v_borradas int := 0;
  v_creadas int;
begin
  select * into c from vis_ciclos where id = p_ciclo;
  if not found or not (vis_es_supervisor() and vis_vendedor_visible(c.vendedor_id)) then
    raise exception 'No encontramos ese ciclo entre los de tu gente.';
  end if;
  if not c.activo then raise exception 'El ciclo está pausado: activalo para generar semanas.'; end if;
  if p_semanas_adelante not between 0 and 8 then raise exception 'Se pueden generar hasta 8 semanas adelante.'; end if;
  if p_rehacer then
    with borrar as (
      delete from vis_rutas r
      where r.ciclo_id = c.id and r.ciclo_modelo_id is not null
        and r.semana_inicio > date_trunc('week', vis_hoy())::date
        and not exists (select 1 from vis_ruta_paradas p where p.ruta_id = r.id and (
              exists (select 1 from vis_visitas v where v.ruta_parada_id = p.id)
              or exists (select 1 from vis_no_visitados n where n.parada_id = p.id)
              or exists (select 1 from vis_llegadas l where l.parada_id = p.id)))
      returning 1)
    select count(*) into v_borradas from borrar;
  end if;
  v_creadas := vis_generar_ciclo_interno(c.id, p_semanas_adelante);
  return jsonb_build_object('creadas', v_creadas, 'rehechas', v_borradas);
end $$;
revoke execute on function vis_generar_ciclo(uuid, int, boolean) from anon, public;
grant execute on function vis_generar_ciclo(uuid, int, boolean) to authenticated;

-- pg_cron (0035_vis_ciclos_cron.sql): todos los ciclos activos, semana actual y 2 siguientes.
create or replace function vis_generar_ciclos_todos() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  for v_id in select id from vis_ciclos where activo loop
    v_n := v_n + vis_generar_ciclo_interno(v_id, 2);
  end loop;
  return v_n;
end $$;
revoke execute on function vis_generar_ciclos_todos() from anon, authenticated, public;
