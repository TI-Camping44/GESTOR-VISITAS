-- Médicos duplicados (23/11, pedido de Facundo). Había 9 médicos cargados dos o más veces:
--   - doble toque o señal mala al guardar en la app (mismo nombre, segundos de diferencia);
--   - la carga del ruteo comparaba el nombre exacto y un espacio doble o «Dr,» creaba otro;
--   - se volvía a cargar uno que ya existía porque no aparecía al buscarlo.
-- Acá: una clave de nombre (sin títulos, tildes, signos ni espacios de más) igual a `claveNombre` de lib/medicos.ts,
-- la carga del ruteo que compara con esa clave (y los lugares sin tildes ni espacios de más), la función para unir
-- dos médicos (el panel: Médicos → «Unir con…») y la unión de los 9 grupos idénticos que había.

create or replace function vis_clave_texto(p text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(lower(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function vis_clave_nombre(p text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(lower(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
    '\m(dr|dra|lic|doctor|doctora|licenciada|licenciado)\M\.?', ' ', 'g'), '[^a-z ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- Une `p_sale` en `p_queda`: visitas, planes (sin repetir en la misma parada), lugares con horario y datos que
-- faltaban pasan al que queda; el otro queda inactivo (en la papelera) con una nota. Interna: sin chequeo de permisos.
create or replace function vis_unir_medicos_interno(p_queda uuid, p_sale uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  q vis_medicos;
  s vis_medicos;
begin
  select * into q from vis_medicos where id = p_queda;
  select * into s from vis_medicos where id = p_sale;
  if q.id is null or s.id is null or q.id = s.id then raise exception 'Elegí dos médicos distintos.'; end if;
  if q.empresa_id is distinct from s.empresa_id then raise exception 'Los dos médicos tienen que ser de la misma empresa.'; end if;

  update vis_visitas set medico_id = q.id where medico_id = s.id;
  delete from vis_parada_objetivos o where o.medico_id = s.id
    and exists (select 1 from vis_parada_objetivos x where x.parada_id = o.parada_id and x.medico_id = q.id);
  update vis_parada_objetivos set medico_id = q.id where medico_id = s.id;
  update vis_medico_lugares ml set horario = sl.horario from vis_medico_lugares sl
  where ml.medico_id = q.id and sl.medico_id = s.id and sl.lugar_id = ml.lugar_id and ml.horario is null and sl.horario is not null;
  insert into vis_medico_lugares (medico_id, lugar_id, horario)
  select q.id, sl.lugar_id, sl.horario from vis_medico_lugares sl where sl.medico_id = s.id
  on conflict do nothing;
  delete from vis_medico_lugares where medico_id = s.id;

  update vis_medicos set especialidad = coalesce(especialidad, s.especialidad), telefono = coalesce(telefono, s.telefono),
    email = coalesce(email, s.email), notas = concat_ws(E'\n', nullif(notas, ''), nullif(s.notas, ''))
  where id = q.id;
  update vis_medicos set activo = false,
    notas = concat_ws(E'\n', nullif(notas, ''), 'Unido con «' || q.nombre || '» el ' || to_char(vis_hoy(), 'DD/MM/YYYY') || ': sus visitas, planes y lugares pasaron a ese médico.')
  where id = s.id;
end $$;
revoke execute on function vis_unir_medicos_interno(uuid, uuid) from anon, authenticated, public;

-- Desde el panel: un supervisor o admin une dos médicos de su empresa.
create or replace function vis_unir_medicos(p_queda uuid, p_sale uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vis_es_supervisor() then raise exception 'Solo un supervisor o un admin une médicos.'; end if;
  if (select count(*) from vis_medicos where id in (p_queda, p_sale) and empresa_id = vis_mi_empresa()) <> 2 then
    raise exception 'No encontramos esos dos médicos en tu empresa.';
  end if;
  perform vis_unir_medicos_interno(p_queda, p_sale);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function vis_unir_medicos(uuid, uuid) from anon, public;
grant execute on function vis_unir_medicos(uuid, uuid) to authenticated;

-- Carga del ruteo: médicos y lugares por la clave (antes: el nombre exacto).
do $$
declare d text;
begin
  d := pg_get_functiondef('vis_cargar_ruteo(jsonb)'::regprocedure);
  if position('lower(nombre) = lower(v_medico_n)' in d) = 0 or position('lower(c.razon_social) = lower(v_nombre)' in d) = 0 then
    raise exception 'vis_cargar_ruteo cambió: revisar 0041.';
  end if;
  d := replace(d, 'lower(nombre) = lower(v_medico_n)', 'vis_clave_nombre(nombre) = vis_clave_nombre(v_medico_n)');
  d := replace(d, 'lower(c.razon_social) = lower(v_nombre)', 'vis_clave_texto(c.razon_social) = vis_clave_texto(v_nombre)');
  execute d;
end $$;

-- Los grupos idénticos que había: queda el que tiene más visitas y planes (si empatan, el más viejo).
do $$
declare g record; r record; v_queda uuid;
begin
  for g in
    select empresa_id, vis_clave_nombre(nombre) clave from vis_medicos where activo and vis_clave_nombre(nombre) <> ''
    group by 1, 2 having count(*) > 1
  loop
    v_queda := null;
    for r in
      select m.id from vis_medicos m
      where m.activo and m.empresa_id is not distinct from g.empresa_id and vis_clave_nombre(m.nombre) = g.clave
      order by (select count(*) from vis_visitas v where v.medico_id = m.id) + (select count(*) from vis_parada_objetivos o where o.medico_id = m.id) desc,
               m.created_at
    loop
      if v_queda is null then v_queda := r.id; else perform vis_unir_medicos_interno(v_queda, r.id); end if;
    end loop;
  end loop;
end $$;
