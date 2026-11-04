-- Cargar lugares desde el panel (03/11, Sergio): los hospitales y consultorios de la ruta de la visitadora
-- se cargan antes de que ella pase (pegando una lista), sin ubicación: la toma ella en la primera visita.
-- p: {visitadora_id, ciudad?, lugares: [{nombre, tipo_lugar?, direccion?}]}  → {cargados, ya_estaban}
create or replace function vis_cargar_lugares(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := vis_mi_id();
  v_vis vis_vendedores;
  v_l jsonb;
  v_nombre text;
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
    if exists (select 1 from vis_clientes c where c.categoria = 'lugar' and c.vendedor_id = v_vis.id and lower(c.razon_social) = lower(v_nombre)) then
      v_estaban := v_estaban + 1;
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
