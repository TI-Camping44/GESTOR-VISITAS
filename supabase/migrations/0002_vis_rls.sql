-- ════════════════════════════════════════════════════════════════════
-- RLS y permisos (BRIEF.md §4 "RLS").
-- El proyecto se creó sin "exponer tablas automáticamente": cada permiso
-- de la Data API se da acá, explícito. anon no ve nada.
-- Las escrituras sensibles (posiciones, jornadas, visitas, prospectos,
-- correcciones de ubicación) pasan por funciones de 0003, no por la tabla.
-- ════════════════════════════════════════════════════════════════════

-- ── Quién soy ───────────────────────────────────────────────────────
create or replace function vis_mi_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from vis_vendedores where auth_user_id = auth.uid() and activo
$$;

create or replace function vis_mi_rol() returns vis_rol
language sql stable security definer set search_path = public as $$
  select rol from vis_vendedores where auth_user_id = auth.uid() and activo
$$;

create or replace function vis_es_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol in ('admin','supervisor') from vis_vendedores where auth_user_id = auth.uid() and activo), false)
$$;

create or replace function vis_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'admin' from vis_vendedores where auth_user_id = auth.uid() and activo), false)
$$;

-- Clientes que un vendedor puede ver: asignados, creados por él, o en paradas
-- de sus rutas publicadas/cerradas. (Supervisor/admin ven todo; se resuelve en la policy.)
create or replace function vis_puede_ver_cliente(p_cliente uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from vis_clientes c
    where c.id = p_cliente and (c.vendedor_id = vis_mi_id() or c.creado_por = vis_mi_id())
  ) or exists (
    select 1 from vis_ruta_paradas p join vis_rutas r on r.id = p.ruta_id
    where p.cliente_id = p_cliente and r.vendedor_id = vis_mi_id() and r.estado in ('publicada','cerrada')
  )
$$;

-- Zonas donde tengo una ruta publicada/cerrada (para ver lo hecho ahí en 60 días).
create or replace function vis_mis_zonas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct zona_id from vis_rutas
  where vendedor_id = vis_mi_id() and estado in ('publicada','cerrada') and zona_id is not null
$$;

-- ── Permisos base de la Data API ───────────────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, public;

grant usage on schema public to authenticated;
grant select on
  vis_config, vis_vendedores, vis_zonas, vis_clientes, vis_cliente_ubicaciones_hist, vis_resultados,
  vis_rutas, vis_ruta_paradas, vis_visitas, vis_jornadas, vis_posiciones, vis_posicion_actual, vis_sync_log,
  vis_clientes_v, vis_resumen_diario
to authenticated;
-- Escrituras directas que sí se permiten (siempre filtradas por RLS):
grant insert, update, delete on vis_zonas, vis_rutas, vis_ruta_paradas, vis_resultados to authenticated;
grant insert, update on vis_vendedores, vis_config to authenticated;
grant update on vis_clientes, vis_sync_log to authenticated;
grant usage on sequence vis_resultados_id_seq to authenticated;
grant execute on function vis_mi_id(), vis_mi_rol(), vis_es_supervisor(), vis_es_admin(),
  vis_puede_ver_cliente(uuid), vis_mis_zonas(), vis_hoy(), vis_normalizar_telefono(text), vis_nombre_cmp(text)
to authenticated;

-- ── RLS en todas las tablas ────────────────────────────────────────
alter table vis_config                   enable row level security;
alter table vis_vendedores               enable row level security;
alter table vis_zonas                    enable row level security;
alter table vis_clientes                 enable row level security;
alter table vis_cliente_ubicaciones_hist enable row level security;
alter table vis_resultados               enable row level security;
alter table vis_rutas                    enable row level security;
alter table vis_ruta_paradas             enable row level security;
alter table vis_visitas                  enable row level security;
alter table vis_jornadas                 enable row level security;
alter table vis_posiciones               enable row level security;
alter table vis_posicion_actual          enable row level security;
alter table vis_sync_log                 enable row level security;

-- vis_config: todos los usuarios activos leen; solo admin cambia.
create policy config_select on vis_config for select to authenticated using ((select vis_mi_id()) is not null);
create policy config_update on vis_config for update to authenticated using ((select vis_es_admin())) with check ((select vis_es_admin()));

-- vis_vendedores: cualquier usuario activo ve la lista (nombres en paneles e historial);
-- solo admin da de alta o modifica (activar acceso, rol, metas, punto de salida).
create policy vendedores_select on vis_vendedores for select to authenticated using ((select vis_mi_id()) is not null);
create policy vendedores_insert on vis_vendedores for insert to authenticated with check ((select vis_es_admin()));
create policy vendedores_update on vis_vendedores for update to authenticated using ((select vis_es_admin())) with check ((select vis_es_admin()));

-- vis_zonas / vis_resultados: todos leen; supervisor/admin escriben.
create policy zonas_select on vis_zonas for select to authenticated using ((select vis_mi_id()) is not null);
create policy zonas_write  on vis_zonas for all to authenticated using ((select vis_es_supervisor())) with check ((select vis_es_supervisor()));
create policy resultados_select on vis_resultados for select to authenticated using ((select vis_mi_id()) is not null);
create policy resultados_write  on vis_resultados for all to authenticated using ((select vis_es_supervisor())) with check ((select vis_es_supervisor()));

-- vis_clientes: supervisor ve y edita todo; vendedor ve los suyos. El vendedor no
-- tiene UPDATE directo: corrige ubicación y crea prospectos por funciones (0003).
create policy clientes_select on vis_clientes for select to authenticated
  using ((select vis_es_supervisor()) or vis_puede_ver_cliente(id));
create policy clientes_update on vis_clientes for update to authenticated
  using ((select vis_es_supervisor())) with check ((select vis_es_supervisor()));

create policy ubic_hist_select on vis_cliente_ubicaciones_hist for select to authenticated
  using ((select vis_es_supervisor()) or usuario_id = (select vis_mi_id()));

-- vis_rutas / vis_ruta_paradas: supervisor todo; vendedor solo lee las suyas publicadas/cerradas.
create policy rutas_select on vis_rutas for select to authenticated
  using ((select vis_es_supervisor()) or (vendedor_id = (select vis_mi_id()) and estado in ('publicada','cerrada')));
create policy rutas_write on vis_rutas for all to authenticated
  using ((select vis_es_supervisor())) with check ((select vis_es_supervisor()));

create policy paradas_select on vis_ruta_paradas for select to authenticated
  using ((select vis_es_supervisor()) or exists (
    select 1 from vis_rutas r where r.id = ruta_id and r.vendedor_id = (select vis_mi_id()) and r.estado in ('publicada','cerrada')));
create policy paradas_write on vis_ruta_paradas for all to authenticated
  using ((select vis_es_supervisor())) with check ((select vis_es_supervisor()));

-- vis_visitas: supervisor todo; vendedor las suyas + las de los últimos 60 días en
-- zonas donde tiene ruta + las de los clientes que puede ver (última observación en "Hoy").
-- Se insertan con vis_registrar_visita().
create policy visitas_select on vis_visitas for select to authenticated
  using (
    (select vis_es_supervisor())
    or vendedor_id = (select vis_mi_id())
    or (fecha_hora >= now() - interval '60 days' and zona_id in (select vis_mis_zonas()))
    or vis_puede_ver_cliente(cliente_id)
  );

-- Jornadas y posiciones: registro de auditoría. El vendedor solo ve las suyas; nadie
-- escribe directo (vis_iniciar_jornada / vis_subir_posiciones / vis_terminar_jornada).
create policy jornadas_select on vis_jornadas for select to authenticated
  using ((select vis_es_supervisor()) or vendedor_id = (select vis_mi_id()));
create policy posiciones_select on vis_posiciones for select to authenticated
  using ((select vis_es_supervisor()) or vendedor_id = (select vis_mi_id()));
create policy posicion_actual_select on vis_posicion_actual for select to authenticated
  using ((select vis_es_supervisor()) or vendedor_id = (select vis_mi_id()));

-- vis_sync_log: solo admin (lee y marca como visto).
create policy sync_log_select on vis_sync_log for select to authenticated using ((select vis_es_admin()));
create policy sync_log_update on vis_sync_log for update to authenticated using ((select vis_es_admin())) with check ((select vis_es_admin()));

-- ── Realtime: solo la última posición (nunca el historial) ────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table vis_posicion_actual;
  end if;
end $$;
