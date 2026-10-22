-- Zonas por equipo (22/10): un cliente toma la zona de SU vendedor (su empresa y su equipo), así
-- una ciudad puede estar en una zona de Mayorista y en otra de Venta externa sin quedar sin zona.
-- Las ciudades de Odoo vienen como "ASUNCION (DISTRITO)" o "LAMBARE (MUNICIPIO)": se limpian.

create or replace function vis_ciudad_limpia(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(btrim(regexp_replace(coalesce(t, ''), '\s*\([^)]*\)\s*$', '')), '')
$$;

-- Zona de un cliente por su ciudad, entre las de la empresa y el equipo de su vendedor.
-- Sin vendedor: las de la empresa con la que se trabaja (todos los equipos). Ambigua: null.
create or replace function vis_zona_para_cliente(p_ciudad text, p_vendedor uuid) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  with v as (select empresa_id, equipo_id from vis_vendedores where id = p_vendedor)
  select case when count(*) = 1 then (array_agg(z.id))[1] end
  from vis_zonas z
  where z.activo and vis_ciudad_limpia(p_ciudad) is not null
    and z.empresa_id = coalesce((select empresa_id from v), vis_empresa_nueva())
    and ((select equipo_id from v) is null or z.equipo_id is null or z.equipo_id = (select equipo_id from v))
    and exists (select 1 from unnest(z.ciudades || z.ciudades_alias) c where vis_nombre_cmp(c) = vis_nombre_cmp(vis_ciudad_limpia(p_ciudad)))
$$;

-- La de la ciudad sola (alta de cliente, lista de ciudades) también limpia el "(DISTRITO)".
create or replace function vis_zona_por_ciudad(p_ciudad text) returns uuid
language sql stable set search_path = public, extensions as $$
  select case when count(*) = 1 then (array_agg(z.id))[1] end
  from vis_zonas z
  where z.activo and z.empresa_id = vis_empresa_nueva() and vis_ciudad_limpia(p_ciudad) is not null
    and (vis_mi_equipo() is null or z.equipo_id is null or z.equipo_id = vis_mi_equipo())
    and exists (select 1 from unnest(z.ciudades || z.ciudades_alias) c where vis_nombre_cmp(c) = vis_nombre_cmp(vis_ciudad_limpia(p_ciudad)))
$$;

-- Al crear un cliente, cambiarle la ciudad o el vendedor: si no tiene zona, la de su vendedor.
-- Si cambió de vendedor y su zona es de otro equipo, pasa a la del equipo nuevo.
-- Una zona puesta a mano (del mismo equipo) no se toca.
create or replace function vis_cliente_zona_auto() returns trigger
language plpgsql security definer set search_path = public as $$
declare z_equipo uuid; v_equipo uuid;
begin
  if new.ciudad is null then return new; end if;
  if new.zona_id is null then
    new.zona_id := vis_zona_para_cliente(new.ciudad, new.vendedor_id);
  elsif tg_op = 'UPDATE' and new.vendedor_id is distinct from old.vendedor_id and new.zona_id is not distinct from old.zona_id then
    select equipo_id into z_equipo from vis_zonas where id = new.zona_id;
    select equipo_id into v_equipo from vis_vendedores where id = new.vendedor_id;
    if z_equipo is not null and v_equipo is not null and z_equipo <> v_equipo then
      new.zona_id := coalesce(vis_zona_para_cliente(new.ciudad, new.vendedor_id), null);
    end if;
  end if;
  return new;
end $$;
create or replace trigger vis_clientes_zona_auto before insert or update of ciudad, vendedor_id on vis_clientes
  for each row execute function vis_cliente_zona_auto();

-- Botón "Asignar clientes sin zona por ciudad": también corrige los que quedaron en zona de otro equipo.
create or replace function vis_asignar_zonas_por_ciudad() returns int
language plpgsql security invoker set search_path = public as $$
declare v_n int;
begin
  if not vis_es_supervisor() then raise exception 'Solo un supervisor puede asignar zonas.'; end if;
  update vis_clientes c set zona_id = vis_zona_para_cliente(c.ciudad, c.vendedor_id)
  where c.activo and vis_zona_para_cliente(c.ciudad, c.vendedor_id) is not null
    and (c.zona_id is null or exists (
      select 1 from vis_zonas z join vis_vendedores v on v.id = c.vendedor_id
      where z.id = c.zona_id and z.equipo_id is not null and v.equipo_id is not null and z.equipo_id <> v.equipo_id));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function vis_zona_para_cliente(text, uuid), vis_cliente_zona_auto() from anon, public;
grant execute on function vis_zona_para_cliente(text, uuid), vis_ciudad_limpia(text) to authenticated;

-- Datos: ciudades de Odoo sin el "(DISTRITO)" (el trigger les pone zona si no tenían).
update vis_clientes set ciudad = vis_ciudad_limpia(ciudad) where ciudad ~ '\(';
-- Clientes en zona de otro equipo o sin zona: la de su vendedor.
update vis_clientes c set zona_id = vis_zona_para_cliente(c.ciudad, c.vendedor_id)
where c.activo and vis_zona_para_cliente(c.ciudad, c.vendedor_id) is not null
  and (c.zona_id is null or exists (
    select 1 from vis_zonas z join vis_vendedores v on v.id = c.vendedor_id
    where z.id = c.zona_id and z.equipo_id is not null and v.equipo_id is not null and z.equipo_id <> v.equipo_id));
