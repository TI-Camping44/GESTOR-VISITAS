-- Quitar un lugar cargado de más o mal (04/11, Facundo): la visitadora (o su supervisor) lo saca de la lista.
-- No se borra: queda inactivo con sus visitas en el historial. Sale de las rutas de hoy en adelante
-- (las paradas que ya tienen una visita quedan) y de los lugares de sus médicos.
create or replace function vis_quitar_lugar(p_lugar uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  v_l vis_clientes;
  v_paradas int;
begin
  if v_yo is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into v_l from vis_clientes where id = p_lugar and categoria = 'lugar' and activo;
  if not found or v_l.empresa_id is distinct from vis_mi_empresa()
     or not (v_l.vendedor_id = v_yo or (vis_es_supervisor() and vis_vendedor_visible(v_l.vendedor_id))) then
    raise exception 'No encontramos ese lugar entre los tuyos.';
  end if;
  update vis_clientes set activo = false, updated_at = now() where id = p_lugar;
  delete from vis_ruta_paradas p
  where p.cliente_id = p_lugar and p.dia >= vis_hoy()
    and not exists (select 1 from vis_visitas v where v.ruta_parada_id = p.id);
  get diagnostics v_paradas = row_count;
  return jsonb_build_object('ok', true, 'paradas_quitadas', v_paradas);
end $$;
revoke execute on function vis_quitar_lugar(uuid) from anon, public;
grant execute on function vis_quitar_lugar(uuid) to authenticated;

-- Los médicos ya no muestran los lugares quitados.
create or replace view vis_medicos_v with (security_invoker = true) as
select m.*,
  (select max(v.fecha_hora) from vis_visitas v where v.medico_id = m.id) as ultima_visita,
  coalesce((select jsonb_agg(jsonb_build_object('lugar_id', l.lugar_id, 'nombre', c.razon_social, 'horario', l.horario) order by c.razon_social)
            from vis_medico_lugares l join vis_clientes c on c.id = l.lugar_id where l.medico_id = m.id and c.activo), '[]') as lugares
from vis_medicos m
where m.activo;

-- Cargar lugares desde el panel: si el lugar estaba quitado, vuelve (en vez de contarlo como «ya estaba»).
create or replace function vis_cargar_lugares(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  v_vis vis_vendedores;
  v_l jsonb;
  v_nombre text;
  v_existe vis_clientes;
  v_cargados int := 0;
  v_estaban int := 0;
begin
  if v_yo is null or not vis_es_supervisor() then raise exception 'Solo un supervisor o un admin carga lugares.'; end if;
  select * into v_vis from vis_vendedores where id = (p ->> 'visitadora_id')::uuid and activo;
  if not found or v_vis.tipo <> 'medica' or not vis_vendedor_visible(v_vis.id) then
    raise exception 'Elegí una visitadora médica de tu empresa.';
  end if;
  for v_l in select * from jsonb_array_elements(coalesce(p -> 'lugares', '[]'::jsonb)) loop
    v_nombre := btrim(coalesce(v_l ->> 'nombre', ''));
    continue when v_nombre = '';
    select * into v_existe from vis_clientes c
    where c.categoria = 'lugar' and c.vendedor_id = v_vis.id and lower(c.razon_social) = lower(v_nombre)
    order by c.activo desc limit 1;
    if found then
      if v_existe.activo then
        v_estaban := v_estaban + 1;
      else
        update vis_clientes set activo = true, updated_at = now() where id = v_existe.id;
        v_cargados := v_cargados + 1;
      end if;
      continue;
    end if;
    insert into vis_clientes (razon_social, categoria, tipo_lugar, direccion, ciudad, empresa_id, vendedor_id, creado_por)
    values (v_nombre, 'lugar', nullif(btrim(v_l ->> 'tipo_lugar'), ''), nullif(btrim(v_l ->> 'direccion'), ''),
            nullif(btrim(p ->> 'ciudad'), ''), v_vis.empresa_id, v_vis.id, v_yo);
    v_cargados := v_cargados + 1;
  end loop;
  return jsonb_build_object('cargados', v_cargados, 'ya_estaban', v_estaban);
end $$;
revoke execute on function vis_cargar_lugares(jsonb) from anon, public;
grant execute on function vis_cargar_lugares(jsonb) to authenticated;
