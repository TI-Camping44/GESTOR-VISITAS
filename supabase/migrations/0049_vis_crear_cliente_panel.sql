-- Alta de clientes desde el panel (26/11, pedido de Facundo: «que Sergio pueda editar, borrar y hacer todo ahí»).
-- Un supervisor o admin carga un cliente que no está en Odoo (sucursal, prospecto) con su vendedor. Queda de su empresa
-- (`empresa_id` = la del que lo carga: la otra empresa no lo ve), sin ubicación (se toma en la primera visita) o con
-- coordenadas si las pega. Editar y borrar (`activo = false`, papelera) van por el update de siempre (RLS clientes_update).

create or replace function vis_crear_cliente(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_yo uuid := vis_mi_id();
  v_vend uuid := nullif(p ->> 'vendedor_id', '')::uuid;
  v_nombre text := nullif(btrim(p ->> 'razon_social'), '');
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
  v_id uuid;
begin
  if not vis_es_supervisor() then raise exception 'Solo un supervisor o un admin carga clientes desde el panel.'; end if;
  if v_nombre is null then raise exception 'Falta el nombre del cliente.'; end if;
  if v_vend is not null and not vis_vendedor_visible(v_vend) then raise exception 'Ese vendedor no es de tu gente.'; end if;
  if exists (select 1 from vis_clientes where activo and empresa_id is not distinct from vis_mi_empresa() and lower(razon_social) = lower(v_nombre)) then
    raise exception 'Ya hay un cliente con ese nombre.';
  end if;
  insert into vis_clientes (razon_social, ruc, telefono, direccion, ciudad, notas, vendedor_id, empresa_id, categoria, creado_por)
  values (v_nombre, nullif(btrim(p ->> 'ruc'), ''), nullif(btrim(p ->> 'telefono'), ''), nullif(btrim(p ->> 'direccion'), ''),
          nullif(btrim(p ->> 'ciudad'), ''), nullif(btrim(p ->> 'notas'), ''), v_vend, vis_mi_empresa(), 'cliente', v_yo)
  returning id into v_id;
  if v_lat is not null and v_lng is not null then
    perform vis_actualizar_ubicacion(v_id, v_lat, v_lng, null, 'manual', 'Cargado desde el panel');
  end if;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function vis_crear_cliente(jsonb) from anon, public;
grant execute on function vis_crear_cliente(jsonb) to authenticated;
