-- Visita médica de Vitalica: Resultado → Detalle → Observaciones (24/11, pizarrón de Sergio).
--   Visita efectiva    → Promoción (y la tabla de productos y muestras).
--   Visita no efectiva → Está de vacaciones / Está en un congreso / Está de reposo / Cambió su horario /
--                        Canceló porque no tiene pacientes / Reprogramó su agenda / Ya no atiende acá.
-- El detalle ahora puede depender del resultado (`padre_id`; nulo = sirve para cualquier resultado, como la venta).
-- «Ya no atiende acá» como detalle sigue sacando al médico de ese lugar.

alter table vis_resultados add column if not exists padre_id int references vis_resultados(id) on delete set null;

create or replace view vis_resultados_v with (security_invoker = true) as
  select r.id, r.nombre, r.tipo, r.clase, r.es_venta, r.orden, r.activo, r.empresa_id,
    exists (select 1 from vis_resultados_ocultos o where o.resultado_id = r.id and o.empresa_id = vis_mi_empresa()) as oculto,
    r.padre_id
  from vis_resultados r;

-- «Ya no atiende acá», como resultado (compartido) o como detalle (de cualquier empresa).
create or replace function vis_medico_ya_no_atiende() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.medico_id is not null and (
       new.resultado_id = (select id from vis_resultados where nombre = 'Ya no atiende acá' and empresa_id is null)
       or new.detalle_id in (select id from vis_resultados where clase = 'detalle' and lower(nombre) = lower('Ya no atiende acá'))) then
    delete from vis_medico_lugares where medico_id = new.medico_id and lugar_id = new.cliente_id;
  end if;
  return new;
end $$;
drop trigger if exists vis_visitas_ya_no_atiende on vis_visitas;
create trigger vis_visitas_ya_no_atiende after insert or update of resultado_id, detalle_id on vis_visitas
  for each row execute function vis_medico_ya_no_atiende();

-- Ruteo de la semana: el resultado con su detalle («Visita no efectiva: Está en un congreso»).
do $$
declare d text;
begin
  d := pg_get_functiondef('vis_ruteo_semana(uuid,date)'::regprocedure);
  if position('v.id, v.fecha_hora, rs.nombre, vm.nombre' in d) = 0 or position('left join vis_resultados rs on rs.id = v.resultado_id' in d) = 0 then
    raise exception 'vis_ruteo_semana cambió: revisar 0045.';
  end if;
  d := replace(d, 'v.id, v.fecha_hora, rs.nombre, vm.nombre', 'v.id, v.fecha_hora, coalesce(rs.nombre || '': '' || rd.nombre, rs.nombre), vm.nombre');
  d := replace(d, 'left join vis_resultados rs on rs.id = v.resultado_id', 'left join vis_resultados rs on rs.id = v.resultado_id' || E'\n  left join vis_resultados rd on rd.id = v.detalle_id');
  execute d;
end $$;

-- Vitalica: la lista del pizarrón; los resultados médicos compartidos quedan ocultos para Vitalica (las visitas
-- que ya los tienen no cambian; se pueden volver a mostrar desde el panel).
do $$
declare v_vit uuid; v_ef int; v_no int;
begin
  select id into v_vit from vis_empresas where nombre ilike 'vitalica%' limit 1;
  if v_vit is null then return; end if;

  insert into vis_resultados (nombre, tipo, clase, es_venta, orden, empresa_id)
  select x.n, 'medica', 'resultado', false, x.o, v_vit from (values ('Visita efectiva', 1), ('Visita no efectiva', 2)) x(n, o)
  where not exists (select 1 from vis_resultados r where r.empresa_id = v_vit and r.tipo = 'medica' and r.clase = 'resultado' and lower(r.nombre) = lower(x.n));
  select id into v_ef from vis_resultados where empresa_id = v_vit and tipo = 'medica' and clase = 'resultado' and nombre = 'Visita efectiva';
  select id into v_no from vis_resultados where empresa_id = v_vit and tipo = 'medica' and clase = 'resultado' and nombre = 'Visita no efectiva';

  insert into vis_resultados (nombre, tipo, clase, es_venta, orden, empresa_id, padre_id)
  select x.n, 'medica', 'detalle', false, x.o, v_vit, x.padre
  from (values ('Promoción', 1, v_ef), ('Está de vacaciones', 1, v_no), ('Está en un congreso', 2, v_no), ('Está de reposo', 3, v_no),
               ('Cambió su horario', 4, v_no), ('Canceló porque no tiene pacientes', 5, v_no), ('Reprogramó su agenda', 6, v_no),
               ('Ya no atiende acá', 7, v_no)) x(n, o, padre)
  where not exists (select 1 from vis_resultados r where r.empresa_id = v_vit and r.tipo = 'medica' and r.clase = 'detalle' and lower(r.nombre) = lower(x.n));

  insert into vis_resultados_ocultos (empresa_id, resultado_id)
  select v_vit, r.id from vis_resultados r where r.empresa_id is null and r.tipo = 'medica' and r.clase = 'resultado'
  on conflict do nothing;
end $$;
