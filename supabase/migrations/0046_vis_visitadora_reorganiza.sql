-- La visitadora ve su semana y la reorganiza (24/11, pedido de Sergio: «Noelia tiene que poder anticipar los
-- siguientes días y reorganizar en todo caso»). Solo lo suyo, de hoy en adelante, dentro de la semana de la ruta y
-- sin tocar lo que ya tiene visita, llegada o «no pude visitar». Los médicos del plan viajan con el lugar.
-- El supervisor ve qué movió y de qué día venía (`dia_anterior`, `movida_el`).

alter table vis_ruta_paradas add column if not exists dia_anterior date;
alter table vis_ruta_paradas add column if not exists movida_el timestamptz;

-- Parada de la visitadora (o de alguien de un supervisor) que todavía se puede mover.
create or replace function vis_parada_movible(p_parada uuid) returns vis_ruta_paradas
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  p vis_ruta_paradas;
  r vis_rutas;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into p from vis_ruta_paradas where id = p_parada;
  if not found then raise exception 'No encontramos esa parada.'; end if;
  select * into r from vis_rutas where id = p.ruta_id;
  if not (r.vendedor_id = v_yo and r.estado in ('publicada', 'cerrada') and exists (select 1 from vis_vendedores where id = v_yo and tipo = 'medica'))
     and not (vis_es_supervisor() and vis_vendedor_visible(r.vendedor_id)) then
    raise exception 'Esa parada no es tuya.';
  end if;
  if p.dia < vis_hoy() then raise exception 'Ese día ya pasó.'; end if;
  if exists (select 1 from vis_visitas where ruta_parada_id = p.id)
     or exists (select 1 from vis_llegadas where parada_id = p.id)
     or exists (select 1 from vis_no_visitados where parada_id = p.id) then
    raise exception 'Ese lugar ya tiene visitas o llegada: no se mueve.';
  end if;
  return p;
end $$;
revoke execute on function vis_parada_movible(uuid) from anon, authenticated, public;

-- Pasar un lugar a otro día de la misma semana (queda último en ese día).
create or replace function vis_mover_parada(p_parada uuid, p_dia date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p vis_ruta_paradas := vis_parada_movible(p_parada);
  r vis_rutas;
begin
  select * into r from vis_rutas where id = p.ruta_id;
  if p_dia = p.dia then return jsonb_build_object('ok', true); end if;
  if p_dia < vis_hoy() then raise exception 'No se puede pasar a un día que ya pasó.'; end if;
  if p_dia < r.semana_inicio or p_dia > r.semana_inicio + 6 then raise exception 'Solo se puede mover dentro de la misma semana.'; end if;
  if exists (select 1 from vis_ruta_paradas where ruta_id = p.ruta_id and cliente_id = p.cliente_id and dia = p_dia) then
    raise exception 'Ese lugar ya está ese día.';
  end if;
  update vis_ruta_paradas set
    dia_anterior = coalesce(dia_anterior, dia), dia = p_dia, movida_el = now(),
    orden = coalesce((select max(orden) from vis_ruta_paradas where ruta_id = p.ruta_id and dia = p_dia), 0) + 1
  where id = p.id;
  return jsonb_build_object('ok', true);
end $$;

-- Ordenar los lugares de un día (los que se pueden mover; los visitados quedan donde estaban).
create or replace function vis_ordenar_paradas(p_paradas uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_dia date; v_ruta uuid; p vis_ruta_paradas; i int := 0;
  v_ordenes int[];
begin
  foreach v_id in array p_paradas loop
    p := vis_parada_movible(v_id);
    if v_dia is null then v_dia := p.dia; v_ruta := p.ruta_id;
    elsif p.dia <> v_dia or p.ruta_id <> v_ruta then raise exception 'Ordená los lugares de un día a la vez.'; end if;
  end loop;
  -- Los números de orden que ya ocupaban, en el orden nuevo (no se pisan los de las paradas visitadas).
  select array_agg(orden order by orden) into v_ordenes from vis_ruta_paradas where id = any(p_paradas);
  foreach v_id in array p_paradas loop
    i := i + 1;
    update vis_ruta_paradas set orden = v_ordenes[i], movida_el = now() where id = v_id and orden is distinct from v_ordenes[i];
  end loop;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function vis_mover_parada(uuid, date) from anon, public;
revoke execute on function vis_ordenar_paradas(uuid[]) from anon, public;
grant execute on function vis_mover_parada(uuid, date) to authenticated;
grant execute on function vis_ordenar_paradas(uuid[]) to authenticated;
