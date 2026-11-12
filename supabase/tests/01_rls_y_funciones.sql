-- Pruebas de RLS y funciones contra un Postgres local con 00_stub_supabase.sql + migraciones.
--   npm run db:test
-- Cada bloque falla con un mensaje claro si una regla no se cumple.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ── Datos base (como postgres, salta RLS) ──────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@camping44.com.py'),
  ('00000000-0000-0000-0000-00000000000b', 'super@camping44.com.py'),
  ('00000000-0000-0000-0000-00000000000c', 'antonio@camping44.com.py'),
  ('00000000-0000-0000-0000-00000000000d', 'beto@camping44.com.py'),
  ('00000000-0000-0000-0000-00000000000e', 'intruso@gmail.com');
insert into vis_vendedores (nombre, email, rol) values
  ('Admin TI', 'admin@camping44.com.py', 'admin'),
  ('Supervisora', 'super@camping44.com.py', 'supervisor'),
  ('Antonio', 'antonio@camping44.com.py', 'vendedor'),
  ('Beto', 'beto@camping44.com.py', 'vendedor');
insert into vis_zonas (nombre) values ('Zona Prueba A'), ('Zona Prueba B');
insert into vis_clientes (odoo_partner_id, razon_social, telefono, ciudad, lat, lng, origen_ubicacion, zona_id, vendedor_id, ultima_factura_fecha, odoo_alta_fecha) values
  (1, 'Ferretería López S.A.', '0981 111-222', 'Concepción', -23.4064, -57.4344, 'odoo',
     (select id from vis_zonas where nombre='Zona Prueba A'), (select id from vis_vendedores where nombre='Antonio'), vis_hoy() - 30, '2020-01-01'),
  (2, 'Agro Beto SRL', '0972 333 444', 'San Pedro', -24.0912, -57.0800, 'odoo',
     (select id from vis_zonas where nombre='Zona Prueba A'), (select id from vis_vendedores where nombre='Beto'), vis_hoy() - 400, '2019-01-01'),
  (3, 'Nuevo Odoo', null, 'Asunción', null, null, null, null, null, null, vis_hoy() - 20);

create or replace function pg_temp.como(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then '' else
      json_build_object('sub', (select id from auth.users where email = p_email), 'email', p_email, 'role', 'authenticated')::text end, false);
end $$;

-- ── Acceso ──────────────────────────────────────────────────────────
select pg_temp.como('intruso@gmail.com') \gset
set role authenticated;
do $$ begin
  assert vis_vincular_usuario() is null, 'un email sin alta no debe vincularse';
  assert (select count(*) from vis_clientes) = 0, 'sin alta no se ve ningún cliente';
  assert (select count(*) from vis_vendedores) = 0, 'sin alta no se ve la lista de vendedores';
end $$;
reset role;

do $$ declare n int; begin
  perform pg_temp.como(e) from unnest(array['admin@camping44.com.py']) e;
end $$;
-- Vincular a todos
select pg_temp.como('admin@camping44.com.py');  set role authenticated; select vis_vincular_usuario() is not null as admin_ok; reset role;
select pg_temp.como('super@camping44.com.py');  set role authenticated; select vis_vincular_usuario() is not null as super_ok; reset role;
select pg_temp.como('antonio@camping44.com.py'); set role authenticated; select (vis_vincular_usuario() ->> 'rol') = 'vendedor' as antonio_ok; reset role;
select pg_temp.como('beto@camping44.com.py');    set role authenticated; select vis_vincular_usuario() is not null as beto_ok; reset role;

-- anon no ve nada
set role anon;
do $$ begin
  begin perform 1 from vis_clientes; assert false, 'anon no debería poder leer vis_clientes';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ── Colores de estado ──────────────────────────────────────────────
do $$ begin
  assert (select estado from vis_clientes_v where odoo_partner_id = 1) = 'activo', 'factura hace 30 días → activo';
  assert (select estado from vis_clientes_v where odoo_partner_id = 2) = 'inactivo', 'factura hace 400 días → inactivo';
  assert (select estado from vis_clientes_v where odoo_partner_id = 3) = 'potencial', 'nunca facturó, alta hace 20 días → potencial';
end $$;

-- ── Jornada y tracking ─────────────────────────────────────────────
select pg_temp.como('antonio@camping44.com.py') \gset
set role authenticated;
do $$ begin
  -- sin jornada no se guarda nada
  assert vis_subir_posiciones(jsonb_build_array(jsonb_build_object('fecha_hora', now(), 'lat', -23.4, 'lng', -57.4, 'precision_m', 10))) = 0,
    'sin jornada iniciada no se guarda ninguna posición';
  begin perform vis_iniciar_jornada(-23.4, -57.43, 12, 80); assert false, 'sin aceptar el aviso no debe iniciar';
  exception when raise_exception then null; end;
  perform vis_aceptar_tracking();
  perform vis_iniciar_jornada(-23.40, -57.43, 12, 80);
  assert (select count(*) from vis_jornadas where fin is null) = 1, 'jornada abierta';
  -- segunda llamada devuelve la misma
  perform vis_iniciar_jornada(-23.40, -57.43, 12, 80);
  assert (select count(*) from vis_jornadas) = 1, 'no se duplica la jornada';
end $$;

do $$ declare lote jsonb; n1 int; n2 int; begin
  lote := jsonb_build_array(
    jsonb_build_object('fecha_hora', now() + interval '1 second', 'lat', -23.401, 'lng', -57.431, 'precision_m', 15),
    jsonb_build_object('fecha_hora', now() + interval '2 seconds', 'lat', -23.402, 'lng', -57.432, 'precision_m', 15),
    jsonb_build_object('fecha_hora', now() + interval '3 seconds', 'lat', -23.403, 'lng', -57.433, 'precision_m', 500)); -- descartada por precisión
  n1 := vis_subir_posiciones(lote);
  n2 := vis_subir_posiciones(lote);
  assert n1 = 2, format('esperaba 2 posiciones insertadas, fueron %s', n1);
  assert n2 = 0, 'reenviar el mismo lote no duplica';
  assert (select lat from vis_posicion_actual) = -23.402, 'la posición actual es la más reciente';
  assert (select en_jornada from vis_posicion_actual), 'en_jornada = true';
end $$;
reset role;

select pg_temp.como('beto@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert (select count(*) from vis_posiciones) = 0, 'Beto no ve posiciones de Antonio';
  assert (select count(*) from vis_posicion_actual) = 0, 'Beto no ve la posición actual de Antonio';
  assert (select count(*) from vis_jornadas) = 0, 'Beto no ve jornadas de Antonio';
  begin insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng) select id, vendedor_id, now(), 0, 0 from vis_jornadas limit 1;
    assert false, 'nadie inserta posiciones directo';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select pg_temp.como('super@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert (select count(*) from vis_posicion_actual) = 1, 'la supervisora ve la posición de Antonio';
end $$;
reset role;

-- ── Prospectos ──────────────────────────────────────────────────────
select pg_temp.como('antonio@camping44.com.py') \gset
set role authenticated;
do $$ declare r jsonb; begin
  begin
    perform vis_crear_prospecto('{"razon_social":"Despensa Mari","telefono":"0985 555 666","lat":-23.41,"lng":-57.44,"precision_m":150}');
    assert false, 'precisión 150 m debe bloquear';
  exception when raise_exception then
    assert sqlerrm like 'Precisión actual: 150 m%', 'mensaje claro de precisión: ' || sqlerrm;
  end;
  begin
    perform vis_crear_prospecto('{"razon_social":" ","telefono":"0985 555 666","lat":-23.41,"lng":-57.44,"precision_m":10}');
    assert false, 'sin razón social debe bloquear';
  exception when raise_exception then null; end;

  r := vis_crear_prospecto('{"razon_social":"Despensa Mari","telefono":"0985 555 666","lat":-23.41,"lng":-57.44,"precision_m":10}');
  assert (r ->> 'ok')::boolean, 'alta válida';
  -- 0011: el alta cuenta como visita, y el formulario la completa sin duplicarla.
  assert (select r2.nombre from vis_visitas v join vis_resultados r2 on r2.id = v.resultado_id
          where v.id = (r ->> 'visita_id')::uuid and v.cliente_id = (r ->> 'id')::uuid) = 'Cliente nuevo', 'el alta deja una visita';
  perform vis_registrar_visita(jsonb_build_object('client_uuid', gen_random_uuid(), 'cliente_id', r ->> 'id',
    'visita_id', r ->> 'visita_id', 'resultado_id', (select id from vis_resultados where nombre = 'Tiene stock'),
    'observaciones', 'Vuelvo en noviembre'));
  assert (select count(*) from vis_visitas where cliente_id = (r ->> 'id')::uuid) = 1, 'completar el formulario no duplica la visita';
  assert (select observaciones from vis_visitas where id = (r ->> 'visita_id')::uuid) = 'Vuelvo en noviembre', 'el formulario completa la visita del alta';

  -- mismo teléfono que un cliente de otro vendedor → muestra el posible duplicado
  r := vis_crear_prospecto('{"razon_social":"Otro nombre","telefono":"+595 972 333444","lat":-25.3,"lng":-57.6,"precision_m":10}');
  assert not (r ->> 'ok')::boolean, 'teléfono repetido debe devolver duplicados';
  assert r -> 'duplicados' -> 0 ->> 'razon_social' = 'Agro Beto SRL', 'muestra cuál es el duplicado';
  assert r -> 'duplicados' -> 0 ->> 'motivo' = 'Mismo teléfono', 'motivo del duplicado';

  -- a menos de 30 m con nombre parecido
  r := vis_crear_prospecto('{"razon_social":"Ferreteria Lopez","telefono":"0991 000 111","lat":-23.40645,"lng":-57.43445,"precision_m":10}');
  assert not (r ->> 'ok')::boolean and r -> 'duplicados' -> 0 ->> 'motivo' = 'Cerca y con nombre parecido', 'duplicado por cercanía + nombre';

  -- "es otro": forzar
  r := vis_crear_prospecto('{"razon_social":"Ferreteria Lopez Sucursal","telefono":"0991 000 111","lat":-23.40645,"lng":-57.43445,"precision_m":10,"forzar":true}');
  assert (r ->> 'ok')::boolean, 'forzar crea igual';

  assert (select count(*) from vis_clientes) = 3, format('Antonio ve sus 3 clientes, ve %s', (select count(*) from vis_clientes));
  assert not exists (select 1 from vis_clientes where razon_social = 'Agro Beto SRL'), 'Antonio no ve clientes de Beto';
  update vis_clientes set notas = 'x';
  assert not exists (select 1 from vis_clientes where notas = 'x'), 'el vendedor no puede editar clientes directo';
end $$;
reset role;

-- ── Visitas ─────────────────────────────────────────────────────────
select pg_temp.como('antonio@camping44.com.py') \gset
set role authenticated;
do $$ declare r jsonb; r2 jsonb; v_cli uuid; v_beto uuid; begin
  select id into v_cli from vis_clientes where odoo_partner_id = 1;
  r := vis_registrar_visita(jsonb_build_object('client_uuid', '11111111-1111-1111-1111-111111111111', 'cliente_id', v_cli,
         'lat', -23.4140, 'lng', -57.4344, 'precision_m', 8, 'resultado_id', 1, 'observaciones', 'Pidió 10 carpas', 'capturada_offline', true));
  r2 := vis_registrar_visita(jsonb_build_object('client_uuid', '11111111-1111-1111-1111-111111111111', 'cliente_id', v_cli));
  assert r ->> 'id' = r2 ->> 'id' and (r2 ->> 'duplicada')::boolean, 'reenviar la visita offline no la duplica';
  assert (r ->> 'distancia_cliente_m')::numeric between 800 and 900, 'distancia ≈ 850 m: ' || (r ->> 'distancia_cliente_m');
  assert (r ->> 'alerta_distancia')::boolean, 'más de 300 m dispara la alerta';
  assert (select hizo_pedido from vis_visitas where id = (r ->> 'id')::uuid), 'resultado "Hizo pedido" marca hizo_pedido';
  assert (select zona_id is not null from vis_visitas where id = (r ->> 'id')::uuid), 'la visita guarda la zona del cliente';
  assert exists (select 1 from vis_posiciones where origen = 'visita'), 'la visita deja un punto en el recorrido';

  -- corrección de ubicación
  begin perform vis_actualizar_ubicacion(v_cli, -23.414, -57.4344, 8, 'manual', 'mal'); assert false, 'vendedor no mueve pin manual';
  exception when raise_exception then null; end;
  perform vis_actualizar_ubicacion(v_cli, -23.414, -57.4344, 8, 'gps_visita', 'Confirmado en visita');
  assert (select origen_ubicacion from vis_clientes where id = v_cli) = 'gps_visita', 'origen gps_visita';
  assert (select count(*) from vis_cliente_ubicaciones_hist where cliente_id = v_cli) = 1, 'queda en el historial';

  -- cliente ajeno
  begin
    perform vis_registrar_visita(jsonb_build_object('client_uuid', gen_random_uuid(), 'cliente_id',
      (select id from vis_clientes_v where false union all select '00000000-0000-0000-0000-000000000000'::uuid limit 1)));
    assert false, 'cliente inexistente';
  exception when raise_exception then null; end;
end $$;
reset role;

do $$ declare v_beto uuid; begin
  select id into v_beto from vis_clientes where odoo_partner_id = 2;
  perform pg_temp.como('antonio@camping44.com.py');
  set local role authenticated;
  begin perform vis_registrar_visita(jsonb_build_object('client_uuid', gen_random_uuid(), 'cliente_id', v_beto));
    assert false, 'Antonio no puede registrar visitas a clientes de Beto';
  exception when raise_exception then null; end;
end $$;
reset role;

-- ── Rutas: borrador invisible, publicada visible ───────────────────
select pg_temp.como('super@camping44.com.py') \gset
set role authenticated;
insert into vis_rutas (nombre, vendedor_id, zona_id, semana_inicio, estado)
select 'Ruta Norte – Sem test – Antonio', v.id, z.id, date_trunc('week', vis_hoy())::date, 'borrador'
from vis_vendedores v, vis_zonas z where v.nombre = 'Antonio' and z.nombre = 'Zona Prueba A';
insert into vis_ruta_paradas (ruta_id, cliente_id, dia, orden)
select r.id, c.id, vis_hoy(), row_number() over (order by c.razon_social)
from vis_rutas r, vis_clientes c where c.odoo_partner_id in (1, 2);
do $$ begin
  begin
    insert into vis_ruta_paradas (ruta_id, cliente_id, dia) select id, (select id from vis_clientes where odoo_partner_id=3), semana_inicio + 9 from vis_rutas;
    assert false, 'parada fuera de la semana debe fallar';
  exception when raise_exception then null; end;
end $$;
reset role;

select pg_temp.como('antonio@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert (select count(*) from vis_rutas) = 0, 'ruta en borrador no la ve el vendedor';
  assert not exists (select 1 from vis_clientes where odoo_partner_id = 2), 'sin ruta publicada no ve a Agro Beto';
end $$;
reset role;

select pg_temp.como('super@camping44.com.py') \gset
set role authenticated;
update vis_rutas set estado = 'publicada';
reset role;

select pg_temp.como('antonio@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert (select count(*) from vis_rutas) = 1, 'ruta publicada visible';
  assert (select count(*) from vis_paradas_dia()) = 2, format('2 paradas hoy, hay %s', (select count(*) from vis_paradas_dia()));
  assert (select count(*) from vis_paradas_dia() where visitada) = 1, 'Ferretería López figura visitada hoy';
  assert exists (select 1 from vis_clientes where odoo_partner_id = 2), 'con la parada publicada ve a Agro Beto';
  assert (select realizadas from vis_tablero(date_trunc('week', vis_hoy())::date) where dia = vis_hoy()) = 3, 'tablero: 3 visitas hoy (Ferretería López + las 2 altas, que cuentan como visita)';
  assert (select count(distinct vendedor_id) from vis_tablero(date_trunc('week', vis_hoy())::date)) = 1, 'el vendedor solo se ve a sí mismo en el tablero';
  assert (select count(*) from vis_zona_historial((select id from vis_zonas where nombre = 'Zona Prueba A'))) = 1, 'historial de zona';
  assert (select count(*) from vis_clientes_cercanos(-23.4064, -57.4344, 2000)) >= 1, 'cerca mío';
end $$;
reset role;

select pg_temp.como('super@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert (select count(distinct vendedor_id) from vis_tablero(date_trunc('week', vis_hoy())::date)) = 2, 'la supervisora ve a los 2 vendedores';
  assert (select planificadas from vis_tablero(date_trunc('week', vis_hoy())::date) where vendedor = 'Antonio' and dia = vis_hoy()) = 2, 'planificadas = 2';
end $$;
reset role;

-- ── Terminar jornada y cierre automático ───────────────────────────
select pg_temp.como('antonio@camping44.com.py') \gset
set role authenticated;
do $$ declare j vis_jornadas; begin
  j := vis_terminar_jornada(-23.404, -57.434, 10, 70);
  assert j.fin is not null and j.km_recorridos > 0, 'jornada cerrada con km';
  assert not (select en_jornada from vis_posicion_actual), 'deja de figurar en jornada';
  assert vis_subir_posiciones(jsonb_build_array(jsonb_build_object('fecha_hora', now() + interval '1 hour', 'lat', -23.4, 'lng', -57.4))) = 0,
    'después de terminar no entra tracking nuevo';
end $$;
reset role;

-- Jornada olvidada de ayer (Beto) → se cierra sola
update vis_vendedores set tracking_aceptado_el = now() where nombre = 'Beto';
insert into vis_jornadas (vendedor_id, inicio) select id, now() - interval '1 day 2 hours' from vis_vendedores where nombre = 'Beto';
do $$ begin
  assert vis_cerrar_jornadas_olvidadas() = 1, 'cierra la jornada de ayer';
  assert (select cierre_auto from vis_jornadas j join vis_vendedores v on v.id = j.vendedor_id where v.nombre = 'Beto'), 'cierre_auto = true';
end $$;

-- ── Reportes (0008) ────────────────────────────────────────────────
select pg_temp.como('super@camping44.com.py') \gset
set role authenticated;
do $$ declare r record; begin
  select * into r from vis_reporte_vendedores(vis_hoy() - 7, vis_hoy()) where vendedor = 'Antonio';
  assert r.visitas = 3 and r.con_pedido = 1, format('reporte: 3 visitas (2 son altas), 1 con pedido, vino %s/%s', r.visitas, r.con_pedido);
  assert r.km > 0, 'reporte: km de la jornada';
  assert r.dias_con_jornada = 1 and r.horas_jornada >= 0, 'reporte: días y horas de jornada';
  assert r.prospectos_nuevos = 2, format('reporte: 2 prospectos nuevos, vino %s', r.prospectos_nuevos);
  assert (select visitas from vis_reporte_resultados(vis_hoy() - 7, vis_hoy()) where resultado = 'Hizo pedido') = 1, 'reporte de resultados';
  assert (select visitados from vis_reporte_zonas(vis_hoy() - 7, vis_hoy()) where zona = 'Zona Prueba A') = 1, 'cobertura por zona';
  assert exists (select 1 from vis_clientes_sin_visita(60) where razon_social = 'Agro Beto SRL'), 'Agro Beto figura sin visita';
end $$;
reset role;
select pg_temp.como('beto@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert (select count(*) from vis_reporte_vendedores(vis_hoy() - 7, vis_hoy())) = 1, 'un vendedor solo se ve a sí mismo en el reporte';
  assert (select vendedor from vis_reporte_vendedores(vis_hoy() - 7, vis_hoy())) = 'Beto', 'y es él';
end $$;
reset role;

-- ── Próximas visitas y ruta sugerida (0009) ────────────────────────
do $$ declare v_cli uuid; v_ruta uuid; begin
  select id into v_cli from vis_clientes where odoo_partner_id = 1;
  update vis_visitas set proxima_visita = vis_hoy() - 2 where cliente_id = v_cli;
  select id into v_ruta from vis_rutas limit 1;
  -- Agro Beto (rojo, sin visitar) para la sugerencia: se saca de la ruta
  delete from vis_ruta_paradas where cliente_id = (select id from vis_clientes where odoo_partner_id = 2);
end $$;
select pg_temp.como('antonio@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert (select dias_vencida from vis_proximas_visitas() where razon_social = 'Ferretería López S.A.') = 2, 'próxima visita vencida hace 2 días';
end $$;
reset role;
select pg_temp.como('beto@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert not exists (select 1 from vis_proximas_visitas() where razon_social = 'Ferretería López S.A.'), 'Beto no ve pendientes de clientes de Antonio';
end $$;
reset role;
select pg_temp.como('super@camping44.com.py') \gset
set role authenticated;
do $$ declare s record; begin
  select * into s from vis_sugerir_paradas((select id from vis_rutas limit 1)) where razon_social = 'Agro Beto SRL';
  assert s.cliente_id is not null, 'Agro Beto aparece sugerido';
  assert 'Sin movimiento: recuperar' = any(s.motivos) and 'Nunca visitado' = any(s.motivos), format('motivos: %s', s.motivos);
  assert s.puntaje >= 105, format('puntaje %s', s.puntaje);
  assert not exists (select 1 from vis_sugerir_paradas((select id from vis_rutas limit 1)) where razon_social = 'Ferretería López S.A.'), 'no sugiere lo que ya está en la ruta';
end $$;
reset role;

-- ── Zonas por ciudad (0007) ────────────────────────────────────────
do $$ declare v uuid; begin
  assert (select nombre from vis_zonas where id = vis_zona_por_ciudad('concepcion')) = 'Zona Norte 1', 'Concepción → Zona Norte 1';
  assert (select nombre from vis_zonas where id = vis_zona_por_ciudad('CDE')) = 'Zona Este 2', 'CDE → Zona Este 2';
  assert (select nombre from vis_zonas where id = vis_zona_por_ciudad('San Pedro del Paraná')) = 'Zona Sur Oeste', 'San Pedro del Paraná no se confunde con San Pedro';
  assert vis_zona_por_ciudad('Asunción') is null, 'Asunción está en dos zonas: la asigna el supervisor';
  -- 0010: las abreviaturas reconocen la zona pero no salen en la lista de ciudades.
  assert (select 'CDE' = any(ciudades_alias) and not 'CDE' = any(ciudades) and 'Ciudad del Este' = any(ciudades) from vis_zonas where nombre = 'Zona Este 2'), 'CDE pasa a variantes';
  assert (select nombre from vis_zonas where id = vis_zona_por_ciudad('Fdo de la Mora')) is null, 'Fdo de la Mora sigue siendo de las dos zonas de Asunción';
  assert (select nombre from vis_zonas where id = vis_zona_por_ciudad('Mcal Estigarribia')) = 'Zona Chaco', 'variante → Zona Chaco';
  insert into vis_clientes (razon_social, ciudad) values ('Cliente Encarnación', 'Encarnacion') returning id into v;
  assert (select z.nombre from vis_clientes c join vis_zonas z on z.id = c.zona_id where c.id = v) = 'Zona Sur', 'el cliente nuevo toma la zona por la ciudad';
  update vis_clientes set zona_id = null where id = v;
  assert (select zona_id from vis_clientes where id = v) is null, 'quitar la zona a mano se respeta';
end $$;

-- ── Multi empresa (0012) ───────────────────────────────────────────
-- Vitalica: su admin y su vendedor. Los clientes se comparten; la gente y su trabajo, no.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'sergio@camping44.com.py'),
  ('00000000-0000-0000-0000-0000000000f2', 'hugo@vitalica.com.py');
insert into vis_vendedores (nombre, email, rol, empresa_id, tracking_aceptado_el) values
  ('Sergio', 'sergio@camping44.com.py', 'admin', (select id from vis_empresas where nombre = 'Vitalica'), null),
  ('Hugo', 'hugo@vitalica.com.py', 'vendedor', (select id from vis_empresas where nombre = 'Vitalica'), now());
insert into vis_clientes (razon_social, ciudad, vendedor_id) values
  ('Cliente de Hugo', 'Asunción', (select id from vis_vendedores where nombre = 'Hugo')),
  ('Cliente libre', 'Asunción', null);
insert into vis_jornadas (vendedor_id, inicio) values ((select id from vis_vendedores where nombre = 'Hugo'), now() - interval '1 hour');
insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng)
  select id, vendedor_id, now() - interval '10 minutes', -25.3, -57.6 from vis_jornadas where vendedor_id = (select id from vis_vendedores where nombre = 'Hugo');
insert into vis_rutas (nombre, vendedor_id, semana_inicio, estado)
  values ('Ruta Hugo', (select id from vis_vendedores where nombre = 'Hugo'), date_trunc('week', vis_hoy())::date, 'publicada');

select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ declare r jsonb; begin
  r := vis_vincular_usuario();
  assert r ->> 'empresa' = 'Vitalica' and not (r ->> 'multi_empresa')::boolean, format('perfil de Hugo: %s', r);
  r := vis_registrar_visita(jsonb_build_object('client_uuid', gen_random_uuid(), 'cliente_id',
    (select id from vis_clientes where razon_social = 'Cliente de Hugo'), 'resultado_id', (select id from vis_resultados where activo order by orden limit 1)));
  assert r ->> 'id' is not null, 'Hugo registra su visita';
  assert (select array_agg(nombre order by nombre) from vis_vendedores) = array['Hugo', 'Sergio'], 'un vendedor de Vitalica ve solo a la gente de Vitalica';
end $$;
reset role;

select id as antonio_id from vis_vendedores where email = 'antonio@camping44.com.py' \gset
select set_config('test.antonio', :'antonio_id', false) \gset
select pg_temp.como('sergio@camping44.com.py') \gset
set role authenticated;
do $$ declare n int; begin
  assert vis_vincular_usuario() ->> 'empresa' = 'Vitalica', 'Sergio es de Vitalica';
  assert (select array_agg(nombre order by nombre) from vis_vendedores) = array['Hugo', 'Sergio'], 'Sergio ve solo a la gente de Vitalica';
  assert (select count(*) from vis_zonas) = 0, 'las zonas de Camping 44 no se ven en Vitalica';
  assert (select count(*) from vis_clientes where razon_social = 'Ferretería López S.A.') = 1, 'los clientes se comparten';
  assert (select array_agg(nombre) from vis_rutas) = array['Ruta Hugo'], 'solo las rutas de Vitalica';
  assert not exists (select 1 from vis_visitas v join vis_vendedores x on x.id = v.vendedor_id where x.nombre <> 'Hugo')
     and exists (select 1 from vis_visitas), 'solo las visitas de Vitalica';
  assert (select count(*) from vis_jornadas) = 1 and (select count(*) from vis_posiciones) = 1
     and (select count(*) from vis_posicion_actual) = 1, 'en vivo y recorridos: solo Hugo';
  assert (select array_agg(nombre) from vis_empresas) = array['Vitalica'], 've solo su empresa';
  -- Clientes compartidos: asigna los libres a su gente, no toca los de Camping 44.
  update vis_clientes set vendedor_id = (select id from vis_vendedores where nombre = 'Hugo') where razon_social = 'Cliente libre';
  get diagnostics n = row_count; assert n = 1, 'asigna un cliente libre a Hugo';
  update vis_clientes set notas = 'x' where razon_social = 'Ferretería López S.A.';
  get diagnostics n = row_count; assert n = 0, 'no edita un cliente de un vendedor de Camping 44';
  begin
    update vis_clientes set vendedor_id = current_setting('test.antonio')::uuid where razon_social = 'Cliente libre';
    assert false, 'no puede asignar a un vendedor de otra empresa';
  exception when insufficient_privilege then null; end;
  -- El alta de gente queda en su empresa y no puede darse acceso a otras.
  insert into vis_vendedores (nombre, email, rol) values ('Nuevo Vitalica', 'nuevo@vitalica.com.py', 'vendedor');
  assert (select e.nombre from vis_vendedores v join vis_empresas e on e.id = v.empresa_id where v.email = 'nuevo@vitalica.com.py') = 'Vitalica', 'el alta queda en Vitalica';
  begin update vis_vendedores set multi_empresa = true where nombre = 'Sergio'; assert false, 'un admin no se da multi empresa';
  exception when insufficient_privilege then null; end;
  begin update vis_vendedores set empresa_id = (select id from vis_empresas limit 1) where nombre = 'Hugo'; assert false, 'un admin no mueve gente de empresa';
  exception when insufficient_privilege then null; end;
  begin perform vis_cambiar_empresa((select id from vis_empresas limit 1)); assert false, 'sin multi empresa no cambia de empresa';
  exception when raise_exception then null; end;
end $$;
reset role;

select pg_temp.como('super@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert not exists (select 1 from vis_vendedores where nombre in ('Hugo', 'Sergio', 'Nuevo Vitalica')), 'Camping 44 no ve la gente de Vitalica';
  assert not exists (select 1 from vis_rutas where nombre = 'Ruta Hugo'), 'ni sus rutas';
  assert not exists (select 1 from vis_visitas v join vis_clientes c on c.id = v.cliente_id where c.razon_social = 'Cliente de Hugo'), 'ni sus visitas';
  assert not exists (select 1 from vis_jornadas j where j.vendedor_id not in (select id from vis_vendedores)), 'ni sus jornadas';
  assert not exists (select 1 from vis_posicion_actual p where p.vendedor_id not in (select id from vis_vendedores)), 'ni su posición en vivo';
  assert (select count(*) from vis_zonas) > 0, 'sus zonas siguen ahí';
end $$;
reset role;

-- TI con multi empresa: elige con cuál trabaja.
update vis_vendedores set multi_empresa = true where email = 'admin@camping44.com.py';
select pg_temp.como('admin@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert vis_vincular_usuario() ->> 'empresa' = 'Camping 44', 'arranca en su empresa';
  assert (select count(*) from vis_empresas) = 2, 've las dos empresas';
  perform vis_cambiar_empresa((select id from vis_empresas where nombre = 'Vitalica'));
  assert vis_vincular_usuario() ->> 'empresa' = 'Vitalica', 'pasó a Vitalica';
  assert exists (select 1 from vis_vendedores where nombre = 'Hugo') and not exists (select 1 from vis_vendedores where nombre = 'Antonio'), 've la gente de Vitalica';
  perform vis_cambiar_empresa((select id from vis_empresas where nombre = 'Camping 44'));
  assert exists (select 1 from vis_vendedores where nombre = 'Antonio'), 'vuelve a Camping 44';
end $$;
reset role;

-- ── Usuarios y empresas (0014) ─────────────────────────────────────
-- (El admin de prueba ya es multi empresa.) Diego: gerente, supervisor de las dos.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f3', 'diego@camping44.com.py');
insert into vis_vendedores (nombre, email, rol, multi_empresa) values ('Diego', 'diego@camping44.com.py', 'supervisor', true);

select pg_temp.como('sergio@camping44.com.py') \gset
set role authenticated;
do $$ declare n int; begin
  assert exists (select 1 from vis_vendedores where nombre = 'Diego'), 'quien tiene ambas aparece también en Vitalica';
  assert not exists (select 1 from vis_vendedores where nombre = 'Antonio'), 'pero no la gente solo de Camping 44';
  update vis_vendedores set meta_diaria = 99 where nombre = 'Diego';
  get diagnostics n = row_count; assert n = 0, 'el admin de Vitalica no edita a quien es de Camping 44';
  begin perform vis_asignar_empresa((select id from vis_vendedores where nombre = 'Hugo'), (select id from vis_empresas where nombre = 'Camping 44'), false);
    assert false, 'el admin de una empresa no cambia empresas';
  exception when raise_exception then null; end;
end $$;
reset role;

select pg_temp.como('diego@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert vis_vincular_usuario() ->> 'multi_empresa' = 'true', 'Diego entra con las dos empresas';
  begin perform vis_asignar_empresa((select id from vis_vendedores where nombre = 'Hugo'), (select id from vis_empresas where nombre = 'Camping 44'), false);
    assert false, 'un supervisor con ambas no cambia empresas';
  exception when raise_exception then null; end;
end $$;
reset role;

select pg_temp.como('admin@camping44.com.py') \gset
set role authenticated;
do $$ declare n int; begin
  perform vis_cambiar_empresa((select id from vis_empresas where nombre = 'Vitalica'));
  perform vis_asignar_empresa((select id from vis_vendedores where nombre = 'Hugo'), (select id from vis_empresas where nombre = 'Camping 44'), true);
  assert (select multi_empresa from vis_vendedores where nombre = 'Hugo'), 'TI le da ambas a Hugo';
  perform vis_asignar_empresa((select id from vis_vendedores where nombre = 'Hugo'), (select id from vis_empresas where nombre = 'Vitalica'), false);
  assert (select not multi_empresa and empresa_activa is null from vis_vendedores where nombre = 'Hugo'), 'y lo vuelve a dejar solo en Vitalica';
  update vis_vendedores set meta_diaria = 12 where nombre = 'Hugo';
  get diagnostics n = row_count; assert n = 1, 'TI edita gente de cualquier empresa';
  begin perform vis_asignar_empresa(vis_mi_id(), (select id from vis_empresas where nombre = 'Camping 44'), false);
    assert false, 'no se saca a sí mismo el acceso a todas';
  exception when raise_exception then null; end;
end $$;
reset role;

-- ── Mis visitas (0015) ─────────────────────────────────────────────
select pg_temp.como('antonio@camping44.com.py') \gset
set role authenticated;
do $$ declare n int; begin
  select count(*) into n from vis_mis_visitas(vis_hoy() - 30, vis_hoy());
  assert n > 0, 'Antonio ve sus visitas';
  assert n = (select count(*) from vis_visitas where vendedor_id = vis_mi_id() and fecha_hora >= (vis_hoy() - 30)::timestamp at time zone 'America/Asuncion'),
    'son exactamente las suyas del período';
  assert not exists (select 1 from vis_mis_visitas(vis_hoy() - 30, vis_hoy()) m join vis_visitas v on v.id = m.id where v.vendedor_id <> vis_mi_id()), 'ninguna de otro';
  assert (select count(*) from vis_mis_visitas(vis_hoy() - 30, vis_hoy()) where razon_social is null) = 0, 'siempre con el nombre del cliente';
end $$;
reset role;
set role anon;
do $$ begin
  begin perform vis_mis_visitas(current_date - 1, current_date); assert false, 'anon no llama a vis_mis_visitas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ── Equipos (0016): Mayorista y Venta externa en Camping 44 ──────────
-- Supervisora → Mayorista con Antonio y Beto; Ale supervisa Venta externa con Vico.
-- (Camping 44 ya no tiene Venta externa desde 0023: la prueba crea un segundo equipo para probar la separación.)
insert into vis_equipos (empresa_id, nombre) select id, 'Venta externa' from vis_empresas where nombre = 'Camping 44'
  and not exists (select 1 from vis_equipos q join vis_empresas e on e.id = q.empresa_id where e.nombre = 'Camping 44' and q.nombre = 'Venta externa');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f4', 'ale@camping44.com.py'),
  ('00000000-0000-0000-0000-0000000000f5', 'vico@camping44.com.py');
update vis_vendedores set equipo_id = (select id from vis_equipos where nombre = 'Mayorista')
  where email in ('super@camping44.com.py', 'antonio@camping44.com.py', 'beto@camping44.com.py');
update vis_vendedores set empresa_activa = null where email = 'admin@camping44.com.py';
insert into vis_vendedores (nombre, email, rol, equipo_id) values
  ('Ale', 'ale@camping44.com.py', 'supervisor', (select id from vis_equipos where nombre = 'Venta externa')),
  ('Vico', 'vico@camping44.com.py', 'vendedor', (select id from vis_equipos where nombre = 'Venta externa'));
insert into vis_zonas (nombre, equipo_id) values ('Zona Externa', (select id from vis_equipos where nombre = 'Venta externa'));
insert into vis_clientes (razon_social, ciudad, vendedor_id) values ('Cliente de Vico', 'Asunción', (select id from vis_vendedores where nombre = 'Vico'));
insert into vis_rutas (nombre, vendedor_id, semana_inicio, estado)
  values ('Ruta Vico', (select id from vis_vendedores where nombre = 'Vico'), date_trunc('week', vis_hoy())::date, 'publicada');
insert into vis_jornadas (vendedor_id, inicio) values ((select id from vis_vendedores where nombre = 'Vico'), now() - interval '1 hour');
insert into vis_posiciones (jornada_id, vendedor_id, fecha_hora, lat, lng)
  select id, vendedor_id, now() - interval '5 minutes', -25.3, -57.6 from vis_jornadas where vendedor_id = (select id from vis_vendedores where nombre = 'Vico');
insert into vis_visitas (cliente_id, vendedor_id, fecha_hora, origen)
  values ((select id from vis_clientes where razon_social = 'Cliente de Vico'), (select id from vis_vendedores where nombre = 'Vico'), now() - interval '2 hours', 'app');
select id as antonio_id from vis_vendedores where email = 'antonio@camping44.com.py' \gset
select set_config('test.antonio', :'antonio_id', false) \gset

select pg_temp.como('ale@camping44.com.py') \gset
set role authenticated;
do $$ declare n int; begin
  assert vis_vincular_usuario() ->> 'equipo' = 'Venta externa', 'Ale es de Venta externa';
  assert not exists (select 1 from vis_vendedores where nombre in ('Antonio', 'Beto', 'Supervisora')), 'Ale no ve a la gente de Mayorista';
  assert exists (select 1 from vis_vendedores where nombre = 'Vico'), 've a los suyos';
  assert (select array_agg(nombre order by nombre) from vis_zonas) = array['Zona Externa', 'Zona Prueba A', 'Zona Prueba B'], format('zonas de Ale: %s', (select array_agg(nombre order by nombre) from vis_zonas));
  assert not exists (select 1 from vis_rutas r join vis_vendedores v on v.id = r.vendedor_id where v.nombre <> 'Vico') and exists (select 1 from vis_rutas), 'solo rutas de su equipo';
  assert (select count(*) from vis_visitas) = (select count(*) from vis_visitas v where v.vendedor_id = (select id from vis_vendedores where nombre = 'Vico')) and exists (select 1 from vis_visitas), 'solo visitas de su equipo';
  assert (select count(*) from vis_jornadas) = 1 and (select count(*) from vis_posicion_actual) = 1, 'en vivo: solo su equipo';
  assert exists (select 1 from vis_clientes where razon_social = 'Ferretería López S.A.'), 'los clientes siguen compartidos';
  update vis_clientes set notas = 'x' where razon_social = 'Ferretería López S.A.';
  get diagnostics n = row_count; assert n = 0, 'no edita clientes de vendedores de Mayorista';
  begin
    update vis_clientes set vendedor_id = current_setting('test.antonio')::uuid where razon_social = 'Cliente de Vico';
    assert false, 'no asigna clientes a vendedores de otro equipo';
  exception when insufficient_privilege then null; end;
  begin perform vis_asignar_equipo((select id from vis_vendedores where nombre = 'Vico'), null); assert false, 'un supervisor no cambia equipos';
  exception when raise_exception then null; end;
  insert into vis_zonas (nombre) values ('Zona Nueva Externa');
  assert (select q.nombre from vis_zonas z join vis_equipos q on q.id = z.equipo_id where z.nombre = 'Zona Nueva Externa') = 'Venta externa', 'la zona que crea es de su equipo';
end $$;
reset role;

select pg_temp.como('super@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert not exists (select 1 from vis_vendedores where nombre in ('Ale', 'Vico')), 'Mayorista no ve a Venta externa';
  assert not exists (select 1 from vis_zonas where nombre like 'Zona%Externa'), 'ni sus zonas';
  assert not exists (select 1 from vis_rutas where nombre = 'Ruta Vico'), 'ni sus rutas';
  assert exists (select 1 from vis_vendedores where nombre = 'Antonio'), 've a los suyos';
end $$;
reset role;

select pg_temp.como('admin@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert exists (select 1 from vis_vendedores where nombre = 'Vico') and exists (select 1 from vis_vendedores where nombre = 'Antonio'), 'sin equipo ve los dos';
  perform vis_asignar_equipo((select id from vis_vendedores where nombre = 'Vico'), (select id from vis_equipos where nombre = 'Mayorista'));
  assert (select q.nombre from vis_vendedores v join vis_equipos q on q.id = v.equipo_id where v.nombre = 'Vico') = 'Mayorista', 'el admin cambia el equipo';
  begin perform vis_asignar_equipo((select id from vis_vendedores where nombre = 'Hugo'), (select id from vis_equipos where nombre = 'Mayorista'));
    assert false, 'no se asigna un equipo de otra empresa';
  exception when raise_exception then null; end;
end $$;
reset role;

-- ── Zona por equipo del vendedor (0017) ─────────────────────────────
do $$ declare v uuid; begin
  insert into vis_zonas (nombre, ciudades, equipo_id) values
    ('Mayo Luque', array['Puerto Prueba'], (select id from vis_equipos where nombre = 'Mayorista')),
    ('Externa Luque', array['Puerto Prueba'], (select id from vis_equipos where nombre = 'Venta externa'));
  update vis_vendedores set equipo_id = (select id from vis_equipos where nombre = 'Venta externa') where nombre = 'Vico';
  insert into vis_clientes (razon_social, ciudad, vendedor_id) values ('Ext de Luque', 'PUERTO PRUEBA (DISTRITO)', (select id from vis_vendedores where nombre = 'Vico')) returning id into v;
  assert (select z.nombre from vis_clientes c join vis_zonas z on z.id = c.zona_id where c.id = v) = 'Externa Luque', 'cliente de Venta externa → zona de Venta externa, aunque la ciudad venga con (DISTRITO)';
  update vis_clientes set vendedor_id = current_setting('test.antonio')::uuid where id = v;
  assert (select z.nombre from vis_clientes c join vis_zonas z on z.id = c.zona_id where c.id = v) = 'Mayo Luque', 'pasa a Mayorista: toma la zona de Mayorista';
  assert vis_ciudad_limpia('ASUNCION (DISTRITO)') = 'ASUNCION' and vis_ciudad_limpia('  ') is null, 'limpia la ciudad';
end $$;

-- ── Vecinos de otro vendedor (0018) ────────────────────────────────
select pg_temp.como('beto@camping44.com.py') \gset
set role authenticated;
do $$ declare r record; begin
  -- Ferretería López (de Antonio) está en -23.4064, -57.4344
  select * into r from vis_vecinos_de_otros(-23.4070, -57.4344, 300);
  assert r.vendedor = 'Antonio' and r.distancia_m between 50 and 80, format('vecino: %s', r);
  assert not exists (select 1 from vis_vecinos_de_otros(-24.0912, -57.0800, 300) where vendedor = 'Beto'), 'no avisa por los propios';
end $$;
reset role;
set role anon;
do $$ begin
  begin perform vis_vecinos_de_otros(-23.4, -57.4, 300); assert false, 'anon no la llama';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ── Altas a revisar (0019) ─────────────────────────────────────────
select pg_temp.como('beto@camping44.com.py') \gset
set role authenticated;
do $$ declare r jsonb; begin
  -- Beto da de alta un cliente a ~60 m de la Ferretería López (de Antonio).
  r := vis_crear_prospecto(jsonb_build_object('razon_social', 'Kiosco Vecino', 'telefono', '0981 777 888', 'ciudad', 'Concepción',
    'lat', -23.4070, 'lng', -57.4344, 'precision_m', 10, 'forzar', true));
  assert (r ->> 'ok')::boolean, format('alta: %s', r);
  assert not exists (select 1 from vis_alertas_alta), 'el vendedor no ve las alertas';
end $$;
reset role;
do $$ declare a vis_alertas_alta; begin
  select * into a from vis_alertas_alta where cliente_id = (select id from vis_clientes where razon_social = 'Kiosco Vecino');
  assert a.id is not null, 'quedó la alerta';
  assert a.vecinos -> 0 ->> 'vendedor' = 'Antonio', format('vecinos: %s', a.vecinos);
  assert (a.vecinos -> 0 ->> 'distancia_m')::numeric between 50 and 80, 'con la distancia';
end $$;
select pg_temp.como('super@camping44.com.py') \gset
set role authenticated;
do $$ declare n int; begin
  assert exists (select 1 from vis_alertas_alta a join vis_clientes c on c.id = a.cliente_id where c.razon_social = 'Kiosco Vecino'), 'la supervisora la ve';
  update vis_alertas_alta set revisada_el = now(), revisada_por = vis_mi_id(), decision = 'queda'
  where cliente_id = (select id from vis_clientes where razon_social = 'Kiosco Vecino');
  get diagnostics n = row_count; assert n = 1, 'y la resuelve';
end $$;
reset role;
select pg_temp.como('ale@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert not exists (select 1 from vis_alertas_alta), 'otro equipo no la ve';
end $$;
reset role;
do $$ begin
  insert into vis_clientes (odoo_partner_id, razon_social, lat, lng, creado_por, vendedor_id)
  values (99001, 'De Odoo', -23.4071, -57.4344, null, (select id from vis_vendedores where nombre = 'Beto'));
  assert not exists (select 1 from vis_alertas_alta a join vis_clientes c on c.id = a.cliente_id where c.razon_social = 'De Odoo'), 'lo del sync no alerta';
end $$;

-- ── Sucursales de Vitalica (0020) ──────────────────────────────────
do $$ begin
  insert into vis_clientes (odoo_partner_id, razon_social, empresa_id, cliente_padre_id, vendedor_id, telefono, lat, lng)
  values (99100, 'De Odoo · Sucursal Centro', (select id from vis_empresas where nombre = 'Vitalica'),
          (select id from vis_clientes where razon_social = 'De Odoo'), (select id from vis_vendedores where nombre = 'Hugo'),
          '0981 400 400', -23.4075, -57.4350);
end $$;
select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ begin
  assert exists (select 1 from vis_clientes_v where razon_social = 'De Odoo · Sucursal Centro'), 'Hugo ve su sucursal';
end $$;
reset role;
select pg_temp.como('sergio@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert exists (select 1 from vis_clientes where razon_social = 'De Odoo · Sucursal Centro'), 'el admin de Vitalica la ve';
  assert exists (select 1 from vis_clientes where razon_social = 'De Odoo'), 'y los clientes compartidos';
end $$;
reset role;
select pg_temp.como('super@camping44.com.py') \gset
set role authenticated;
do $$ declare n int; begin
  assert not exists (select 1 from vis_clientes where empresa_id is not null), 'Camping 44 no ve las sucursales de Vitalica';
  assert exists (select 1 from vis_clientes where razon_social = 'De Odoo'), 'pero sí la empresa (compartida)';
  update vis_clientes set notas = 'x' where razon_social = 'De Odoo · Sucursal Centro';
  get diagnostics n = row_count; assert n = 0, 'ni la puede editar';
end $$;
reset role;
select pg_temp.como('beto@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert not exists (select 1 from vis_buscar_duplicados('Sucursal Centro', '0981 400 400', null, -23.4075, -57.4350)),
    'los duplicados no muestran sucursales de otra empresa';
end $$;
reset role;

-- ── Visita médica (0021) ───────────────────────────────────────────
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000fa', 'vale@vitalica.com.py');
insert into vis_vendedores (nombre, email, rol, empresa_id, tipo, tracking_aceptado_el)
  values ('Vale', 'vale@vitalica.com.py', 'vendedor', (select id from vis_empresas where nombre = 'Vitalica'), 'medica', now());
select pg_temp.como('vale@vitalica.com.py') \gset
set role authenticated;
do $$ declare r jsonb; v_lugar uuid; v_med uuid; begin
  assert vis_vincular_usuario() ->> 'tipo' = 'medica', 'el perfil trae el tipo';
  r := vis_crear_lugar(jsonb_build_object('nombre', 'Hospital Central', 'tipo_lugar', 'Hospital', 'ciudad', 'Asunción',
    'lat', -25.2900, 'lng', -57.6200, 'precision_m', 12));
  v_lugar := (r ->> 'id')::uuid;
  assert (select categoria from vis_clientes where id = v_lugar) = 'lugar', 'el lugar se crea como lugar';
  assert (select vendedor_id from vis_clientes where id = v_lugar) = vis_mi_id(), 'y es de ella';
  insert into vis_medicos (empresa_id, nombre, especialidad, visitadora_id, creado_por)
    values (vis_mi_empresa(), 'Dra. Gómez', 'Pediatría', vis_mi_id(), vis_mi_id()) returning id into v_med;
  insert into vis_medico_lugares (medico_id, lugar_id, horario) values (v_med, v_lugar, 'Lun y Mié 8 a 12');
  insert into vis_medicos (empresa_id, nombre, especialidad, visitadora_id, creado_por)
    values (vis_mi_empresa(), 'Dr. Ruiz', 'Clínica médica', vis_mi_id(), vis_mi_id());
  insert into vis_medico_lugares (medico_id, lugar_id) values ((select id from vis_medicos where nombre = 'Dr. Ruiz'), v_lugar);
  assert (select jsonb_array_length(lugares) from vis_medicos_v where id = v_med) = 1, 'el médico con su lugar';
  r := vis_registrar_visita(jsonb_build_object('client_uuid', gen_random_uuid(), 'cliente_id', v_lugar, 'medico_id', v_med,
    'resultado_id', (select id from vis_resultados where nombre = 'Dejó muestras'),
    'productos', jsonb_build_array(jsonb_build_object('producto', 'Vitamina C', 'muestras', 3)),
    'lat', -25.2901, 'lng', -57.6201, 'precision_m', 10));
  assert (select productos -> 0 ->> 'muestras' from vis_visitas where id = (r ->> 'id')::uuid) = '3', 'la visita guarda las muestras';
  assert (select ultima_visita from vis_medicos_v where id = v_med) is not null, 'y cuenta como última visita del médico';
  assert (select razon_social from vis_mis_visitas(vis_hoy(), vis_hoy()) where id = (r ->> 'id')::uuid) = 'Dra. Gómez · Hospital Central', 'en Mis visitas: médico · lugar';
  begin
    insert into vis_productos (empresa_id, nombre) values (vis_mi_empresa(), 'Prueba');
    assert false, 'la visitadora no carga productos';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from vis_alertas_alta a join vis_clientes c on c.id = a.cliente_id where c.categoria = 'lugar'), 'un lugar no genera alta a revisar';
end $$;
select set_config('test.medico', (select id::text from vis_medicos where nombre = 'Dra. Gómez'), false) \gset
select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ begin
  assert not exists (select 1 from vis_medicos), 'otro vendedor no ve los médicos de la visitadora';
  assert not exists (select 1 from vis_clientes where categoria = 'lugar'), 'ni sus lugares';
  begin
    perform vis_registrar_visita(jsonb_build_object('client_uuid', gen_random_uuid(),
      'cliente_id', (select id from vis_clientes where razon_social = 'Cliente de Hugo'), 'medico_id', current_setting('test.medico')));
    assert false, 'no puede registrar visita a un médico ajeno';
  exception when raise_exception then
    assert sqlerrm like '%médico%', sqlerrm;
  end;
end $$;
reset role;
select pg_temp.como('sergio@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert (select count(*) from vis_medicos) = 2, 'el admin de Vitalica ve los médicos';
  insert into vis_productos (empresa_id, nombre) values (vis_mi_empresa(), 'Vitamina C');
  assert (select count(*) from vis_productos) = 1, 'y carga productos';
end $$;
reset role;
select pg_temp.como('super@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert not exists (select 1 from vis_medicos), 'Camping 44 no ve los médicos de Vitalica';
  assert not exists (select 1 from vis_productos), 'ni sus productos';
  assert not exists (select 1 from vis_clientes where categoria = 'lugar'), 'ni sus lugares';
end $$;
reset role;

-- ── Restaurar ubicaciones pisadas por el sync (0022) ────────────────
do $$ declare v uuid; begin
  insert into vis_clientes (odoo_partner_id, razon_social, lat, lng, origen_ubicacion)
  values (99200, 'Pisado por Odoo', -25.0, -57.0, 'odoo') returning id into v;
  insert into vis_cliente_ubicaciones_hist (cliente_id, lat, lng, precision_m, origen, motivo, created_at)
  values (v, -25.1, -57.1, 9, 'gps_visita', 'vieja', now() - interval '3 days'),
         (v, -25.2, -57.2, 8, 'gps_visita', 'la última', now() - interval '1 day');
end $$;
\i supabase/migrations/0022_vis_restaurar_ubicaciones.sql
do $$ declare c vis_clientes; begin
  select * into c from vis_clientes where razon_social = 'Pisado por Odoo';
  assert c.lat = -25.2 and c.lng = -57.2 and c.origen_ubicacion = 'gps_visita', format('vuelve a la última ubicación de la calle: %s %s %s', c.lat, c.lng, c.origen_ubicacion);
end $$;

-- ── Sin Venta externa (0023) ───────────────────────────────────────
\i supabase/migrations/0023_vis_sin_venta_externa.sql
do $$ begin
  assert not exists (select 1 from vis_equipos q join vis_empresas e on e.id = q.empresa_id where e.nombre = 'Camping 44' and q.nombre = 'Venta externa'), 'ya no hay Venta externa';
  assert (select q.nombre from vis_vendedores v join vis_equipos q on q.id = v.equipo_id where v.nombre = 'Ale') = 'Mayorista', 'su gente pasa a Mayorista';
  assert (select q.nombre from vis_zonas z join vis_equipos q on q.id = z.equipo_id where z.nombre = 'Zona Externa') = 'Mayorista', 'y sus zonas';
end $$;

-- ── Cargar lugares desde el panel (0024) ───────────────────────────
select pg_temp.como('sergio@camping44.com.py') \gset
set role authenticated;
do $$ declare r jsonb; begin
  r := vis_cargar_lugares(jsonb_build_object('visitadora_id', (select id from vis_vendedores where nombre = 'Vale'), 'ciudad', 'Asunción',
    'lugares', jsonb_build_array(jsonb_build_object('nombre', 'Sanatorio Italiano', 'tipo_lugar', 'Sanatorio'),
                                 jsonb_build_object('nombre', 'hospital central'), jsonb_build_object('nombre', ' '))));
  assert (r ->> 'cargados')::int = 1 and (r ->> 'ya_estaban')::int = 1, format('carga ("hospital central" ya estaba, sin importar mayúsculas; el vacío no cuenta): %s', r);
  assert (select count(*) from vis_clientes where categoria = 'lugar' and razon_social = 'Sanatorio Italiano') = 1, 'el lugar queda de la visitadora';
  begin
    perform vis_cargar_lugares(jsonb_build_object('visitadora_id', (select id from vis_vendedores where nombre = 'Hugo'), 'lugares', '[{"nombre":"X"}]'::jsonb));
    assert false, 'solo a visitadoras médicas';
  exception when raise_exception then null;
  end;
end $$;
reset role;
select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ begin
  begin
    perform vis_cargar_lugares(jsonb_build_object('visitadora_id', (select id from vis_vendedores where nombre = 'Vale'), 'lugares', '[{"nombre":"X"}]'::jsonb));
    assert false, 'un vendedor no carga lugares';
  exception when raise_exception then null;
  end;
end $$;
reset role;

-- ── Quitar un lugar (0025) ─────────────────────────────────────────
-- La visita de prueba de 0021 ya le creó la ruta de la semana (0030: una visita a un lugar fuera de ruta lo suma).
update vis_rutas set nombre = 'Ruta Vale' where vendedor_id = (select id from vis_vendedores where nombre = 'Vale') and semana_inicio = date_trunc('week', vis_hoy())::date;
insert into vis_rutas (nombre, vendedor_id, semana_inicio, estado)
select 'Ruta Vale', (select id from vis_vendedores where nombre = 'Vale'), date_trunc('week', vis_hoy())::date, 'publicada'
where not exists (select 1 from vis_rutas where nombre = 'Ruta Vale');
insert into vis_ruta_paradas (ruta_id, cliente_id, dia)
values ((select id from vis_rutas where nombre = 'Ruta Vale'), (select id from vis_clientes where razon_social = 'Hospital Central'), vis_hoy())
on conflict do nothing;
select set_config('test.sin_visita', (select count(*)::text from vis_ruta_paradas pa where pa.cliente_id = (select id from vis_clientes where razon_social = 'Hospital Central')
  and pa.dia >= vis_hoy() and not exists (select 1 from vis_visitas v where v.ruta_parada_id = pa.id)), false) \gset
select set_config('test.lugar', (select id::text from vis_clientes where razon_social = 'Hospital Central'), false) \gset
select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ begin
  begin
    perform vis_quitar_lugar(current_setting('test.lugar')::uuid);
    assert false, 'un vendedor no quita lugares de la visitadora';
  exception when raise_exception then null;
  end;
end $$;
reset role;
select pg_temp.como('vale@vitalica.com.py') \gset
set role authenticated;
do $$ declare r jsonb; begin
  r := vis_quitar_lugar(current_setting('test.lugar')::uuid);
  assert (r ->> 'paradas_quitadas')::int = current_setting('test.sin_visita')::int, format('sale de las paradas sin visita de hoy en adelante: %s', r);
  assert not exists (select 1 from vis_ruta_paradas pa where pa.cliente_id = current_setting('test.lugar')::uuid and pa.dia >= vis_hoy()
                     and not exists (select 1 from vis_visitas v where v.ruta_parada_id = pa.id)), 'no quedan paradas sin visita';
  assert not exists (select 1 from vis_clientes_v where id = current_setting('test.lugar')::uuid), 'ya no está en su lista';
  assert (select jsonb_array_length(lugares) from vis_medicos_v where nombre = 'Dra. Gómez') = 0, 'ni en los lugares del médico';
  assert exists (select 1 from vis_visitas where cliente_id = current_setting('test.lugar')::uuid), 'las visitas quedan';
end $$;
reset role;
select pg_temp.como('sergio@camping44.com.py') \gset
set role authenticated;
do $$ declare r jsonb; begin
  r := vis_cargar_lugares(jsonb_build_object('visitadora_id', (select id from vis_vendedores where nombre = 'Vale'),
    'lugares', jsonb_build_array(jsonb_build_object('nombre', 'Hospital Central'))));
  assert (r ->> 'cargados')::int = 1, format('cargarlo de nuevo lo vuelve a la lista: %s', r);
  assert (select count(*) from vis_clientes where razon_social = 'Hospital Central' and activo) = 1, 'sin duplicarlo';
end $$;
reset role;

-- ── Ver como y no cambiarse el propio rol (0026) ───────────────────
select pg_temp.como('sergio@camping44.com.py') \gset
set role authenticated;
do $$ begin
  begin
    update vis_vendedores set tipo = 'medica' where email = 'sergio@camping44.com.py';
    assert false, 'nadie se cambia su propio rol';
  exception when raise_exception then null;
  end;
  assert exists (select 1 from vis_para_ver_como() where nombre = 'Vale' and tipo = 'medica'), 'Sergio puede mirar la app de la visitadora';
  assert not exists (select 1 from vis_para_ver_como() where empresa = 'Camping 44'), 'pero no a la gente de Camping 44';
  assert (select count(*) from vis_mis_visitas(vis_hoy() - 7, vis_hoy(), (select id from vis_vendedores where nombre = 'Vale'))) >= 1, 'y ve las visitas de ella';
end $$;
reset role;
select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ begin
  assert not exists (select 1 from vis_para_ver_como()), 'un vendedor no mira a nadie';
  assert not exists (select 1 from vis_mis_visitas(vis_hoy() - 7, vis_hoy(), (select id from vis_vendedores where nombre = 'Vale'))), 'ni ve visitas ajenas';
end $$;
reset role;

-- ── Ruteo de visita médica (0027) ──────────────────────────────────
select pg_temp.como('sergio@camping44.com.py') \gset
set role authenticated;
do $$ declare r jsonb; f jsonb; v_vale uuid := (select id from vis_vendedores where nombre = 'Vale'); begin
  f := jsonb_build_array(
    jsonb_build_object('dia', vis_hoy(), 'lugar', 'hospital central', 'especialidad', 'Traumatología', 'medico', 'Dr. Nuevo'),
    jsonb_build_object('dia', vis_hoy(), 'lugar', 'Hospital Central', 'especialidad', 'pediatría'),
    jsonb_build_object('dia', vis_hoy(), 'lugar', 'Clínica Nueva', 'medico', 'Dra. Gómez', 'direccion', 'Calle 1', 'lat', -25.3, 'lng', -57.6));
  r := vis_cargar_ruteo(jsonb_build_object('visitadora_id', v_vale, 'semana', vis_hoy(), 'filas', f));
  -- Hospital Central ya tiene parada hoy (con la visita de prueba); se agrega la de Clínica Nueva.
  assert (r ->> 'paradas')::int = 1 and (r ->> 'objetivos')::int = 3 and (r ->> 'lugares_nuevos')::int = 1 and (r ->> 'medicos_nuevos')::int = 1,
    format('carga del ruteo: %s', r);
  assert (r ->> 'ruta_id')::uuid = (select id from vis_rutas where nombre = 'Ruta Vale'), 'usa la ruta de esa semana';
  assert exists (select 1 from vis_medico_lugares ml join vis_medicos m on m.id = ml.medico_id join vis_clientes c on c.id = ml.lugar_id
                 where m.nombre = 'Dra. Gómez' and c.razon_social = 'Clínica Nueva'), 'el médico se suma al lugar nuevo';
  assert (select lat from vis_clientes where razon_social = 'Clínica Nueva') = -25.3, 'el lugar nuevo toma la ubicación de la planilla';
  assert (select lat from vis_clientes where razon_social = 'Hospital Central') = -25.29, 'pero no pisa la del GPS';
  r := vis_cargar_ruteo(jsonb_build_object('visitadora_id', v_vale, 'semana', vis_hoy(), 'filas', f));
  assert (r ->> 'objetivos')::int = 0 and (r ->> 'paradas')::int = 0, format('cargarla dos veces no repite: %s', r);
  r := vis_cargar_ruteo(jsonb_build_object('visitadora_id', v_vale, 'semana', vis_hoy(), 'reemplazar', true, 'filas', f));
  assert (r ->> 'objetivos')::int = 3, format('reemplazar vuelve a armar los objetivos de esos días: %s', r);
  assert (select count(*) from vis_ruteo_semana(v_vale, vis_hoy()) where dia = vis_hoy()) = 3, 'la semana: una fila por objetivo';
  assert (select resultado from vis_ruteo_semana(v_vale, vis_hoy()) where lower(especialidad) = 'pediatría' and medico_id is null) = 'Dejó muestras',
    'el objetivo por especialidad toma la visita a un médico de esa especialidad en ese lugar';
  assert (select resultado from vis_ruteo_semana(v_vale, vis_hoy()) where medico = 'Dr. Nuevo') is null, 'Dr. Nuevo: pendiente';
  begin
    perform vis_cargar_ruteo(jsonb_build_object('visitadora_id', v_vale, 'semana', vis_hoy(),
      'filas', jsonb_build_array(jsonb_build_object('dia', vis_hoy() + 9, 'lugar', 'X'))));
    assert false, 'días fuera de la semana';
  exception when raise_exception then null;
  end;
  assert exists (select 1 from vis_resultados where nombre = 'Sin acceso' and tipo = 'medica'), 'resultado Sin acceso';
end $$;
reset role;
select pg_temp.como('vale@vitalica.com.py') \gset
set role authenticated;
do $$ begin
  assert (select count(*) from vis_parada_objetivos) = 3, 'la visitadora ve los objetivos de su ruta publicada';
  begin
    insert into vis_parada_objetivos (parada_id, especialidad) select id, 'X' from vis_ruta_paradas limit 1;
    assert false, 'pero no los cambia';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ begin
  assert not exists (select 1 from vis_parada_objetivos), 'otro vendedor no los ve';
  begin
    perform vis_cargar_ruteo(jsonb_build_object('visitadora_id', (select id from vis_vendedores where nombre = 'Vale'), 'semana', vis_hoy(), 'filas', '[]'::jsonb));
    assert false, 'un vendedor no carga ruteo';
  exception when raise_exception then null;
  end;
end $$;
reset role;

-- ── GPS en segundo plano con Traccar (0028) ────────────────────────
select pg_temp.como('vale@vitalica.com.py') \gset
set role authenticated;
do $$ declare a jsonb; b jsonb; c jsonb; begin
  a := vis_mi_gps();
  b := vis_mi_gps();
  assert a ->> 'codigo' = b ->> 'codigo' and length(a ->> 'codigo') >= 10, format('un código fijo por vendedor: %s', a);
  c := vis_mi_gps(true);
  assert c ->> 'codigo' <> a ->> 'codigo', 'cambiar el código';
  perform set_config('test.codigo', c ->> 'codigo', false);
  begin
    perform vis_gps_recibir(c ->> 'codigo', '[]'::jsonb);
    assert false, 'solo el servidor recibe posiciones';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('test.codigo', (select codigo from vis_gps_dispositivos d join vis_vendedores v on v.id = d.vendedor_id where v.nombre = 'Vale'), false) \gset
update vis_jornadas set fin = coalesce(fin, now() - interval '3 hours') where vendedor_id = (select id from vis_vendedores where nombre = 'Vale');
insert into vis_jornadas (vendedor_id, inicio) values ((select id from vis_vendedores where nombre = 'Vale'), now() - interval '1 hour');
do $$ declare r jsonb; begin
  r := vis_gps_recibir(current_setting('test.codigo'), jsonb_build_array(
    jsonb_build_object('fecha_hora', now() - interval '10 minutes', 'lat', -25.29, 'lng', -57.61, 'precision_m', 12, 'bateria_pct', 80),
    jsonb_build_object('fecha_hora', now() - interval '9 minutes', 'lat', -25.29, 'lng', -57.61, 'precision_m', 900),
    jsonb_build_object('fecha_hora', now() - interval '2 hours', 'lat', -25.29, 'lng', -57.61, 'precision_m', 10)));
  assert (r ->> 'guardadas')::int = 1, format('solo con jornada abierta y buena precisión: %s', r);
  assert (select origen from vis_posiciones where vendedor_id = (r ->> 'vendedor_id')::uuid order by fecha_hora desc limit 1) = 'traccar', 'marcada como Traccar';
  assert (select ultima_posicion_el from vis_gps_dispositivos where codigo = current_setting('test.codigo')) is not null, 'queda la última posición';
  r := vis_gps_recibir(current_setting('test.codigo'), jsonb_build_array(
    jsonb_build_object('fecha_hora', now() - interval '10 minutes', 'lat', -25.29, 'lng', -57.61)));
  assert (r ->> 'guardadas')::int = 0, 'repetida no se duplica';
  assert vis_gps_recibir('c44noexiste000', '[]'::jsonb) is null, 'código desconocido';
end $$;
select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ begin
  assert not exists (select 1 from vis_gps_dispositivos), 'otro vendedor no ve el código de la visitadora';
end $$;
reset role;
select pg_temp.como('sergio@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert exists (select 1 from vis_gps_dispositivos), 'el supervisor ve el estado del GPS de su gente';
end $$;
reset role;

-- ── No le interesa y detalle del tablero (0029) ────────────────────
select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ declare v_cli uuid := (select id from vis_clientes where razon_social = 'Cliente de Hugo'); begin
  perform vis_registrar_visita(jsonb_build_object('client_uuid', gen_random_uuid(), 'cliente_id', v_cli, 'fecha_hora', now() - interval '2 minutes',
    'resultado_id', (select id from vis_resultados where nombre = 'No le interesa'), 'observaciones', 'Compra a otro proveedor'));
  assert (select estado from vis_clientes_v where id = v_cli) = 'no_interesado', 'queda «no le interesa»';
  assert (select motivo from vis_cliente_no_interesa where cliente_id = v_cli) = 'Compra a otro proveedor', 'con el motivo';
  perform vis_registrar_visita(jsonb_build_object('client_uuid', gen_random_uuid(), 'cliente_id', v_cli, 'fecha_hora', now() - interval '2 days',
    'resultado_id', (select id from vis_resultados where nombre = 'Tiene stock')));
  assert (select estado from vis_clientes_v where id = v_cli) = 'no_interesado', 'una visita vieja que se sube tarde no lo desmarca';
end $$;
reset role;
select pg_temp.como('sergio@camping44.com.py') \gset
set role authenticated;
do $$ declare v_hugo uuid := (select id from vis_vendedores where nombre = 'Hugo'); begin
  assert (select count(*) from vis_tablero_detalle(v_hugo, vis_hoy(), vis_hoy()) where tipo = 'visita') >= 1, 'detalle del tablero: visitas de hoy';
  assert (select resultado from vis_tablero_detalle(v_hugo, vis_hoy(), vis_hoy()) where tipo = 'visita' and resultado = 'No le interesa' limit 1) is not null, 'con el motivo';
  assert (select estado from vis_tablero_detalle(v_hugo, vis_hoy(), vis_hoy()) where resultado = 'No le interesa' limit 1) = 'no_interesado', 'y el estado';
end $$;
reset role;
select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ declare v_cli uuid := (select id from vis_clientes where razon_social = 'Cliente de Hugo'); begin
  perform vis_registrar_visita(jsonb_build_object('client_uuid', gen_random_uuid(), 'cliente_id', v_cli,
    'resultado_id', (select id from vis_resultados where nombre = 'Hizo pedido')));
  assert (select estado from vis_clientes_v where id = v_cli) <> 'no_interesado', 'una visita nueva con otro resultado lo desmarca';
end $$;
reset role;

-- ── Llegadas de la visitadora (0030) ───────────────────────────────
insert into vis_clientes (razon_social, categoria, ciudad, empresa_id, vendedor_id)
select x, 'lugar', 'Asunción', v.empresa_id, v.id from vis_vendedores v, unnest(array['Consultorio Sin Ruta', 'Lugar Visita Suelta']) x where v.nombre = 'Vale';
select pg_temp.como('vale@vitalica.com.py') \gset
set role authenticated;
do $$ declare r jsonb; r2 jsonb; u uuid := gen_random_uuid(); v_l uuid := (select id from vis_clientes where razon_social = 'Consultorio Sin Ruta'); begin
  r := vis_crear_lugar(jsonb_build_object('nombre', 'Consultorio Nuevo', 'lat', -25.3, 'lng', -57.6, 'precision_m', 10));
  assert (r ->> 'parada_id') is not null, 'el alta del lugar lo suma a la ruta de hoy';
  assert exists (select 1 from vis_paradas_dia(vis_hoy(), vis_mi_id()) where razon_social = 'Consultorio Nuevo'), 'y aparece en Hoy';
  assert exists (select 1 from vis_llegadas where lugar_id = (r ->> 'id')::uuid), 'y cuenta como llegada';
  r := vis_marcar_llegada(jsonb_build_object('client_uuid', u, 'lugar_id', v_l, 'lat', -25.31, 'lng', -57.61, 'precision_m', 12));
  assert (r ->> 'ubicacion_guardada')::boolean, 'el lugar sin ubicación toma la de la llegada';
  assert exists (select 1 from vis_paradas_dia(vis_hoy(), vis_mi_id()) where razon_social = 'Consultorio Sin Ruta'), 'llegar lo suma a la ruta de hoy';
  r2 := vis_marcar_llegada(jsonb_build_object('client_uuid', u, 'lugar_id', v_l));
  assert (r2 ->> 'duplicada')::boolean and r2 ->> 'id' = r ->> 'id', 'reintento no duplica';
  r := vis_registrar_visita(jsonb_build_object('client_uuid', gen_random_uuid(), 'cliente_id', (select id from vis_clientes where razon_social = 'Lugar Visita Suelta'),
    'resultado_id', (select id from vis_resultados where nombre = 'Presentó productos')));
  assert (select ruta_parada_id from vis_visitas where id = (r ->> 'id')::uuid) is not null, 'una visita a un lugar fuera de la ruta lo suma solo';
end $$;
reset role;
select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ begin
  begin
    perform vis_marcar_llegada(jsonb_build_object('lugar_id', (select id from vis_clientes where razon_social = 'Consultorio Sin Ruta')));
    assert false, 'no se marca llegada en un lugar ajeno';
  exception when raise_exception then null;
  end;
  assert not exists (select 1 from vis_llegadas), 'ni se ven las llegadas de otro';
end $$;
reset role;
select pg_temp.como('sergio@camping44.com.py') \gset
set role authenticated;
do $$ begin
  assert (select count(*) from vis_llegadas) >= 2, 'el supervisor ve las llegadas';
  assert (select llegada from vis_ruteo_semana((select id from vis_vendedores where nombre = 'Vale'), vis_hoy()) where lugar = 'Consultorio Sin Ruta' limit 1) is not null,
    'y la hora de llegada en el ruteo';
end $$;
reset role;

-- ── Quitar una llegada marcada por error (0031) ────────────────────
insert into vis_clientes (razon_social, categoria, ciudad, empresa_id, vendedor_id)
select 'Consultorio Por Error', 'lugar', 'Asunción', v.empresa_id, v.id from vis_vendedores v where v.nombre = 'Vale';
select pg_temp.como('vale@vitalica.com.py') \gset
set role authenticated;
do $$ declare r jsonb; q jsonb; v_l uuid := (select id from vis_clientes where razon_social = 'Consultorio Por Error'); begin
  r := vis_marcar_llegada(jsonb_build_object('lugar_id', v_l, 'lat', -25.4, 'lng', -57.5, 'precision_m', 8));
  assert (select lat from vis_clientes where id = v_l) = -25.4, 'la llegada le puso ubicación';
  perform set_config('test.llegada', r ->> 'id', false);
  q := vis_quitar_llegada((r ->> 'id')::uuid);
  assert (q ->> 'parada_quitada')::boolean and (q ->> 'ubicacion_quitada')::boolean, format('quitar: %s', q);
  assert not exists (select 1 from vis_llegadas where id = (r ->> 'id')::uuid), 'la llegada se fue';
  assert (select lat from vis_clientes where id = v_l) is null, 'y la ubicación que había puesto';
  assert not exists (select 1 from vis_paradas_dia(vis_hoy(), vis_mi_id()) where razon_social = 'Consultorio Por Error'), 'y sale de Hoy';
  -- Con visitas en el lugar, no.
  r := vis_marcar_llegada(jsonb_build_object('lugar_id', (select id from vis_clientes where razon_social = 'Consultorio Sin Ruta')));
  begin
    perform vis_quitar_llegada((select id from vis_llegadas where lugar_id = (select id from vis_clientes where razon_social = 'Lugar Visita Suelta') limit 1));
    assert false, 'no hay llegada ahí: error';
  exception when raise_exception then null;
  end;
end $$;
reset role;
insert into vis_llegadas (vendedor_id, lugar_id, fecha_hora) select vendedor_id, id, now() - interval '1 hour' from vis_clientes where razon_social = 'Lugar Visita Suelta';
select pg_temp.como('vale@vitalica.com.py') \gset
set role authenticated;
do $$ begin
  begin
    perform vis_quitar_llegada((select id from vis_llegadas where lugar_id = (select id from vis_clientes where razon_social = 'Lugar Visita Suelta') limit 1));
    assert false, 'con visitas registradas después de la llegada no se quita';
  exception when raise_exception then null;
  end;
end $$;
reset role;
select pg_temp.como('hugo@vitalica.com.py') \gset
set role authenticated;
do $$ begin
  begin
    perform vis_quitar_llegada((select id from vis_llegadas limit 1));
    assert false, 'nadie quita llegadas ajenas';
  exception when raise_exception then null;
  end;
end $$;
reset role;

-- Volver al mismo lugar en el día: dos llegadas, la de la tarde se puede quitar aunque haya visitas a la mañana.
select pg_temp.como('vale@vitalica.com.py') \gset
set role authenticated;
do $$ declare r jsonb; v_l uuid := (select id from vis_clientes where razon_social = 'Lugar Visita Suelta'); begin
  r := vis_marcar_llegada(jsonb_build_object('lugar_id', v_l));
  assert (select count(*) from vis_llegadas where lugar_id = v_l) = 2, 'segunda llegada al mismo lugar';
  assert (select array_length(llegadas, 1) from vis_ruteo_semana(vis_mi_id(), vis_hoy()) where lugar = 'Lugar Visita Suelta' limit 1) = 2, 'el ruteo muestra las dos';
  -- Dos visitas del día en un lugar sin objetivos: dos filas en el ruteo.
  perform vis_registrar_visita(jsonb_build_object('client_uuid', gen_random_uuid(), 'cliente_id', v_l,
    'fecha_hora', now() - interval '30 minutes', 'resultado_id', (select id from vis_resultados where nombre = 'Presentó productos')));
  assert (select count(*) from vis_ruteo_semana(vis_mi_id(), vis_hoy()) where lugar = 'Lugar Visita Suelta' and dia = vis_hoy()) =
         (select count(*) from vis_visitas where cliente_id = v_l and (fecha_hora at time zone 'America/Asuncion')::date = vis_hoy()), 'una fila por visita del día';
  perform vis_quitar_llegada((r ->> 'id')::uuid);
  assert (select count(*) from vis_llegadas where lugar_id = v_l) = 1, 'la de la tarde se quita aunque haya visitas antes';
  assert exists (select 1 from vis_paradas_dia(vis_hoy(), vis_mi_id()) where razon_social = 'Lugar Visita Suelta'), 'y la parada queda (tiene la visita)';
end $$;
reset role;

select 'OK: todas las pruebas pasaron' as resultado;
