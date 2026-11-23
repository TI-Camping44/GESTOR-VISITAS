-- Resultado → Detalle → Observación (23/11, pedido de Sergio para la venta mayorista de Vitalica: «con este ajuste el
-- vendedor puede autogestionar su rutina»). La visita de venta tiene dos desplegables: Resultado (Rutina, Nuevo
-- prospecto, No le interesa, No califica, Seguimiento) y Detalle (Volver a contactar, Tiene stock, Propuesta
-- enviada, Hizo pedido, Reposición de stock, Promociones), más las observaciones libres. Las dos listas las edita el
-- admin de la empresa en Resultados de visita. Una empresa también puede ocultar para ella los compartidos.
-- Camping 44 y la visita médica no cambian: sin detalles cargados, el segundo desplegable no aparece.

alter table vis_resultados add column if not exists clase text not null default 'resultado' check (clase in ('resultado', 'detalle'));
alter table vis_visitas add column if not exists detalle_id int references vis_resultados(id);

-- El nombre ya no es único en toda la tabla: «Hizo pedido» puede ser un resultado compartido y un detalle de Vitalica.
alter table vis_resultados drop constraint if exists vis_resultados_nombre_key;
create unique index if not exists vis_resultados_nombre_unico
  on vis_resultados (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo, clase, lower(nombre));

-- Compartidos que una empresa no usa (no salen en su lista; las visitas que ya los tienen no cambian).
create table if not exists vis_resultados_ocultos (
  empresa_id   uuid not null references vis_empresas(id),
  resultado_id int  not null references vis_resultados(id) on delete cascade,
  primary key (empresa_id, resultado_id)
);
alter table vis_resultados_ocultos enable row level security;
grant select, insert, delete on vis_resultados_ocultos to authenticated;
create policy resultados_ocultos_select on vis_resultados_ocultos for select to authenticated
  using (empresa_id = (select vis_mi_empresa()));
create policy resultados_ocultos_write on vis_resultados_ocultos for all to authenticated
  using ((select vis_es_admin()) and empresa_id = (select vis_mi_empresa()))
  with check ((select vis_es_admin()) and empresa_id = (select vis_mi_empresa()));

-- La lista como la ve cada uno: con «oculto» para su empresa.
create or replace view vis_resultados_v with (security_invoker = true) as
  select r.id, r.nombre, r.tipo, r.clase, r.es_venta, r.orden, r.activo, r.empresa_id,
    exists (select 1 from vis_resultados_ocultos o where o.resultado_id = r.id and o.empresa_id = vis_mi_empresa()) as oculto
  from vis_resultados r;
grant select on vis_resultados_v to authenticated;

-- Los resultados que la base busca por nombre son los compartidos (una empresa podría tener uno con el mismo nombre).
do $$
declare f text; d text; pat text;
begin
  foreach f in array array['vis_crear_prospecto(jsonb)', 'vis_no_interesa_por_visita()', 'vis_medico_ya_no_atiende()'] loop
    d := pg_get_functiondef(f::regprocedure);
    foreach pat in array array['Cliente nuevo', 'No le interesa', 'Ya no atiende acá'] loop
      d := replace(d, format('from vis_resultados where nombre = %L', pat), format('from vis_resultados where nombre = %L and empresa_id is null', pat));
    end loop;
    execute d;
  end loop;
end $$;

-- La visita guarda el detalle (de la lista de detalles); un detalle que «cuenta como venta» marca el pedido.
do $$
declare d text;
begin
  d := pg_get_functiondef('vis_registrar_visita(jsonb)'::regprocedure);
  if position('v_res vis_resultados;' in d) = 0 or position('medico_id, productos)' in d) = 0 or position('v_medico, v_productos)' in d) = 0
     or position('resultado_id = coalesce(v_res.id, resultado_id),' in d) = 0 then
    raise exception 'vis_registrar_visita cambió: revisar 0044.';
  end if;
  d := replace(d, 'v_res vis_resultados;', 'v_res vis_resultados;' || E'\n  v_det vis_resultados;');
  d := replace(d, 'select * into v_res from vis_resultados where id = (p ->> ''resultado_id'')::int;',
    'select * into v_res from vis_resultados where id = (p ->> ''resultado_id'')::int;' || E'\n  '
    || 'select * into v_det from vis_resultados where id = (p ->> ''detalle_id'')::int and clase = ''detalle'';');
  d := replace(d, 'or coalesce(v_res.es_venta, false)', 'or coalesce(v_res.es_venta, false) or coalesce(v_det.es_venta, false)');
  d := replace(d, 'resultado_id = coalesce(v_res.id, resultado_id),', 'resultado_id = coalesce(v_res.id, resultado_id),' || E'\n      detalle_id = coalesce(v_det.id, detalle_id),');
  d := replace(d, 'medico_id, productos)', 'medico_id, productos, detalle_id)');
  d := replace(d, 'v_medico, v_productos)', 'v_medico, v_productos, v_det.id)');
  execute d;
end $$;

-- Vitalica (pizarrón de Sergio): la lista de resultados de la venta es la suya, con «No le interesa» compartido;
-- los demás compartidos de venta quedan ocultos para Vitalica (se pueden volver a mostrar desde el panel).
do $$
declare v_vit uuid;
begin
  select id into v_vit from vis_empresas where nombre ilike 'vitalica%' limit 1;
  if v_vit is null then return; end if;

  update vis_resultados set clase = 'detalle', orden = 1 where empresa_id = v_vit and tipo = 'ventas' and lower(nombre) = 'volver a contactar';
  update vis_resultados r set orden = x.o from (values ('rutina%', 1), ('nuevo prospecto', 2), ('no califica', 8), ('seguimiento', 9)) x(n, o)
    where r.empresa_id = v_vit and r.tipo = 'ventas' and r.clase = 'resultado' and lower(r.nombre) like x.n;

  insert into vis_resultados (nombre, tipo, clase, es_venta, orden, empresa_id)
  select x.n, 'ventas', 'detalle', x.venta, x.o, v_vit
  from (values ('Volver a contactar', false, 1), ('Tiene stock', false, 2), ('Propuesta enviada', false, 3), ('No califica', false, 4),
               ('Hizo pedido', true, 5), ('Sugerencia / Reposición de stock', false, 6), ('Promociones', false, 7)) x(n, venta, o)
  where not exists (select 1 from vis_resultados r where r.empresa_id = v_vit and r.tipo = 'ventas' and r.clase = 'detalle' and lower(r.nombre) = lower(x.n));

  insert into vis_resultados_ocultos (empresa_id, resultado_id)
  select v_vit, r.id from vis_resultados r
  where r.empresa_id is null and r.tipo = 'ventas' and r.clase = 'resultado' and r.nombre not in ('No le interesa', 'Cliente nuevo')
  on conflict do nothing;
end $$;
