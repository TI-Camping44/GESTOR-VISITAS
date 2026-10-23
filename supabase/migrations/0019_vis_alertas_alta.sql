-- Altas a revisar (pedido de Facundo, 23/10): cuando un vendedor da de alta un cliente en la zona
-- de otro vendedor, o a menos de 300 m de clientes de otro vendedor, queda una alerta para el
-- supervisor. La detecta la base al insertar el cliente (sirve también para altas hechas sin señal).

create table vis_alertas_alta (
  id            bigserial primary key,
  cliente_id    uuid not null references vis_clientes(id) on delete cascade,
  vendedor_id   uuid not null references vis_vendedores(id),             -- quien dio el alta
  zona_id       uuid references vis_zonas(id) on delete set null,        -- zona donde cayó
  dueno_zona_id uuid references vis_vendedores(id) on delete set null,   -- vendedor de esa zona, si es otro
  vecinos       jsonb not null default '[]',                             -- clientes de otros a < 300 m
  creada_el     timestamptz not null default now(),
  revisada_el   timestamptz,
  revisada_por  uuid references vis_vendedores(id) on delete set null,
  decision      text check (decision in ('pasado', 'queda'))
);
create index on vis_alertas_alta (revisada_el) where revisada_el is null;
create index on vis_alertas_alta (cliente_id);

create or replace function vis_alerta_alta() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_empresa uuid;
  v_dueno uuid;
  v_vecinos jsonb;
begin
  -- Solo altas hechas en la app (no lo que trae el sync de Odoo).
  if new.creado_por is null or new.odoo_partner_id is not null then return new; end if;
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
create trigger vis_clientes_alerta_alta after insert on vis_clientes
  for each row execute function vis_alerta_alta();
revoke execute on function vis_alerta_alta() from anon, authenticated, public;

-- Permisos: el supervisor ve y resuelve las de su gente (la que cargó o la dueña de la zona).
alter table vis_alertas_alta enable row level security;
grant select on vis_alertas_alta to authenticated;
grant update (revisada_el, revisada_por, decision) on vis_alertas_alta to authenticated;
create policy alertas_alta_select on vis_alertas_alta for select to authenticated
  using ((select vis_es_supervisor()) and (vis_vendedor_visible(vendedor_id) or vis_vendedor_visible(dueno_zona_id)));
create policy alertas_alta_update on vis_alertas_alta for update to authenticated
  using ((select vis_es_supervisor()) and (vis_vendedor_visible(vendedor_id) or vis_vendedor_visible(dueno_zona_id)))
  with check ((select vis_es_supervisor()));
