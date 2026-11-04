-- Ver la app como un vendedor o la visitadora (04/11, Facundo): un supervisor o admin abre la app de alguien
-- de su gente en solo lectura. Y nadie se puede cambiar su propio rol (Facundo se puso «visitadora» sin querer).

-- ── No cambiarse el propio rol ─────────────────────────────────────
create or replace function vis_no_cambiar_mi_rol() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.id = vis_mi_id() and (new.rol is distinct from old.rol or new.tipo is distinct from old.tipo or (old.activo and not new.activo)) then
    raise exception 'No podés cambiar tu propio rol ni quitarte el acceso: pedíselo a otro admin.';
  end if;
  return new;
end $$;
create trigger vis_vendedores_mi_rol before update on vis_vendedores
  for each row execute function vis_no_cambiar_mi_rol();

-- ── A quién puedo mirar ────────────────────────────────────────────
-- Vendedores y visitadoras activos: el admin de las dos empresas ve los de ambas; el resto, los de su gente.
create or replace function vis_para_ver_como()
returns table (id uuid, nombre text, tipo text, empresa_id uuid, empresa text, equipo text)
language sql stable security definer set search_path = public as $$
  select v.id, v.nombre, v.tipo, v.empresa_id, e.nombre, q.nombre
  from vis_vendedores v
  join vis_empresas e on e.id = v.empresa_id
  left join vis_equipos q on q.id = v.equipo_id
  where v.activo and v.rol = 'vendedor' and v.id <> vis_mi_id() and vis_es_supervisor()
    and (vis_soy_admin_multi() or vis_vendedor_visible(v.id))
  order by e.nombre, v.tipo, v.nombre
$$;
revoke execute on function vis_para_ver_como() from anon, public;
grant execute on function vis_para_ver_como() to authenticated;

-- ── Mis visitas de otro (para la vista como) ───────────────────────
drop function vis_mis_visitas(date, date);
create function vis_mis_visitas(p_desde date, p_hasta date, p_vendedor uuid default null)
returns table (
  id uuid, fecha_hora timestamptz, cliente_id uuid, razon_social text, ciudad text, telefono text, telefono_norm text,
  resultado text, es_venta boolean, hizo_pedido boolean, hizo_cobranza boolean, monto_cobrado_gs numeric,
  observaciones text, proxima_visita date, en_ruta boolean, distancia_cliente_m numeric
)
language sql stable security definer set search_path = public as $$
  select v.id, v.fecha_hora, v.cliente_id, coalesce(m.nombre || ' · ', '') || c.razon_social, c.ciudad, c.telefono, c.telefono_norm,
         r.nombre, coalesce(r.es_venta, false), v.hizo_pedido, v.hizo_cobranza, v.monto_cobrado_gs,
         v.observaciones, v.proxima_visita, v.ruta_parada_id is not null, v.distancia_cliente_m
  from vis_visitas v
  join vis_clientes c on c.id = v.cliente_id
  left join vis_resultados r on r.id = v.resultado_id
  left join vis_medicos m on m.id = v.medico_id
  where v.vendedor_id = case
          when p_vendedor is null or p_vendedor = vis_mi_id() then vis_mi_id()
          when vis_es_supervisor() and vis_vendedor_visible(p_vendedor) then p_vendedor
        end
    and v.fecha_hora >= (greatest(p_desde, p_hasta - 92)::timestamp at time zone 'America/Asuncion')
    and v.fecha_hora <  ((p_hasta + 1)::timestamp at time zone 'America/Asuncion')
  order by v.fecha_hora desc
$$;
revoke execute on function vis_mis_visitas(date, date, uuid) from anon, public;
grant execute on function vis_mis_visitas(date, date, uuid) to authenticated;
