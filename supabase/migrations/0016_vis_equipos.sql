-- Equipos dentro de una empresa (pedido de Facundo, 22/10): en Camping 44 hay Mayorista y
-- Venta externa, con supervisores distintos. Cada supervisor ve solo su equipo (vendedores,
-- rutas, visitas, jornadas, en vivo, zonas, tablero y reportes). Quien no tiene equipo
-- (admins, gerencia) ve todos los de su empresa. Los clientes siguen compartidos.

create table vis_equipos (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references vis_empresas(id),
  nombre     text not null,
  created_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);
insert into vis_equipos (empresa_id, nombre, created_at)
select id, e.nombre, e.creado from vis_empresas,
  (values ('Mayorista', timestamptz '2026-01-01'), ('Venta externa', timestamptz '2026-01-02')) as e(nombre, creado)
where vis_empresas.nombre = 'Camping 44';

alter table vis_vendedores add column equipo_id uuid references vis_equipos(id);
alter table vis_zonas add column equipo_id uuid references vis_equipos(id);
create index on vis_vendedores (equipo_id);
create index on vis_zonas (equipo_id);

-- Mi equipo en la empresa con la que trabajo (null = todos).
create or replace function vis_mi_equipo() returns uuid
language sql stable security definer set search_path = public as $$
  select v.equipo_id from vis_vendedores v join vis_equipos q on q.id = v.equipo_id
  where v.auth_user_id = auth.uid() and v.activo and q.empresa_id = vis_mi_empresa()
$$;

-- Zona nueva: del equipo de quien la crea (sin equipo: compartida).
alter table vis_zonas alter column equipo_id set default vis_mi_equipo();

-- ¿Este vendedor es de mi empresa y de mi equipo (o no tengo equipo)?
create or replace function vis_vendedor_visible(p_vendedor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from vis_vendedores v
    where v.id = p_vendedor and v.empresa_id = vis_mi_empresa()
      and (vis_mi_equipo() is null or v.equipo_id = vis_mi_equipo())
  )
$$;

-- Equipo de un usuario: lo cambia un admin sin equipo de esa empresa (o TI). null = todos.
create or replace function vis_asignar_equipo(p_vendedor uuid, p_equipo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v vis_vendedores;
begin
  select * into v from vis_vendedores where id = p_vendedor;
  if not found then raise exception 'Usuario inexistente.'; end if;
  if not (vis_soy_admin_multi() or (vis_es_admin() and vis_mi_equipo() is null and v.empresa_id = vis_mi_empresa())) then
    raise exception 'Solo un admin de la empresa puede cambiar el equipo de un usuario.';
  end if;
  if p_equipo is not null and not exists (select 1 from vis_equipos where id = p_equipo and empresa_id = v.empresa_id) then
    raise exception 'Ese equipo no es de la empresa del usuario.';
  end if;
  update vis_vendedores set equipo_id = p_equipo where id = p_vendedor;
end $$;

-- El perfil incluye el equipo (para mostrarlo en el panel).
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
    'multi_empresa', v.multi_empresa, 'equipo_id', v_equipo.id, 'equipo', v_equipo.nombre);
end $$;

-- Zona automática por ciudad: entre las zonas que ve mi equipo.
create or replace function vis_zona_por_ciudad(p_ciudad text) returns uuid
language sql stable set search_path = public, extensions as $$
  select case when count(*) = 1 then (array_agg(z.id))[1] end
  from vis_zonas z
  where z.activo and z.empresa_id = vis_empresa_nueva() and btrim(coalesce(p_ciudad, '')) <> ''
    and (vis_mi_equipo() is null or z.equipo_id is null or z.equipo_id = vis_mi_equipo())
    and exists (select 1 from unnest(z.ciudades || z.ciudades_alias) c where vis_nombre_cmp(c) = vis_nombre_cmp(p_ciudad))
$$;

revoke execute on function vis_mi_equipo(), vis_asignar_equipo(uuid, uuid) from anon, public;
grant execute on function vis_mi_equipo(), vis_asignar_equipo(uuid, uuid) to authenticated;

-- ── Permisos ────────────────────────────────────────────────────────
alter table vis_equipos enable row level security;
grant select on vis_equipos to authenticated;
create policy equipos_select on vis_equipos for select to authenticated
  using (empresa_id = vis_mi_empresa() or exists (select 1 from vis_vendedores where auth_user_id = auth.uid() and activo and multi_empresa));

-- Usuarios: los de mi empresa y mi equipo (sin equipo: todos), quien tiene todas las empresas, y yo.
alter policy vendedores_select on vis_vendedores
  using ((empresa_id = (select vis_mi_empresa()) and ((select vis_mi_equipo()) is null or equipo_id = (select vis_mi_equipo())))
         or multi_empresa or id = (select vis_mi_id()));

-- Zonas: las de mi equipo y las compartidas (sin equipo: todas las de la empresa).
alter policy zonas_select on vis_zonas
  using (empresa_id = (select vis_mi_empresa())
         and ((select vis_mi_equipo()) is null or equipo_id is null or equipo_id = (select vis_mi_equipo())));
alter policy zonas_write on vis_zonas
  using ((select vis_es_supervisor()) and empresa_id = (select vis_mi_empresa())
         and ((select vis_mi_equipo()) is null or equipo_id = (select vis_mi_equipo())))
  with check ((select vis_es_supervisor()) and empresa_id = (select vis_mi_empresa())
         and ((select vis_mi_equipo()) is null or equipo_id = (select vis_mi_equipo())));

-- Lo que ya usa Camping 44 es de Mayorista (zonas cargadas y su gente); Alejandro, Venta externa.
update vis_zonas set equipo_id = (select q.id from vis_equipos q join vis_empresas e on e.id = q.empresa_id where e.nombre = 'Camping 44' and q.nombre = 'Mayorista')
where empresa_id = (select id from vis_empresas where nombre = 'Camping 44');
update vis_vendedores set equipo_id = (select q.id from vis_equipos q join vis_empresas e on e.id = q.empresa_id where e.nombre = 'Camping 44' and q.nombre = 'Mayorista')
where email in ('jorgelezcano@camping44.com.py', 'humbertobenitez@camping44.com.py', 'danvelastiqui@camping44.com.py', 'antoniofernandez@camping44.com.py');
update vis_vendedores set equipo_id = (select q.id from vis_equipos q join vis_empresas e on e.id = q.empresa_id where e.nombre = 'Camping 44' and q.nombre = 'Venta externa')
where email = 'alejandrorahi@camping44.com.py';
