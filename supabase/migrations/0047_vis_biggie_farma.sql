-- Sucursales de Biggie Farma para Hugo (26/11, pedido de Facundo; planilla «Ingreso Vitalica - con dato de sucursales
-- para ruteo Vendedor Mayorista», pestaña Resumen). Solo datos. No están en Odoo como contactos hijos: se cargan como
-- sucursales de Vitalica (empresa_id = Vitalica) con casa matriz BIGGIE S.A. (Odoo 18543) y vendedor Hugo.
-- Nombre «Biggie Farma <sucursal>», dirección = la sucursal, ciudad de la planilla; el código de almacén (F124…) y el
-- cluster van en las notas. Sin coordenadas: Hugo las toma en la primera visita. No duplica si se vuelve a correr.

do $$
declare
  v_vit  uuid := (select id from vis_empresas where nombre = 'Vitalica');
  v_hugo uuid := (select id from vis_vendedores where email = 'hugojara@vitalica.com.py');
  v_padre uuid := (select id from vis_clientes where odoo_partner_id = 18543 and cliente_padre_id is null limit 1);
begin
  if v_vit is null or v_hugo is null then return; end if;

  insert into vis_clientes (razon_social, direccion, ciudad, empresa_id, cliente_padre_id, vendedor_id, categoria, notas)
  select 'Biggie Farma ' || s.sucursal, s.sucursal, s.ciudad, v_vit, v_padre, v_hugo, 'cliente',
         format('Biggie Farma · Cód. almacén %s · Cluster %s. Alta manual (26/11/2026, planilla de carga inicial Olimp): no está en Odoo.', s.codigo, s.cluster)
  from (values
    ('F124', 'Bruno Guggiari Pinoza',              'Asunción',             'A'),
    ('F073', 'Colon Sajonia',                      'Asunción',             'A'),
    ('F121', 'De Las Palmeras',                    'Asunción',             'A'),
    ('F273', 'Encarnacion Lomas Valentinas',       'Encarnación',          'A'),
    ('F209', 'España Y San Jose',                  'Asunción',             'A'),
    ('F132', 'Fernando Zavala Cue Norte',          'Fernando de la Mora',  'A'),
    ('F057', 'Gaudioso Nunez',                     'Asunción',             'A'),
    ('F272', 'Heroes Del Chaco',                   'Asunción',             'A'),
    ('F203', 'Hipodromo',                          'Asunción',             'A'),
    ('F036', 'Lambare Argana',                     'Lambaré',              'A'),
    ('F126', 'Lambare Bruno Guggiari San Rafael',  'Lambaré',              'A'),
    ('F154', 'Lambare Medicos Del Chaco',          'Lambaré',              'A'),
    ('F217', 'Lambare Veranda',                    'Lambaré',              'A'),
    ('F009', 'Las Mercedes España',                'Asunción',             'A'),
    ('F263', 'Legion Civil Extranjera',            'Asunción',             'A'),
    ('F083', 'Lilio Villa Morra',                  'Asunción',             'A'),
    ('F286', 'Lillo Brizuela',                     'Asunción',             'A'),
    ('F052', 'Los Laureles Republica Argentina',   'Asunción',             'A'),
    ('F080', 'Molas Lopez Lomas',                  'Asunción',             'A'),
    ('F128', 'San Lorenzo De La Victoria',         'San Lorenzo',          'A'),
    ('F093', 'San Lorenzo Pastora Cespedes',       'San Lorenzo',          'A'),
    ('F096', 'San Vicente Iglesia',                'Asunción',             'A'),
    ('F024', 'Trinidad Campo Grande',              'Asunción',             'A'),
    ('F041', 'Villa Elisa Von Poleski',            'Villa Elisa',          'A'),
    ('F258', 'Villeta Centro',                     'Villeta',              'A'),
    ('F097', 'Azara Y Eeuu',                       'Asunción',             'B'),
    ('F045', 'Luque Alfaro',                       'Luque',                'B'),
    ('F206', 'Mariano Roque Alonso Cimefor',       'Mariano Roque Alonso', 'B'),
    ('F166', 'Pizarro',                            'Asunción',             'B'),
    ('F285', 'Caaguazu Bernardino Caballero',      'Caaguazú',             'C')
  ) as s(codigo, sucursal, ciudad, cluster)
  where not exists (select 1 from vis_clientes x where x.empresa_id = v_vit and x.razon_social = 'Biggie Farma ' || s.sucursal);
end $$;
