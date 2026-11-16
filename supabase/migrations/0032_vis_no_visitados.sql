-- «No pude visitar este lugar» (16/11, pedido de Facundo): la visitadora va a un hospital o consultorio y no
-- puede visitar a nadie (no había médicos, no la dejaron pasar, estaba cerrado…). Antes solo podía registrar
-- «No atendió» a un médico, o «Saltar» en Hoy, que no pide motivo y el supervisor no ve.
-- Queda con hora, GPS, motivo y observación; el lugar se suma a la ruta del día (como una llegada) y se ve en
-- Hoy, en Actividad y en el Ruteo de la semana. Se puede deshacer dentro de los 30 minutos.

create table vis_no_visitados (
  id            uuid primary key default gen_random_uuid(),
  client_uuid   uuid unique,                    -- idempotencia (reintentos del celular)
  vendedor_id   uuid not null references vis_vendedores(id) on delete cascade,
  lugar_id      uuid not null references vis_clientes(id) on delete cascade,
  parada_id     uuid references vis_ruta_paradas(id) on delete set null,
  fecha_hora    timestamptz not null default now(),
  motivo        text not null check (motivo in ('sin_medicos', 'sin_acceso', 'cerrado', 'licencia', 'otro')),
  observaciones text,
  lat           double precision,
  lng           double precision,
  precision_m   numeric,
  created_at    timestamptz not null default now()
);
create index on vis_no_visitados (vendedor_id, fecha_hora desc);
create index on vis_no_visitados (lugar_id, fecha_hora desc);
alter table vis_no_visitados enable row level security;
grant select on vis_no_visitados to authenticated;
create policy no_visitados_select on vis_no_visitados for select to authenticated
  using (vendedor_id = (select vis_mi_id()) or ((select vis_es_supervisor()) and vis_vendedor_visible(vendedor_id)));

-- p: {client_uuid, lugar_id, motivo, observaciones?, lat?, lng?, precision_m?, fecha_hora?}
create or replace function vis_marcar_no_visitado(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  v_uuid uuid := coalesce((p ->> 'client_uuid')::uuid, gen_random_uuid());
  v_lugar vis_clientes;
  v_motivo text := btrim(coalesce(p ->> 'motivo', ''));
  v_obs text := nullif(btrim(coalesce(p ->> 'observaciones', '')), '');
  v_fecha timestamptz := coalesce((p ->> 'fecha_hora')::timestamptz, now());
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
  v_prec numeric := (p ->> 'precision_m')::numeric;
  v_n vis_no_visitados;
  v_jornada uuid;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into v_n from vis_no_visitados where client_uuid = v_uuid;
  if found then return jsonb_build_object('id', v_n.id, 'parada_id', v_n.parada_id, 'duplicada', true); end if;
  select * into v_lugar from vis_clientes where id = (p ->> 'lugar_id')::uuid and categoria = 'lugar' and activo;
  if not found or v_lugar.vendedor_id is distinct from v_yo then raise exception 'No encontramos ese lugar entre los tuyos.'; end if;
  if v_motivo not in ('sin_medicos', 'sin_acceso', 'cerrado', 'licencia', 'otro') then raise exception 'Elegí el motivo.'; end if;
  if v_motivo = 'otro' and v_obs is null then raise exception 'Escribí qué pasó.'; end if;
  if v_fecha > now() + interval '5 minutes' or v_fecha < now() - interval '2 days' then v_fecha := now(); end if;
  insert into vis_no_visitados (client_uuid, vendedor_id, lugar_id, parada_id, fecha_hora, motivo, observaciones, lat, lng, precision_m)
  values (v_uuid, v_yo, v_lugar.id, vis_parada_del_dia(v_yo, v_lugar.id, (v_fecha at time zone 'America/Asuncion')::date),
          v_fecha, v_motivo, v_obs, v_lat, v_lng, v_prec)
  returning * into v_n;
  -- Con la jornada abierta, también mueve su punto en En vivo.
  if v_lat is not null and v_lng is not null then
    select id into v_jornada from vis_jornadas where vendedor_id = v_yo and fin is null order by inicio desc limit 1;
    if v_jornada is not null then
      insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng, precision_m, origen)
      values (v_jornada, v_yo, v_fecha, v_lat, v_lng, v_prec, 'visita') on conflict (vendedor_id, fecha_hora) do nothing;
    end if;
  end if;
  return jsonb_build_object('id', v_n.id, 'parada_id', v_n.parada_id, 'duplicada', false);
end $$;
revoke execute on function vis_marcar_no_visitado(jsonb) from anon, public;
grant execute on function vis_marcar_no_visitado(jsonb) to authenticated;

-- Deshacer (se tocó sin querer o al final apareció un médico): la propia, dentro de los 30 minutos.
-- La parada queda (el lugar sigue en la ruta del día).
create or replace function vis_quitar_no_visitado(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  v_n vis_no_visitados;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into v_n from vis_no_visitados where id = p_id and vendedor_id = v_yo;
  if not found then raise exception 'No encontramos ese registro.'; end if;
  if v_n.created_at < now() - interval '30 minutes' then raise exception 'Pasaron más de 30 minutos: pedile a tu supervisor que lo quite.'; end if;
  delete from vis_no_visitados where id = v_n.id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function vis_quitar_no_visitado(uuid) from anon, public;
grant execute on function vis_quitar_no_visitado(uuid) to authenticated;

-- El ruteo de la semana suma «no_visitado»: [{hora, motivo, observaciones}] de ese día en ese lugar.
drop function vis_ruteo_semana(uuid, date);
create function vis_ruteo_semana(p_vendedor uuid, p_semana date)
returns table (dia date, orden int, parada_id uuid, lugar_id uuid, lugar text, tipo_lugar text, direccion text, notas text,
               lat double precision, lng double precision, objetivo_id uuid, medico_id uuid, medico text, especialidad text,
               visita_id uuid, fecha_hora timestamptz, resultado text, medico_visitado text, observaciones text,
               proxima_visita date, productos jsonb, llegada timestamptz, llegadas timestamptz[], no_visitado jsonb)
language sql stable security invoker set search_path = public as $$
  select pa.dia, pa.orden, pa.id, c.id, c.razon_social, c.tipo_lugar, c.direccion, c.notas, c.lat, c.lng,
         o.id, o.medico_id, m.nombre, coalesce(nullif(btrim(o.especialidad), ''), m.especialidad),
         v.id, v.fecha_hora, rs.nombre, vm.nombre, v.observaciones, v.proxima_visita, v.productos,
         ll.horas[1], ll.horas, nv.lista
  from vis_rutas r
  join vis_ruta_paradas pa on pa.ruta_id = r.id
  join vis_clientes c on c.id = pa.cliente_id
  left join vis_parada_objetivos o on o.parada_id = pa.id
  left join vis_medicos m on m.id = o.medico_id
  left join lateral (
    select array_agg(l.fecha_hora order by l.fecha_hora) as horas from vis_llegadas l
    where l.vendedor_id = r.vendedor_id and l.lugar_id = pa.cliente_id and (l.fecha_hora at time zone 'America/Asuncion')::date = pa.dia) ll on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('hora', n.fecha_hora, 'motivo', n.motivo, 'observaciones', n.observaciones) order by n.fecha_hora) as lista
    from vis_no_visitados n
    where n.vendedor_id = r.vendedor_id and n.lugar_id = pa.cliente_id and (n.fecha_hora at time zone 'America/Asuncion')::date = pa.dia) nv on true
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
