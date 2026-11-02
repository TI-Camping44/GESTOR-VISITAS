-- Sucursales (Vitalica, 30/10): los clientes de Vitalica compran por sucursal (contactos hijos de la empresa
-- en Odoo). Cada sucursal es un cliente más, colgado de su empresa (cliente_padre_id), para visitarla,
-- ubicarla y ponerla en la ruta por separado. Las sucursales son solo de la empresa que las trabaja
-- (empresa_id): Camping 44 no las ve. Los clientes con empresa_id null siguen compartidos.
alter table vis_clientes
  add column cliente_padre_id uuid references vis_clientes(id) on delete set null,
  add column empresa_id uuid references vis_empresas(id) on delete cascade;
create index on vis_clientes (cliente_padre_id) where cliente_padre_id is not null;
create index on vis_clientes (empresa_id) where empresa_id is not null;

alter policy clientes_select on vis_clientes
  using (((select vis_es_supervisor()) or vis_puede_ver_cliente(id))
         and (empresa_id is null or empresa_id = (select vis_mi_empresa())));
alter policy clientes_update on vis_clientes
  using ((select vis_es_supervisor()) and (vendedor_id is null or vis_vendedor_visible(vendedor_id))
         and (empresa_id is null or empresa_id = (select vis_mi_empresa())))
  with check ((select vis_es_supervisor()) and (vendedor_id is null or vis_vendedor_visible(vendedor_id))
         and (empresa_id is null or empresa_id = (select vis_mi_empresa())));

-- Duplicados al dar de alta: tampoco muestra sucursales de otra empresa.
create or replace function vis_buscar_duplicados(
  p_razon_social text, p_telefono text, p_ruc text, p_lat double precision, p_lng double precision
) returns table (id uuid, razon_social text, telefono text, ruc text, ciudad text, motivo text, distancia_m numeric)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  cfg vis_config;
  v_tel text := vis_normalizar_telefono(p_telefono);
  v_ruc text := nullif(regexp_replace(coalesce(p_ruc, ''), '[^0-9A-Za-z-]', '', 'g'), '');
  v_nombre text := vis_nombre_cmp(p_razon_social);
  v_punto geography := case when p_lat is not null and p_lng is not null
                         then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;
begin
  if vis_mi_id() is null then raise exception 'No tenés acceso a la app.'; end if;
  select * into cfg from vis_config;

  return query
  with candidatos as (
    select c.id, c.razon_social, c.telefono, c.ruc, c.ciudad,
      case
        when v_ruc is not null and regexp_replace(coalesce(c.ruc, ''), '[^0-9A-Za-z-]', '', 'g') = v_ruc then 'Mismo RUC'
        when v_tel is not null and c.telefono_norm = v_tel then 'Mismo teléfono'
        else 'Cerca y con nombre parecido'
      end as motivo,
      case when v_punto is not null and c.ubicacion is not null
        then round(st_distance(c.ubicacion, v_punto)::numeric) end as distancia_m
    from vis_clientes c
    where c.activo and (c.empresa_id is null or c.empresa_id = vis_mi_empresa()) and (
      (v_ruc is not null and regexp_replace(coalesce(c.ruc, ''), '[^0-9A-Za-z-]', '', 'g') = v_ruc)
      or (v_tel is not null and c.telefono_norm = v_tel)
      or (v_punto is not null and c.ubicacion is not null
          and st_dwithin(c.ubicacion, v_punto, cfg.duplicado_radio_m)
          and similarity(vis_nombre_cmp(c.razon_social), v_nombre) >= cfg.duplicado_similitud)
    )
  )
  select * from candidatos order by distancia_m nulls last limit 5;
end $$;
