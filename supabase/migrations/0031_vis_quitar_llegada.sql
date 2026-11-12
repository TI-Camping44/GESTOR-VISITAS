-- «Me equivoqué, quitar» (12/11): la visitadora deshace una llegada marcada por error (Noelia marcó La Costa
-- Artigas sin querer). Solo la propia, dentro de los 30 minutos y si todavía no registró visitas ahí ese día.
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
  if exists (select 1 from vis_visitas v where v.vendedor_id = v_yo and v.cliente_id = v_ll.lugar_id
             and (v.fecha_hora at time zone 'America/Asuncion')::date = v_dia) then
    raise exception 'Ya registraste visitas en este lugar hoy: no se puede quitar la llegada.';
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
