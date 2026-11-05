-- Ruteo de visita médica (04/11, Sergio y Facundo): «Centro médico / Consultorio · Especialidad · Dr · Día de visita».
-- Cada parada (lugar + día) lleva a qué médicos ir, o qué especialidad buscar cuando todavía no se conoce al médico.
-- La planilla se pega en el panel (vis_cargar_ruteo) y el panel muestra la semana con lo que pasó (vis_ruteo_semana).

create table vis_parada_objetivos (
  id           uuid primary key default gen_random_uuid(),
  parada_id    uuid not null references vis_ruta_paradas(id) on delete cascade,
  medico_id    uuid references vis_medicos(id) on delete cascade,
  especialidad text,
  orden        int not null default 0,
  check (medico_id is not null or nullif(btrim(especialidad), '') is not null)
);
create index on vis_parada_objetivos (parada_id);
create index on vis_parada_objetivos (medico_id);

alter table vis_parada_objetivos enable row level security;
grant select, insert, update, delete on vis_parada_objetivos to authenticated;
create policy objetivos_select on vis_parada_objetivos for select to authenticated
  using (exists (select 1 from vis_ruta_paradas p join vis_rutas r on r.id = p.ruta_id where p.id = parada_id and (
    ((select vis_es_supervisor()) and vis_vendedor_visible(r.vendedor_id))
    or (r.vendedor_id = (select vis_mi_id()) and r.estado in ('publicada','cerrada')))));
create policy objetivos_write on vis_parada_objetivos for all to authenticated
  using ((select vis_es_supervisor()) and exists (select 1 from vis_ruta_paradas p join vis_rutas r on r.id = p.ruta_id
    where p.id = parada_id and vis_vendedor_visible(r.vendedor_id)))
  with check ((select vis_es_supervisor()) and exists (select 1 from vis_ruta_paradas p join vis_rutas r on r.id = p.ruta_id
    where p.id = parada_id and vis_vendedor_visible(r.vendedor_id)));

-- Estados de la planilla de Sergio: Pendiente / Visitado / Reprogramado («Pidió volver otro día») / Sin acceso.
insert into vis_resultados (nombre, es_venta, orden, tipo) values ('Sin acceso', false, 5, 'medica')
on conflict (nombre) do nothing;

-- Pegar el ruteo de la semana.
-- p: {visitadora_id, semana (cualquier día de la semana), publicar?, reemplazar?,
--     filas: [{dia (yyyy-mm-dd), lugar, especialidad?, medico?, direccion?, lat?, lng?}]}
-- Busca o crea el lugar y el médico (por nombre, de esa visitadora), arma la ruta de la semana
-- (una por visitadora y semana) y deja los objetivos de cada parada.
-- reemplazar: antes saca las paradas de esos días que todavía no tienen visita, y los objetivos de esos días.
create or replace function vis_cargar_ruteo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  v_vis vis_vendedores;
  v_semana date := date_trunc('week', (p ->> 'semana')::date)::date;
  v_ruta uuid;
  v_f jsonb;
  v_dia date;
  v_nombre text;
  v_medico_n text;
  v_esp text;
  v_lugar vis_clientes;
  v_lugar_id uuid;
  v_parada uuid;
  v_medico uuid;
  v_lat double precision;
  v_lng double precision;
  v_dias date[];
  v_paradas int := 0;
  v_objetivos int := 0;
  v_lugares_n int := 0;
  v_medicos_n int := 0;
begin
  if v_yo is null or not vis_es_supervisor() then raise exception 'Solo un supervisor o un admin carga el ruteo.'; end if;
  if v_semana is null then raise exception 'Falta la semana.'; end if;
  select * into v_vis from vis_vendedores where id = (p ->> 'visitadora_id')::uuid and activo;
  if not found or v_vis.tipo <> 'medica' or not vis_vendedor_visible(v_vis.id) then
    raise exception 'Elegí una visitadora médica de tu empresa.';
  end if;

  select array_agg(distinct (f ->> 'dia')::date) into v_dias from jsonb_array_elements(coalesce(p -> 'filas', '[]'::jsonb)) f;
  if v_dias is null then raise exception 'La planilla no tiene filas.'; end if;
  if exists (select 1 from unnest(v_dias) d where d < v_semana or d > v_semana + 6) then
    raise exception 'Hay días que no son de la semana del %.', to_char(v_semana, 'DD/MM/YYYY');
  end if;

  select id into v_ruta from vis_rutas where vendedor_id = v_vis.id and semana_inicio = v_semana order by created_at limit 1;
  if v_ruta is null then
    insert into vis_rutas (nombre, vendedor_id, semana_inicio, estado, creado_por)
    values (format('Visita médica – Sem %s – %s', extract(week from v_semana)::int, split_part(v_vis.nombre, ' ', 1)),
            v_vis.id, v_semana, case when coalesce((p ->> 'publicar')::boolean, true) then 'publicada' else 'borrador' end::vis_estado_ruta, v_yo)
    returning id into v_ruta;
  elsif coalesce((p ->> 'publicar')::boolean, true) then
    update vis_rutas set estado = 'publicada' where id = v_ruta and estado = 'borrador';
  end if;

  if coalesce((p ->> 'reemplazar')::boolean, false) then
    delete from vis_parada_objetivos o using vis_ruta_paradas pa
    where o.parada_id = pa.id and pa.ruta_id = v_ruta and pa.dia = any (v_dias);
    delete from vis_ruta_paradas pa
    where pa.ruta_id = v_ruta and pa.dia = any (v_dias)
      and not exists (select 1 from vis_visitas v where v.ruta_parada_id = pa.id);
  end if;

  for v_f in select * from jsonb_array_elements(p -> 'filas') loop
    v_dia := (v_f ->> 'dia')::date;
    v_nombre := btrim(coalesce(v_f ->> 'lugar', ''));
    continue when v_nombre = '';
    v_medico_n := nullif(btrim(coalesce(v_f ->> 'medico', '')), '');
    v_esp := nullif(btrim(coalesce(v_f ->> 'especialidad', '')), '');
    v_lat := nullif(v_f ->> 'lat', '')::double precision;
    v_lng := nullif(v_f ->> 'lng', '')::double precision;

    -- Lugar
    select * into v_lugar from vis_clientes c
    where c.categoria = 'lugar' and c.vendedor_id = v_vis.id and lower(c.razon_social) = lower(v_nombre)
    order by c.activo desc limit 1;
    if not found then
      insert into vis_clientes (razon_social, categoria, direccion, ciudad, empresa_id, vendedor_id, creado_por)
      values (v_nombre, 'lugar', nullif(btrim(v_f ->> 'direccion'), ''), nullif(btrim(v_f ->> 'ciudad'), ''), v_vis.empresa_id, v_vis.id, v_yo)
      returning * into v_lugar;
      v_lugares_n := v_lugares_n + 1;
    elsif not v_lugar.activo then
      update vis_clientes set activo = true, updated_at = now() where id = v_lugar.id;
    end if;
    v_lugar_id := v_lugar.id;
    if v_lugar.direccion is null and nullif(btrim(v_f ->> 'direccion'), '') is not null then
      update vis_clientes set direccion = btrim(v_f ->> 'direccion') where id = v_lugar_id;
    end if;
    -- La ubicación de la planilla solo si el lugar no tiene una (la del GPS de la visita manda).
    if v_lugar.lat is null and v_lat between -90 and 90 and v_lng between -180 and 180 then
      update vis_clientes set lat = v_lat, lng = v_lng, origen_ubicacion = 'manual', ubicacion_precision_m = null,
        ubicacion_actualizada_por = v_yo, ubicacion_actualizada_el = now() where id = v_lugar_id;
      insert into vis_cliente_ubicaciones_hist (cliente_id, lat, lng, origen, motivo, usuario_id)
      values (v_lugar_id, v_lat, v_lng, 'manual', 'Ruteo cargado desde el panel', v_yo);
    end if;

    -- Parada (una por lugar y día; el orden es el de la planilla)
    select id into v_parada from vis_ruta_paradas where ruta_id = v_ruta and cliente_id = v_lugar_id and dia = v_dia;
    if v_parada is null then
      insert into vis_ruta_paradas (ruta_id, cliente_id, dia, orden)
      values (v_ruta, v_lugar_id, v_dia, coalesce((select max(orden) from vis_ruta_paradas where ruta_id = v_ruta and dia = v_dia), 0) + 1)
      returning id into v_parada;
      v_paradas := v_paradas + 1;
    end if;

    -- Médico (de la visitadora; se suma al lugar si no estaba)
    v_medico := null;
    if v_medico_n is not null then
      select id into v_medico from vis_medicos
      where visitadora_id = v_vis.id and activo and lower(nombre) = lower(v_medico_n) order by created_at limit 1;
      if v_medico is null then
        insert into vis_medicos (empresa_id, nombre, especialidad, visitadora_id, creado_por)
        values (v_vis.empresa_id, v_medico_n, v_esp, v_vis.id, v_yo) returning id into v_medico;
        v_medicos_n := v_medicos_n + 1;
      elsif v_esp is not null then
        update vis_medicos set especialidad = v_esp where id = v_medico and especialidad is null;
      end if;
      insert into vis_medico_lugares (medico_id, lugar_id) values (v_medico, v_lugar_id) on conflict do nothing;
    end if;

    -- Objetivo (sin repetir)
    if v_medico is not null or v_esp is not null then
      if not exists (select 1 from vis_parada_objetivos o where o.parada_id = v_parada and (
           (v_medico is not null and o.medico_id = v_medico)
           or (v_medico is null and o.medico_id is null and lower(o.especialidad) = lower(v_esp)))) then
        insert into vis_parada_objetivos (parada_id, medico_id, especialidad, orden)
        values (v_parada, v_medico, v_esp, (select count(*) from vis_parada_objetivos where parada_id = v_parada));
        v_objetivos := v_objetivos + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ruta_id', v_ruta, 'paradas', v_paradas, 'objetivos', v_objetivos,
    'lugares_nuevos', v_lugares_n, 'medicos_nuevos', v_medicos_n);
end $$;
revoke execute on function vis_cargar_ruteo(jsonb) from anon, public;
grant execute on function vis_cargar_ruteo(jsonb) to authenticated;

-- La semana de una visitadora como la planilla: una fila por objetivo (o por parada sin objetivos),
-- con la visita de ese día que le corresponde (al médico, o a un médico de esa especialidad, o al lugar).
create or replace function vis_ruteo_semana(p_vendedor uuid, p_semana date)
returns table (dia date, orden int, parada_id uuid, lugar_id uuid, lugar text, tipo_lugar text, direccion text, notas text,
               lat double precision, lng double precision, objetivo_id uuid, medico_id uuid, medico text, especialidad text,
               visita_id uuid, fecha_hora timestamptz, resultado text, medico_visitado text, observaciones text,
               proxima_visita date, productos jsonb)
language sql stable security invoker set search_path = public as $$
  select pa.dia, pa.orden, pa.id, c.id, c.razon_social, c.tipo_lugar, c.direccion, c.notas, c.lat, c.lng,
         o.id, o.medico_id, m.nombre, coalesce(nullif(btrim(o.especialidad), ''), m.especialidad),
         v.id, v.fecha_hora, rs.nombre, vm.nombre, v.observaciones, v.proxima_visita, v.productos
  from vis_rutas r
  join vis_ruta_paradas pa on pa.ruta_id = r.id
  join vis_clientes c on c.id = pa.cliente_id
  left join vis_parada_objetivos o on o.parada_id = pa.id
  left join vis_medicos m on m.id = o.medico_id
  left join lateral (
    select v.* from vis_visitas v left join vis_medicos x on x.id = v.medico_id
    where v.vendedor_id = r.vendedor_id and v.cliente_id = pa.cliente_id
      and (v.fecha_hora at time zone 'America/Asuncion')::date = pa.dia
      and (o.id is null
           or (o.medico_id is not null and v.medico_id = o.medico_id)
           or (o.medico_id is null and x.especialidad ilike btrim(o.especialidad)))
    order by v.fecha_hora desc limit 1) v on true
  left join vis_medicos vm on vm.id = v.medico_id
  left join vis_resultados rs on rs.id = v.resultado_id
  where r.vendedor_id = p_vendedor and r.semana_inicio = date_trunc('week', p_semana)::date
    and r.estado in ('publicada', 'cerrada', 'borrador')
  order by pa.dia, pa.orden, o.orden, m.nombre
$$;
revoke execute on function vis_ruteo_semana(uuid, date) from anon, public;
grant execute on function vis_ruteo_semana(uuid, date) to authenticated;
