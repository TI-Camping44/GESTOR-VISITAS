-- Multi empresa (Camping 44 y Vitalica en la misma app).
-- Los clientes son compartidos: las dos empresas usan los mismos contactos de Odoo.
-- Lo que se separa es la gente y su trabajo: vendedores, zonas, rutas, visitas,
-- jornadas y recorridos. Cada usuario ve solo lo de su empresa; quien tiene
-- multi_empresa (TI) elige con cuál trabaja (empresa_activa) y ve esa.
-- Todo lo existente queda en Camping 44: para quienes ya usan la app no cambia nada.

create table vis_empresas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  created_at timestamptz not null default now()
);
insert into vis_empresas (nombre, created_at) values ('Camping 44', '2026-01-01'), ('Vitalica', '2026-01-02');

alter table vis_vendedores
  add column empresa_id uuid references vis_empresas(id),
  add column multi_empresa boolean not null default false,
  add column empresa_activa uuid references vis_empresas(id);
alter table vis_zonas add column empresa_id uuid references vis_empresas(id);

update vis_vendedores set empresa_id = (select id from vis_empresas where nombre = 'Camping 44');
update vis_zonas set empresa_id = (select id from vis_empresas where nombre = 'Camping 44');

-- Empresa con la que trabajo ahora (la mía, o la elegida si soy multi empresa).
create or replace function vis_mi_empresa() returns uuid
language sql stable security definer set search_path = public as $$
  select case when multi_empresa then coalesce(empresa_activa, empresa_id) else empresa_id end
  from vis_vendedores where auth_user_id = auth.uid() and activo
$$;

-- Para lo que se crea sin usuario (cargas, cron): la primera empresa (Camping 44).
create or replace function vis_empresa_nueva() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(vis_mi_empresa(), (select id from vis_empresas order by created_at limit 1))
$$;

alter table vis_vendedores alter column empresa_id set default vis_empresa_nueva(), alter column empresa_id set not null;
alter table vis_zonas alter column empresa_id set default vis_empresa_nueva(), alter column empresa_id set not null;
create index on vis_vendedores (empresa_id);
create index on vis_zonas (empresa_id);

-- ¿Este vendedor es de la empresa con la que trabajo?
create or replace function vis_vendedor_visible(p_vendedor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vis_vendedores v where v.id = p_vendedor and v.empresa_id = vis_mi_empresa())
$$;

-- TI con acceso a varias empresas: cambia la empresa con la que trabaja.
create or replace function vis_cambiar_empresa(p_empresa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from vis_vendedores where auth_user_id = auth.uid() and activo and multi_empresa) then
    raise exception 'Tu usuario trabaja con una sola empresa.';
  end if;
  if not exists (select 1 from vis_empresas where id = p_empresa) then raise exception 'Empresa inexistente.'; end if;
  update vis_vendedores set empresa_activa = p_empresa where auth_user_id = auth.uid();
end $$;

-- El perfil incluye la empresa (nombre en el panel y selector para multi empresa).
create or replace function vis_vincular_usuario() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v vis_vendedores;
  v_empresa uuid;
begin
  if auth.uid() is null or v_email = '' then return null; end if;

  update vis_vendedores set auth_user_id = auth.uid()
  where email = v_email and activo and auth_user_id is null;

  select * into v from vis_vendedores where auth_user_id = auth.uid() and activo;
  if not found then return null; end if;
  v_empresa := case when v.multi_empresa then coalesce(v.empresa_activa, v.empresa_id) else v.empresa_id end;

  return jsonb_build_object('id', v.id, 'nombre', v.nombre, 'email', v.email, 'rol', v.rol,
    'meta_diaria', v.meta_diaria, 'meta_semanal', v.meta_semanal,
    'tracking_aceptado_el', v.tracking_aceptado_el,
    'empresa_id', v_empresa, 'empresa', (select nombre from vis_empresas where id = v_empresa),
    'multi_empresa', v.multi_empresa);
end $$;

-- La zona automática por ciudad mira las zonas de la empresa con la que se trabaja.
create or replace function vis_zona_por_ciudad(p_ciudad text) returns uuid
language sql stable set search_path = public, extensions as $$
  select case when count(*) = 1 then (array_agg(z.id))[1] end
  from vis_zonas z
  where z.activo and z.empresa_id = vis_empresa_nueva() and btrim(coalesce(p_ciudad, '')) <> ''
    and exists (select 1 from unnest(z.ciudades || z.ciudades_alias) c where vis_nombre_cmp(c) = vis_nombre_cmp(p_ciudad))
$$;

revoke execute on function vis_empresa_nueva() from anon, public;
grant execute on function vis_mi_empresa(), vis_empresa_nueva(), vis_vendedor_visible(uuid), vis_cambiar_empresa(uuid) to authenticated;

-- ── Permisos ────────────────────────────────────────────────────────
alter table vis_empresas enable row level security;
grant select on vis_empresas to authenticated;
create policy empresas_select on vis_empresas for select to authenticated
  using (id = vis_mi_empresa() or exists (select 1 from vis_vendedores where auth_user_id = auth.uid() and activo and multi_empresa));

-- Vendedores: veo los de mi empresa (y a mí). El admin gestiona solo su empresa y no
-- puede tocar la empresa ni el acceso multi empresa (solo columnas de la lista).
revoke insert, update on vis_vendedores from authenticated;
grant insert (nombre, email, telefono, rol, meta_diaria, meta_semanal, base_lat, base_lng, activo) on vis_vendedores to authenticated;
grant update (nombre, email, telefono, rol, meta_diaria, meta_semanal, base_lat, base_lng, activo) on vis_vendedores to authenticated;
alter policy vendedores_select on vis_vendedores
  using (empresa_id = (select vis_mi_empresa()) or id = (select vis_mi_id()));
alter policy vendedores_insert on vis_vendedores
  with check ((select vis_es_admin()) and empresa_id = (select vis_mi_empresa()));
alter policy vendedores_update on vis_vendedores
  using ((select vis_es_admin()) and empresa_id = (select vis_mi_empresa()))
  with check ((select vis_es_admin()) and empresa_id = (select vis_mi_empresa()));

-- Zonas: de mi empresa.
alter policy zonas_select on vis_zonas
  using (empresa_id = (select vis_mi_empresa()));
alter policy zonas_write on vis_zonas
  using ((select vis_es_supervisor()) and empresa_id = (select vis_mi_empresa()))
  with check ((select vis_es_supervisor()) and empresa_id = (select vis_mi_empresa()));

-- Resultados de visita: lista compartida, solo un admin la cambia.
alter policy resultados_write on vis_resultados
  using ((select vis_es_admin())) with check ((select vis_es_admin()));

-- Clientes: compartidos. El supervisor edita los que no tienen vendedor o tienen uno
-- de su empresa, y no puede asignarlos a vendedores de otra empresa.
alter policy clientes_update on vis_clientes
  using ((select vis_es_supervisor()) and (vendedor_id is null or vis_vendedor_visible(vendedor_id)))
  with check ((select vis_es_supervisor()) and (vendedor_id is null or vis_vendedor_visible(vendedor_id)));

-- Rutas y paradas: supervisor, solo de vendedores de su empresa.
alter policy rutas_select on vis_rutas
  using (((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id))
         or (vendedor_id = (select vis_mi_id()) and estado in ('publicada','cerrada')));
alter policy rutas_write on vis_rutas
  using ((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id))
  with check ((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id));

alter policy paradas_select on vis_ruta_paradas
  using (exists (select 1 from vis_rutas r where r.id = ruta_id and (
    ((select vis_es_supervisor()) and vis_vendedor_visible(r.vendedor_id))
    or (r.vendedor_id = (select vis_mi_id()) and r.estado in ('publicada','cerrada')))));
alter policy paradas_write on vis_ruta_paradas
  using ((select vis_es_supervisor()) and exists (select 1 from vis_rutas r where r.id = ruta_id and vis_vendedor_visible(r.vendedor_id)))
  with check ((select vis_es_supervisor()) and exists (select 1 from vis_rutas r where r.id = ruta_id and vis_vendedor_visible(r.vendedor_id)));

-- Visitas: las mías, y las de mi empresa que me corresponden.
alter policy visitas_select on vis_visitas
  using (
    vendedor_id = (select vis_mi_id())
    or (vis_vendedor_visible(vendedor_id) and (
      (select vis_es_supervisor())
      or (fecha_hora >= now() - interval '60 days' and zona_id in (select vis_mis_zonas()))
      or vis_puede_ver_cliente(cliente_id)))
  );

-- Jornadas, recorrido y posición en vivo: supervisor, solo de su empresa.
alter policy jornadas_select on vis_jornadas
  using (((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id)) or vendedor_id = (select vis_mi_id()));
alter policy posiciones_select on vis_posiciones
  using (((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id)) or vendedor_id = (select vis_mi_id()));
alter policy posicion_actual_select on vis_posicion_actual
  using (((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id)) or vendedor_id = (select vis_mi_id()));
