-- «Me equivoqué, quitar» (12/11): la visitadora deshace una llegada marcada por error (Noelia marcó La Costa
-- Artigas sin querer). Solo la propia, dentro de los 30 minutos y si no registró visitas ahí después de esa llegada.
-- Saca la parada que se había sumado (si no tiene visitas ni otras llegadas) y, si la llegada le había puesto
-- la primera ubicación al lugar, se la quita (podía ser de otro lado).
create or replace function vis_quitar_llegada(p_llegada uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  v_ll vis_llegadas;
  v_dia date;
  v_parada_quitada boolean := false;
  v_ubic_quitada boolean := false;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into v_ll from vis_llegadas where id = p_llegada and vendedor_id = v_yo;
  if not found then raise exception 'No encontramos esa llegada.'; end if;
  if v_ll.created_at < now() - interval '30 minutes' then
    raise exception 'Pasaron más de 30 minutos: pedile a tu supervisor que la quite.';
  end if;
  v_dia := (v_ll.fecha_hora at time zone 'America/Asuncion')::date;
  -- Las visitas de antes (por ejemplo, a la mañana) no impiden quitar una llegada de la tarde.
  if exists (select 1 from vis_visitas v where v.vendedor_id = v_yo and v.cliente_id = v_ll.lugar_id
             and (v.fecha_hora at time zone 'America/Asuncion')::date = v_dia and v.fecha_hora >= v_ll.fecha_hora) then
    raise exception 'Ya registraste visitas después de esta llegada: no se puede quitar.';
  end if;
  delete from vis_llegadas where id = v_ll.id;
  if v_ll.parada_id is not null then
    delete from vis_ruta_paradas p where p.id = v_ll.parada_id
      and not exists (select 1 from vis_visitas v where v.ruta_parada_id = p.id)
      and not exists (select 1 from vis_llegadas l where l.parada_id = p.id);
    v_parada_quitada := found;
  end if;
  -- La primera ubicación del lugar, si la puso esta llegada.
  update vis_clientes c set lat = null, lng = null, origen_ubicacion = null, ubicacion_precision_m = null,
    ubicacion_actualizada_por = null, ubicacion_actualizada_el = null
  where c.id = v_ll.lugar_id and c.ubicacion_actualizada_por = v_yo
    and c.ubicacion_actualizada_el between v_ll.created_at - interval '1 minute' and v_ll.created_at + interval '1 minute'
    and exists (select 1 from vis_cliente_ubicaciones_hist h where h.cliente_id = c.id and h.motivo = 'Primera ubicación, tomada al llegar'
                and h.created_at between v_ll.created_at - interval '1 minute' and v_ll.created_at + interval '1 minute')
    and not exists (select 1 from vis_cliente_ubicaciones_hist h where h.cliente_id = c.id and h.created_at < v_ll.created_at - interval '1 minute');
  v_ubic_quitada := found;
  if v_ubic_quitada then
    insert into vis_cliente_ubicaciones_hist (cliente_id, lat, lng, precision_m, origen, motivo, usuario_id)
    select v_ll.lugar_id, v_ll.lat, v_ll.lng, v_ll.precision_m, 'gps_visita', 'Se quitó: era de una llegada marcada por error', v_yo;
  end if;
  return jsonb_build_object('ok', true, 'parada_quitada', v_parada_quitada, 'ubicacion_quitada', v_ubic_quitada);
end $$;
revoke execute on function vis_quitar_llegada(uuid) from anon, public;
grant execute on function vis_quitar_llegada(uuid) to authenticated;

-- Volver al mismo lugar en el día (a la mañana un médico, a la tarde otro): se marcan varias llegadas.
-- El ruteo de la semana suma todas las horas de llegada de ese día (llegadas), además de la primera (llegada),
-- y en un lugar sin objetivos muestra todas las visitas del día (antes, solo la última).
drop function vis_ruteo_semana(uuid, date);
create function vis_ruteo_semana(p_vendedor uuid, p_semana date)
returns table (dia date, orden int, parada_id uuid, lugar_id uuid, lugar text, tipo_lugar text, direccion text, notas text,
               lat double precision, lng double precision, objetivo_id uuid, medico_id uuid, medico text, especialidad text,
               visita_id uuid, fecha_hora timestamptz, resultado text, medico_visitado text, observaciones text,
               proxima_visita date, productos jsonb, llegada timestamptz, llegadas timestamptz[])
language sql stable security invoker set search_path = public as $$
  select pa.dia, pa.orden, pa.id, c.id, c.razon_social, c.tipo_lugar, c.direccion, c.notas, c.lat, c.lng,
         o.id, o.medico_id, m.nombre, coalesce(nullif(btrim(o.especialidad), ''), m.especialidad),
         v.id, v.fecha_hora, rs.nombre, vm.nombre, v.observaciones, v.proxima_visita, v.productos,
         ll.horas[1], ll.horas
  from vis_rutas r
  join vis_ruta_paradas pa on pa.ruta_id = r.id
  join vis_clientes c on c.id = pa.cliente_id
  left join vis_parada_objetivos o on o.parada_id = pa.id
  left join vis_medicos m on m.id = o.medico_id
  left join lateral (
    select array_agg(l.fecha_hora order by l.fecha_hora) as horas from vis_llegadas l
    where l.vendedor_id = r.vendedor_id and l.lugar_id = pa.cliente_id and (l.fecha_hora at time zone 'America/Asuncion')::date = pa.dia) ll on true
  -- Con objetivo: la última visita a ese médico (o especialidad). Sin objetivo (ella arma su ruta): todas las
  -- visitas del día en el lugar, una fila por médico visitado (a la mañana uno, a la tarde otro).
  left join lateral (
    select * from (
      select v.*, row_number() over (order by v.fecha_hora desc) as n
      from vis_visitas v left join vis_medicos x on x.id = v.medico_id
      where v.vendedor_id = r.vendedor_id and v.cliente_id = pa.cliente_id
        and (v.fecha_hora at time zone 'America/Asuncion')::date = pa.dia
        and (o.id is null
             or (o.medico_id is not null and v.medico_id = o.medico_id)
             or (o.medico_id is null and x.especialidad ilike btrim(o.especialidad)))) w
    where o.id is null or w.n = 1) v on true
  left join vis_medicos vm on vm.id = v.medico_id
  left join vis_resultados rs on rs.id = v.resultado_id
  where r.vendedor_id = p_vendedor and r.semana_inicio = date_trunc('week', p_semana)::date
    and r.estado in ('publicada', 'cerrada', 'borrador')
  order by pa.dia, pa.orden, o.orden, m.nombre, v.fecha_hora
$$;
revoke execute on function vis_ruteo_semana(uuid, date) from anon, public;
grant execute on function vis_ruteo_semana(uuid, date) to authenticated;
