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
  assert (select realizadas from vis_tablero(date_trunc('week', vis_hoy())::date) where dia = vis_hoy()) = 1, 'tablero: 1 visita hoy';
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

-- ── Zonas por ciudad (0007) ────────────────────────────────────────
do $$ declare v uuid; begin
  assert (select nombre from vis_zonas where id = vis_zona_por_ciudad('concepcion')) = 'Zona Norte 1', 'Concepción → Zona Norte 1';
  assert (select nombre from vis_zonas where id = vis_zona_por_ciudad('CDE')) = 'Zona Este 2', 'CDE → Zona Este 2';
  assert (select nombre from vis_zonas where id = vis_zona_por_ciudad('San Pedro del Paraná')) = 'Zona Sur Oeste', 'San Pedro del Paraná no se confunde con San Pedro';
  assert vis_zona_por_ciudad('Asunción') is null, 'Asunción está en dos zonas: la asigna el supervisor';
  insert into vis_clientes (razon_social, ciudad) values ('Cliente Encarnación', 'Encarnacion') returning id into v;
  assert (select z.nombre from vis_clientes c join vis_zonas z on z.id = c.zona_id where c.id = v) = 'Zona Sur', 'el cliente nuevo toma la zona por la ciudad';
  update vis_clientes set zona_id = null where id = v;
  assert (select zona_id from vis_clientes where id = v) is null, 'quitar la zona a mano se respeta';
end $$;

select 'OK: todas las pruebas pasaron' as resultado;
