-- ════════════════════════════════════════════════════════════════════
-- Zonas reales de Camping 44 (cuadro de Facundo, 07/10/2026):
-- cada zona tiene sus ciudades, la semana del mes en que se visita y el
-- vendedor responsable. Los clientes toman la zona por su ciudad.
-- ════════════════════════════════════════════════════════════════════

alter table vis_zonas
  add column ciudades     text[] not null default '{}',   -- nombres y variantes ("Ciudad del Este", "CDE")
  add column semanas_mes  int[]  not null default '{}' check (semanas_mes <@ array[1,2,3,4,5]),
  add column frecuencia   text,                            -- como lo dice el negocio: "3ra semana", "cada 15 días"
  add column vendedor_id  uuid references vis_vendedores(id) on delete set null,
  add column responsable  text;                            -- nombre del vendedor hasta que tenga acceso a la app

-- Zona que corresponde a una ciudad. Si la ciudad está en más de una zona activa
-- (ej. Asunción, que se reparte en dos quincenas) devuelve null: la asigna el supervisor.
create or replace function vis_zona_por_ciudad(p_ciudad text) returns uuid
language sql stable set search_path = public, extensions as $$
  select case when count(*) = 1 then (array_agg(z.id))[1] end
  from vis_zonas z
  where z.activo and btrim(coalesce(p_ciudad, '')) <> ''
    and exists (select 1 from unnest(z.ciudades) c where vis_nombre_cmp(c) = vis_nombre_cmp(p_ciudad))
$$;

-- Al crear un cliente o cambiarle la ciudad, si no tiene zona, se la pone sola.
-- Una zona ya asignada (a mano o antes) no se toca.
create or replace function vis_cliente_zona_auto() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.zona_id is null and new.ciudad is not null then
    new.zona_id := vis_zona_por_ciudad(new.ciudad);
  end if;
  return new;
end $$;
create trigger vis_clientes_zona_auto before insert or update of ciudad on vis_clientes
  for each row execute function vis_cliente_zona_auto();

-- Botón "Asignar por ciudad" del panel: completa la zona de los clientes que no tienen.
create or replace function vis_asignar_zonas_por_ciudad() returns int
language plpgsql security invoker set search_path = public as $$
declare v_n int;
begin
  if not vis_es_supervisor() then raise exception 'Solo un supervisor puede asignar zonas.'; end if;
  update vis_clientes c set zona_id = vis_zona_por_ciudad(c.ciudad)
  where c.zona_id is null and c.activo and vis_zona_por_ciudad(c.ciudad) is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function vis_cliente_zona_auto() from anon, authenticated, public;
grant execute on function vis_zona_por_ciudad(text), vis_asignar_zonas_por_ciudad() to authenticated;

-- ── Zonas de Camping 44 ─────────────────────────────────────────────
insert into vis_zonas (nombre, color, responsable, frecuencia, semanas_mes, ciudades) values
  ('Zona Norte 1', '#16a34a', 'Antonio Fernández', '3ra semana', '{3}',
    array['Azotey', 'Yby Yaú', 'Pedro Juan Caballero', 'PJC', 'Bella Vista', 'Bella Vista Norte', 'Horqueta', 'Concepción']),
  ('Zona Norte 2', '#15803d', 'Antonio Fernández', '1ra semana', '{1}',
    array['Guayaibí', 'Nueva Durango', 'Nva Durango', 'Liberación', 'San Pedro', 'San Pedro del Ycuamandiyú', 'San Pedro de Ycuamandiyú',
          'Resquín', 'General Resquín', 'Santa Rosa del Aguaray', 'Santa Rosa Aguaray', 'Choré', 'Río Verde']),
  ('Zona Norte 3', '#4d7c0f', 'Antonio Fernández', '2da semana', '{2}',
    array['Itacurubí del Rosario', 'Itac Rosario', 'Friesland', 'Santaní', 'San Estanislao', 'Capiibary', 'Curuguaty',
          'Salto del Guairá', 'Saltos del Guairá', 'La Paloma', 'La Paloma del Espíritu Santo', 'Katueté', 'Nueva Esperanza', 'Nva Esperanza']),
  ('Zona Chaco', '#a16207', 'Antonio Fernández', '4ta semana', '{4}',
    array['Loma Plata', 'Filadelfia', 'Neuland', 'Mariscal Estigarribia', 'Mcal Estigarribia', 'Alto Paraguay']),
  ('Zona Este 1', '#d97706', 'Dan Velastiqui', '4ta semana', '{4}',
    array['Coronel Oviedo', 'Cnel Oviedo', 'Caaguazú', 'J. Eulogio Estigarribia', 'J E Estigarribia', 'Juan Eulogio Estigarribia', 'Campo 9',
          'Santa Rita', 'Sta Rita', 'Naranjal', 'San Cristóbal', 'O''Leary', 'Juan Emilio O''Leary', 'Oleary']),
  ('Zona Este 2', '#ea580c', 'Dan Velastiqui', '2da semana', '{2}',
    array['Hernandarias', 'San Alberto', 'Ciudad del Este', 'CDE', 'Presidente Franco', 'Pte Franco']),
  ('Zona Sur', '#2563eb', 'Dan Velastiqui', '1ra semana', '{1}',
    array['Pilar', 'Ayolas', 'Encarnación', 'Hohenau', 'Obligado', 'María Auxiliadora', 'M Auxiliadora', 'Fram']),
  ('Zona Sur Oeste', '#0891b2', 'Dan Velastiqui', '3ra semana', '{3}',
    array['Paraguarí', 'Colonia Pfannl', 'Col Pfannel', 'Colonia Independencia', 'Col Independencia', 'Villarrica',
          'San Juan Nepomuceno', 'Yuty', 'San Pedro del Paraná']),
  ('Asunción 1ra y 3ra', '#9333ea', 'Humberto Benítez', 'cada 15 días', '{1,3}',
    array['Asunción', 'Asunción Centro', 'Mariano Roque Alonso', 'Mariano', 'Luque', 'Lambaré', 'Fernando de la Mora', 'Fdo de la Mora',
          'San Lorenzo', 'Ñemby', 'Guarambaré', 'Ypané', 'Capiatá', 'Itauguá', 'Itá', 'Yaguarón']),
  ('Asunción 2da y 4ta', '#be185d', 'Humberto Benítez', 'cada 15 días', '{2,4}',
    array['Asunción', 'Asunción Centro', 'Mariano Roque Alonso', 'Mariano', 'Luque', 'Lambaré', 'Fernando de la Mora', 'Fdo de la Mora',
          'San Lorenzo', 'Ñemby', 'Guarambaré', 'Ypané', 'Capiatá', 'Itauguá', 'Itá', 'Yaguarón'])
on conflict (nombre) do nothing;
