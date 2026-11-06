-- «No le interesa» y detalle del tablero (06/11, pedido de Camping 44).
-- 1) Resultado de visita «No le interesa» (con motivo en observaciones). El cliente queda en naranja
--    (estado 'no_interesado' en vis_clientes_v) para esa empresa, hasta que una visita posterior tenga otro
--    resultado o vuelva a facturar. Por empresa: a Camping 44 no le interesa ≠ a Vitalica.
-- 2) vis_tablero_detalle: al tocar «7 / 10» en el tablero, las visitas con su estado, observación, motivo y
--    visita anterior; y los clientes de la ruta o de la zona que no visitó.

insert into vis_resultados (nombre, es_venta, orden, tipo) values ('No le interesa', false, 7, 'ventas')
on conflict (nombre) do nothing;

create table vis_cliente_no_interesa (
  cliente_id  uuid not null references vis_clientes(id) on delete cascade,
  empresa_id  uuid not null references vis_empresas(id) on delete cascade,
  desde       timestamptz not null,
  motivo      text,
  vendedor_id uuid references vis_vendedores(id) on delete set null,
  visita_id   uuid references vis_visitas(id) on delete set null,
  primary key (cliente_id, empresa_id)
);
alter table vis_cliente_no_interesa enable row level security;
grant select on vis_cliente_no_interesa to authenticated;
create policy no_interesa_select on vis_cliente_no_interesa for select to authenticated
  using (empresa_id = (select vis_mi_empresa())); -- quién ve al cliente lo decide vis_clientes al cruzar

-- La última visita de la empresa manda: «No le interesa» marca, cualquier otro resultado posterior desmarca.
create or replace function vis_no_interesa_por_visita() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_no int;
begin
  if new.resultado_id is null or new.vendedor_id is null then return new; end if;
  select empresa_id into v_emp from vis_vendedores where id = new.vendedor_id;
  select id into v_no from vis_resultados where nombre = 'No le interesa';
  if v_emp is null then return new; end if;
  if new.resultado_id = v_no then
    insert into vis_cliente_no_interesa (cliente_id, empresa_id, desde, motivo, vendedor_id, visita_id)
    values (new.cliente_id, v_emp, new.fecha_hora, nullif(btrim(new.observaciones), ''), new.vendedor_id, new.id)
    on conflict (cliente_id, empresa_id) do update
      set desde = excluded.desde, motivo = excluded.motivo, vendedor_id = excluded.vendedor_id, visita_id = excluded.visita_id
      where vis_cliente_no_interesa.desde <= excluded.desde;
  else
    delete from vis_cliente_no_interesa
    where cliente_id = new.cliente_id and empresa_id = v_emp and (desde < new.fecha_hora or visita_id = new.id);
  end if;
  return new;
end $$;
create trigger vis_visitas_no_interesa after insert or update of resultado_id on vis_visitas
  for each row execute function vis_no_interesa_por_visita();

-- Estado del cliente: 'no_interesado' primero (si no volvió a facturar después).
create or replace view vis_clientes_v with (security_invoker = true) as
select c.id, c.odoo_partner_id, c.razon_social, c.ruc, c.telefono, c.telefono_norm, c.direccion, c.ciudad, c.departamento, c.zona_id, c.vendedor_id, c.lat_odoo, c.lng_odoo, c.lat, c.lng, c.ubicacion, c.origen_ubicacion, c.ubicacion_precision_m, c.ubicacion_actualizada_por, c.ubicacion_actualizada_el, c.odoo_alta_fecha, c.ultima_factura_fecha, c.facturas_6m, c.ventas_6m_gs, c.creado_por, c.notas, c.es_ejemplo, c.activo, c.created_at, c.updated_at,
  case
    when exists (select 1 from vis_cliente_no_interesa n
                 where n.cliente_id = c.id and n.empresa_id = vis_mi_empresa()
                   and (c.ultima_factura_fecha is null or c.ultima_factura_fecha < (n.desde at time zone 'America/Asuncion')::date)) then 'no_interesado'
    when c.odoo_partner_id is null then 'potencial'
    when c.ultima_factura_fecha >= (vis_hoy() - interval '6 months') then 'activo'
    when c.ultima_factura_fecha is null
         and c.odoo_alta_fecha >= (vis_hoy() - interval '6 months') then 'potencial'
    else 'inactivo'
  end as estado,
  (select max(v.fecha_hora) from vis_visitas v where v.cliente_id = c.id) as ultima_visita,
  c.cliente_padre_id, c.empresa_id, c.categoria, c.tipo_lugar
from vis_clientes c
where c.activo;

-- Detalle del tablero para un vendedor y un período (un día o la semana).
-- tipo: 'visita' (lo que hizo), 'ruta' (planificado y no visitado), 'zona' (de su cartera en las zonas de sus
-- rutas del período, sin visita en el período). Respeta el RLS de quien consulta.
create or replace function vis_tablero_detalle(p_vendedor uuid, p_desde date, p_hasta date)
returns table (tipo text, dia date, fecha_hora timestamptz, cliente_id uuid, razon_social text, ciudad text, estado text,
               resultado text, observaciones text, motivo_no_interesa text, en_ruta boolean, ultima_anterior timestamptz, zona text)
language sql stable security invoker set search_path = public as $$
  with rango as (
    select (p_desde::timestamp at time zone 'America/Asuncion') as ini, ((p_hasta + 1)::timestamp at time zone 'America/Asuncion') as fin
  ), visitas as (
    select v.* from vis_visitas v, rango
    where v.vendedor_id = p_vendedor and v.origen = 'app' and v.fecha_hora >= rango.ini and v.fecha_hora < rango.fin
  ), paradas as (
    select pa.id, pa.dia, pa.cliente_id, r.zona_id from vis_ruta_paradas pa join vis_rutas r on r.id = pa.ruta_id
    where r.vendedor_id = p_vendedor and r.estado in ('publicada', 'cerrada') and pa.dia between p_desde and p_hasta
  )
  select 'visita', (v.fecha_hora at time zone 'America/Asuncion')::date, v.fecha_hora, c.id, c.razon_social, c.ciudad, c.estado,
         rs.nombre, v.observaciones, n.motivo, v.ruta_parada_id is not null,
         (select max(a.fecha_hora) from vis_visitas a where a.cliente_id = v.cliente_id and a.fecha_hora < v.fecha_hora), z.nombre
  from visitas v
  join vis_clientes_v c on c.id = v.cliente_id
  left join vis_resultados rs on rs.id = v.resultado_id
  left join vis_cliente_no_interesa n on n.cliente_id = c.id and n.empresa_id = vis_mi_empresa()
  left join vis_zonas z on z.id = v.zona_id
  union all
  select 'ruta', pa.dia, null, c.id, c.razon_social, c.ciudad, c.estado, null, null, null, true, c.ultima_visita, z.nombre
  from paradas pa
  join vis_clientes_v c on c.id = pa.cliente_id
  left join vis_zonas z on z.id = pa.zona_id
  where not exists (select 1 from visitas v where v.ruta_parada_id = pa.id
                    or (v.cliente_id = pa.cliente_id and (v.fecha_hora at time zone 'America/Asuncion')::date = pa.dia))
  union all
  select 'zona', null, null, c.id, c.razon_social, c.ciudad, c.estado, null, null, null, false, c.ultima_visita, z.nombre
  from vis_clientes_v c
  join vis_zonas z on z.id = c.zona_id
  where c.vendedor_id = p_vendedor
    and c.zona_id in (select zona_id from paradas where zona_id is not null)
    and not exists (select 1 from visitas v where v.cliente_id = c.id)
    and not exists (select 1 from paradas pa where pa.cliente_id = c.id)
  order by 1, 3, 2, 5
$$;
revoke execute on function vis_tablero_detalle(uuid, date, date) from anon, public;
grant execute on function vis_tablero_detalle(uuid, date, date) to authenticated;
