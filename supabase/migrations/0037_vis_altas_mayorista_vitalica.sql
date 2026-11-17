-- Altas de la venta mayorista de Vitalica (TI-0115, 17/11, pedido de Sergio para la ruta de Hugo del miércoles 18/11).
-- Solo datos, sin cambios de esquema. Se identifica todo por claves naturales (odoo_partner_id, nombre), así que en una
-- base sin estos clientes (db:test) no hace nada, y si se vuelve a correr no duplica.
--
-- 1) Sucursales que no están en Odoo (empresa_id = Vitalica, casa matriz = la empresa de Odoo, vendedor Hugo):
--    - GRUPO ENERGY S.A. (Odoo 3213): sus 7 sucursales.
--    - DISTRIBUIDORA KB-WITTENBERG (Odoo 21610): Sky Center (además de Centro Médico Mónaco).
--    - LICHTON S.A. / Fitway (Odoo 21429): Pacheco / Charles de Gaulle (según Sergio, la «Casa Central» de Odoo es
--      la de Marketplace Av. España).
--    Sin coordenadas propias: las toma el prospecto que se fusiona (abajo) o Hugo en la primera visita.
-- 2) Prospectos que Hugo cargó desde la app en la calle → su cliente oficial: las visitas pasan al oficial, el GPS
--    se copia si el oficial no tenía (origen gps_visita: Odoo no lo pisa) y el prospecto queda inactivo con una nota.
--    No se borra nada. «Grupp energy» (Sta. Teresa, Fdo. de la Mora) queda como está: no es la de Mcal. Estigarribia
--    (a ~3 km), falta que Sergio diga si es otra sucursal.

do $$
declare
  v_vit  uuid := (select id from vis_empresas where nombre = 'Vitalica');
  v_hugo uuid := (select id from vis_vendedores where email = 'hugojara@vitalica.com.py');
  r record;
  o vis_clientes;
  p vis_clientes;
  v_nota text;
begin
  if v_vit is null or v_hugo is null then return; end if;

  -- 1) Sucursales nuevas.
  insert into vis_clientes (razon_social, direccion, ciudad, empresa_id, cliente_padre_id, vendedor_id, categoria, notas)
  select s.nombre, s.direccion, s.ciudad, v_vit, padre.id, v_hugo, 'cliente',
         'Alta manual (TI-0115, pedido de Sergio, 17/11/2026): no está en Odoo.'
  from (values
    (3213,  'GRUPO ENERGY S.A. · Av. España c/ Venezuela',            'Av. España c/ Venezuela',             'Asunción'),
    (3213,  'GRUPO ENERGY S.A. · San Martín / Olegario V. Andrade',    'San Martín c/ Olegario V. Andrade',   'Asunción'),
    (3213,  'GRUPO ENERGY S.A. · Félix Bogado / Paso Puku',            'Félix Bogado c/ Paso Puku',           'Asunción'),
    (3213,  'GRUPO ENERGY S.A. · Mcal. Estigarribia / Zavala Cué',     'Mcal. Estigarribia, Zavala Cué',      'Fernando de la Mora'),
    (3213,  'GRUPO ENERGY S.A. · Cap. Andrés Insfrán / Cnel. Oviedo',  'Cap. Andrés Insfrán c/ Cnel. Oviedo', 'Luque'),
    (3213,  'GRUPO ENERGY S.A. · Transchaco / BOX Mayorista',          'Ruta Transchaco, BOX Mayorista',      'Mariano Roque Alonso'),
    (3213,  'GRUPO ENERGY S.A. · Transchaco / Cnel. Hermosilla',       'Ruta Transchaco c/ Cnel. Hermosilla', 'Mariano Roque Alonso'),
    (21610, 'DISTRIBUIDORA KB-WITTENBERG E.A.S. · Sky Center (Asunción)',
            'Edificio Sky Center, Piso 7, Oficina 701, Av. José de San Martín esq. Austria', 'Asunción'),
    -- Mismo prefijo que las sucursales de Fitway que vienen de Odoo.
    (21429, 'LICHTON S.A. - FITWAY · FITWAY-PACHECO / CHARLES DE GAULLE', 'Toribio Pacheco c/ Charles de Gaulle', 'Asunción')
  ) as s(padre_odoo, nombre, direccion, ciudad)
  join vis_clientes padre on padre.odoo_partner_id = s.padre_odoo and padre.cliente_padre_id is null
  where not exists (select 1 from vis_clientes x where x.razon_social = s.nombre and x.empresa_id = v_vit);

  update vis_clientes set notas = concat_ws(E'\n', nullif(notas, ''), 'Según Sergio (17/11/2026): es la sucursal de Marketplace Av. España.')
  where odoo_partner_id = 21430 and coalesce(notas, '') not like '%Marketplace Av. España%';

  -- 2) Prospecto (nombre y dirección como los cargó Hugo) → cliente oficial (por Odoo o por el nombre de la sucursal nueva).
  for r in
    select * from (values
      ('Farmacia energy',      'Av españa',                       null::int, 'GRUPO ENERGY S.A. · Av. España c/ Venezuela'),
      ('Grupo energy',         'San matin',                       null,      'GRUPO ENERGY S.A. · San Martín / Olegario V. Andrade'),
      ('Grupo energy',         'Felix bogado',                    null,      'GRUPO ENERGY S.A. · Félix Bogado / Paso Puku'),
      ('Grupo energy',         'Super pueblo',                    null,      'GRUPO ENERGY S.A. · Mcal. Estigarribia / Zavala Cué'),
      ('Grupo energy',         'Cnel oviedo casi capitan andres', null,      'GRUPO ENERGY S.A. · Cap. Andrés Insfrán / Cnel. Oviedo'),
      ('Grupo energy',         'Mariano box',                     null,      'GRUPO ENERGY S.A. · Transchaco / BOX Mayorista'),
      ('Grupo energy',         'Transchaco',                      null,      'GRUPO ENERGY S.A. · Transchaco / Cnel. Hermosilla'),
      ('Fitway',               'Pacheco',                         null,      'LICHTON S.A. - FITWAY · FITWAY-PACHECO / CHARLES DE GAULLE'),
      ('Fitway',               'Av españa',                       21430,     null),  -- Casa Central = Marketplace Av. España
      ('Fitway',               'Shopping del sol',                23840,     null),
      ('Fitway',               'Shopp multiplaza',                21432,     null),
      ('The vitamin shoppe',   'Mcal lopez',                      21558,     null),  -- Shopping Mariscal
      ('The vitamin shoppe',   'Perseverancia',                   21559,     null),
      ('The vitamin shoppe',   'Shopping Pinedo',                 21562,     null),
      ('The vitamin shoppe',   'Shopping san lorenzo',            21561,     null),
      ('Tvs',                  'Plaza norte',                     24916,     null),
      ('Tvs vigor sa',         'Lambare century',                 21557,     null),
      ('Vigor S.A',            'Av españa',                       21556,     null),
      ('VIGOR SA',             'Shopping Mariano',                21560,     null),
      ('KB DISTRIBUIDORA',     'Sacramento',                      21615,     null)   -- Centro Médico Mónaco (Sacramento 1244)
    ) as m(prospecto, direccion, destino_odoo, destino_nombre)
  loop
    select * into p from vis_clientes
    where razon_social = r.prospecto and direccion = r.direccion and odoo_partner_id is null and vendedor_id = v_hugo and activo
    limit 1;
    if not found then continue; end if;
    if r.destino_odoo is not null then
      select * into o from vis_clientes where odoo_partner_id = r.destino_odoo limit 1;
    else
      select * into o from vis_clientes where razon_social = r.destino_nombre and empresa_id = v_vit limit 1;
    end if;
    if not found or o.id = p.id then continue; end if;

    update vis_visitas set cliente_id = o.id where cliente_id = p.id;
    update vis_ruta_paradas rp set cliente_id = o.id where rp.cliente_id = p.id
      and not exists (select 1 from vis_ruta_paradas x where x.ruta_id = rp.ruta_id and x.cliente_id = o.id and x.dia = rp.dia);
    update vis_llegadas set lugar_id = o.id where lugar_id = p.id;
    update vis_no_visitados set lugar_id = o.id where lugar_id = p.id;

    if o.lat is null and p.lat is not null then
      update vis_clientes set lat = p.lat, lng = p.lng, origen_ubicacion = 'gps_visita', ubicacion_precision_m = p.ubicacion_precision_m,
        ubicacion_actualizada_por = p.ubicacion_actualizada_por, ubicacion_actualizada_el = coalesce(p.ubicacion_actualizada_el, p.created_at)
      where id = o.id;
      insert into vis_cliente_ubicaciones_hist (cliente_id, lat, lng, precision_m, origen, motivo, usuario_id)
      values (o.id, p.lat, p.lng, p.ubicacion_precision_m, 'gps_visita',
              'GPS del prospecto «' || p.razon_social || ' – ' || p.direccion || '» que cargó Hugo (TI-0115, 17/11/2026)', p.ubicacion_actualizada_por);
    end if;
    if o.telefono is null and p.telefono is not null then
      update vis_clientes set telefono = p.telefono where id = o.id; -- telefono_norm se calcula solo
    end if;

    v_nota := 'Fusionado con «' || o.razon_social || '» el 17/11/2026 (TI-0115, pedido de Sergio): las visitas y la ubicación pasaron a ese cliente.';
    update vis_clientes set activo = false, notas = concat_ws(E'\n', nullif(notas, ''), v_nota) where id = p.id;
  end loop;
end $$;
