-- Recuperar en el mes las visitas no efectivas (28/11, pedido de Sergio y Noelia: «si en la primera semana tuve
-- varias visitas que no fueron efectivas, ¿cómo las recalendarizo dentro del mismo mes? Que se pasen a la última
-- semana automáticamente»).
--
-- Cuando la visitadora registra que no vio a un médico de su plan del día (Visita no efectiva, No estaba, Sin acceso,
-- Pidió volver otro día, Otro motivo; no «Ya no atiende acá») o marca «No pude visitar este lugar», ese médico se suma
-- solo a su ruta en la última semana del mes: el mismo día de la semana (los últimos 7 días del mes tienen cada día
-- una vez, y el médico atiende ese día), en el mismo lugar, con la misma hora pactada. No se suma si ya pasó a la
-- última semana, si ya tiene otra visita planeada más adelante en el mes o si ya lo vio después. Si después lo ve
-- (visita efectiva) antes de esa fecha, la recuperación se quita sola. Deshacer el «No pude visitar» o cambiar la
-- visita a efectiva también la quita. El supervisor la ve y la puede borrar o mover en «Armar el día».

alter table vis_parada_objetivos add column if not exists recupera_dia date;
alter table vis_parada_objetivos add column if not exists recupera_motivo text;
alter table vis_parada_objetivos add column if not exists origen_visita_id uuid references vis_visitas (id) on delete cascade;
alter table vis_parada_objetivos add column if not exists origen_no_visitado_id uuid references vis_no_visitados (id) on delete cascade;
alter table vis_ruta_paradas add column if not exists recuperacion boolean not null default false;
create index if not exists vis_parada_objetivos_medico_idx on vis_parada_objetivos (medico_id) where medico_id is not null;

comment on column vis_parada_objetivos.recupera_dia is 'Día de la visita no efectiva que este objetivo recupera (se sumó solo a la última semana del mes).';
comment on column vis_ruta_paradas.recuperacion is 'La parada se creó solo para recuperar visitas no efectivas: si se quedan sin objetivos y sin actividad, se borra.';

-- Día para recuperar una visita del día p_dia: el mismo día de la semana dentro de los últimos 7 días del mes.
-- Nulo si ese día no es posterior (la visita ya era de la última semana).
create or replace function vis_dia_recupero(p_dia date) returns date
language sql immutable set search_path = public as $$
  select case when r > p_dia then r end
  from (select fin - ((extract(isodow from fin)::int - extract(isodow from p_dia)::int + 7) % 7) as r
        from (select (date_trunc('month', p_dia) + interval '1 month' - interval '1 day')::date as fin) f) x
$$;

-- ¿La visita no vio al médico, por un motivo que se puede volver a intentar? («Ya no atiende acá» no.)
create or replace function vis_visita_no_efectiva(p_resultado int, p_detalle int) returns boolean
language sql stable set search_path = public as $$
  -- Sin mayúsculas: en el panel se puede escribir distinto («Visita NO efectiva»).
  select coalesce((select lower(btrim(nombre)) in ('visita no efectiva', 'no estaba / no atendió', 'sin acceso', 'pidió volver otro día', 'otro motivo')
                   from vis_resultados where id = p_resultado), false)
     and not coalesce((select lower(btrim(nombre)) = 'ya no atiende acá' from vis_resultados where id = p_detalle), false)
$$;

-- Suma al médico a la ruta del día de recupero. Devuelve el objetivo creado o nulo si no correspondía.
create or replace function vis_recuperar_medico(p_vendedor uuid, p_lugar uuid, p_medico uuid, p_dia date, p_motivo text,
  p_hora time, p_visita uuid, p_no_visitado uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_dest date := vis_dia_recupero(p_dia);
  v_fin date := (date_trunc('month', p_dia) + interval '1 month' - interval '1 day')::date;
  v_semana date;
  v_ruta uuid;
  v_parada uuid;
  v_nueva boolean := false;
  v_nombre text;
  v_id uuid;
begin
  if v_dest is null or v_dest < vis_hoy() then return null; end if;
  if not exists (select 1 from vis_vendedores where id = p_vendedor and tipo = 'medica') then return null; end if;
  -- Ya lo tiene planeado más adelante en el mes (o ya se recuperó).
  if exists (select 1 from vis_parada_objetivos o join vis_ruta_paradas pa on pa.id = o.parada_id join vis_rutas r on r.id = pa.ruta_id
             where r.vendedor_id = p_vendedor and o.medico_id = p_medico and pa.dia > p_dia and pa.dia <= v_fin) then
    return null;
  end if;
  -- Ya lo vio después (visita efectiva a ese médico más tarde en el mes).
  if exists (select 1 from vis_visitas v where v.vendedor_id = p_vendedor and v.medico_id = p_medico
             and (v.fecha_hora at time zone 'America/Asuncion')::date between p_dia and v_fin
             and (v.fecha_hora at time zone 'America/Asuncion')::date > p_dia
             and not vis_visita_no_efectiva(v.resultado_id, v.detalle_id)) then
    return null;
  end if;

  v_semana := date_trunc('week', v_dest)::date;
  select pa.id into v_parada from vis_ruta_paradas pa join vis_rutas r on r.id = pa.ruta_id
  where r.vendedor_id = p_vendedor and pa.cliente_id = p_lugar and pa.dia = v_dest
  order by r.created_at limit 1;
  if v_parada is null then
    select id into v_ruta from vis_rutas where vendedor_id = p_vendedor and semana_inicio = v_semana order by created_at limit 1;
    if v_ruta is null then
      select split_part(nombre, ' ', 1) into v_nombre from vis_vendedores where id = p_vendedor;
      insert into vis_rutas (nombre, vendedor_id, semana_inicio, estado, creado_por)
      values (format('Visita médica – Sem %s – %s', extract(week from v_semana)::int, v_nombre), p_vendedor, v_semana, 'publicada', p_vendedor)
      returning id into v_ruta;
    end if;
    insert into vis_ruta_paradas (ruta_id, cliente_id, dia, orden, recuperacion)
    values (v_ruta, p_lugar, v_dest, coalesce((select max(orden) from vis_ruta_paradas where ruta_id = v_ruta and dia = v_dest), 0) + 1, true)
    returning id into v_parada;
    v_nueva := true;
  end if;

  insert into vis_parada_objetivos (parada_id, medico_id, orden, hora_pactada, recupera_dia, recupera_motivo, origen_visita_id, origen_no_visitado_id)
  values (v_parada, p_medico, coalesce((select max(orden) from vis_parada_objetivos where parada_id = v_parada), 0) + 1, p_hora,
          p_dia, p_motivo, p_visita, p_no_visitado)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function vis_recuperar_medico(uuid, uuid, uuid, date, text, time, uuid, uuid) from anon, authenticated, public;

-- Quita las recuperaciones pendientes de un médico posteriores a p_dia en ese mes (ya lo vio).
create or replace function vis_quitar_recuperos(p_vendedor uuid, p_medico uuid, p_dia date) returns void
language sql security definer set search_path = public as $$
  delete from vis_parada_objetivos o
  using vis_ruta_paradas pa, vis_rutas r
  where pa.id = o.parada_id and r.id = pa.ruta_id and r.vendedor_id = p_vendedor
    and o.medico_id = p_medico and o.recupera_dia is not null
    and pa.dia > p_dia and pa.dia <= (date_trunc('month', p_dia) + interval '1 month' - interval '1 day')::date
    and not exists (select 1 from vis_visitas v where v.ruta_parada_id = pa.id and v.medico_id = p_medico)
$$;
revoke execute on function vis_quitar_recuperos(uuid, uuid, date) from anon, authenticated, public;

-- Visita a un médico: si no lo vio y estaba en el plan del día, se recupera; si lo vio, se quitan las recuperaciones.
create or replace function vis_visita_recupero() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dia date := (new.fecha_hora at time zone 'America/Asuncion')::date;
  o record;
  v_motivo text;
begin
  if new.medico_id is null or new.vendedor_id is null then return null; end if;
  if not exists (select 1 from vis_vendedores where id = new.vendedor_id and tipo = 'medica') then return null; end if;
  if vis_visita_no_efectiva(new.resultado_id, new.detalle_id) then
    -- Lo vio ese mismo día en otra visita: no hay nada que recuperar.
    if exists (select 1 from vis_visitas v where v.vendedor_id = new.vendedor_id and v.medico_id = new.medico_id and v.id <> new.id
               and (v.fecha_hora at time zone 'America/Asuncion')::date = v_dia and not vis_visita_no_efectiva(v.resultado_id, v.detalle_id)) then
      return null;
    end if;
    select ob.hora_pactada into o from vis_parada_objetivos ob join vis_ruta_paradas pa on pa.id = ob.parada_id join vis_rutas r on r.id = pa.ruta_id
    where r.vendedor_id = new.vendedor_id and pa.dia = v_dia and pa.cliente_id = new.cliente_id and ob.medico_id = new.medico_id
    limit 1;
    if not found then return null; end if;  -- solo médicos del plan
    select coalesce(d.nombre, re.nombre) into v_motivo from vis_resultados re left join vis_resultados d on d.id = new.detalle_id where re.id = new.resultado_id;
    perform vis_recuperar_medico(new.vendedor_id, new.cliente_id, new.medico_id, v_dia, v_motivo, o.hora_pactada, new.id, null);
  else
    perform vis_quitar_recuperos(new.vendedor_id, new.medico_id, v_dia);
  end if;
  return null;
end $$;
drop trigger if exists vis_visita_recupero on vis_visitas;
create trigger vis_visita_recupero after insert or update of resultado_id, detalle_id on vis_visitas
  for each row execute function vis_visita_recupero();

-- «No pude visitar este lugar»: se recuperan los médicos del plan de esa parada que no vio ese día.
create or replace function vis_no_visitado_recupero() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dia date := (new.fecha_hora at time zone 'America/Asuncion')::date;
  o record;
begin
  if new.parada_id is null then return null; end if;
  for o in select ob.medico_id, ob.hora_pactada from vis_parada_objetivos ob where ob.parada_id = new.parada_id and ob.medico_id is not null loop
    if not exists (select 1 from vis_visitas v where v.vendedor_id = new.vendedor_id and v.medico_id = o.medico_id
                   and (v.fecha_hora at time zone 'America/Asuncion')::date = v_dia and not vis_visita_no_efectiva(v.resultado_id, v.detalle_id)) then
      perform vis_recuperar_medico(new.vendedor_id, new.lugar_id, o.medico_id, v_dia,
        'No pudo visitar el lugar: ' || coalesce(vis_texto_motivo_no_visita(new.motivo), new.motivo), o.hora_pactada, null, new.id);
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists vis_no_visitado_recupero on vis_no_visitados;
create trigger vis_no_visitado_recupero after insert on vis_no_visitados
  for each row execute function vis_no_visitado_recupero();

-- Una parada creada solo para recuperar que se queda sin médicos y sin actividad se borra.
create or replace function vis_recupero_limpiar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.recupera_dia is not null then
    delete from vis_ruta_paradas pa
    where pa.id = old.parada_id and pa.recuperacion
      and not exists (select 1 from vis_parada_objetivos where parada_id = pa.id)
      and not exists (select 1 from vis_visitas where ruta_parada_id = pa.id)
      and not exists (select 1 from vis_llegadas where parada_id = pa.id)
      and not exists (select 1 from vis_no_visitados where parada_id = pa.id);
  end if;
  return null;
end $$;
drop trigger if exists vis_recupero_limpiar on vis_parada_objetivos;
create trigger vis_recupero_limpiar after delete on vis_parada_objetivos
  for each row execute function vis_recupero_limpiar();
