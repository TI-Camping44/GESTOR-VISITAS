-- Camping 44 ya no tiene Venta externa (03/11, Facundo): todo queda en Mayorista.
-- La gente y las zonas de Venta externa pasan a Mayorista y el equipo se borra.
with c44 as (select id from vis_empresas where nombre = 'Camping 44'),
     may as (select q.id from vis_equipos q, c44 where q.empresa_id = c44.id and q.nombre = 'Mayorista'),
     ext as (select q.id from vis_equipos q, c44 where q.empresa_id = c44.id and q.nombre = 'Venta externa')
update vis_vendedores set equipo_id = (select id from may) where equipo_id in (select id from ext) and exists (select 1 from may);

with c44 as (select id from vis_empresas where nombre = 'Camping 44'),
     may as (select q.id from vis_equipos q, c44 where q.empresa_id = c44.id and q.nombre = 'Mayorista'),
     ext as (select q.id from vis_equipos q, c44 where q.empresa_id = c44.id and q.nombre = 'Venta externa')
update vis_zonas set equipo_id = (select id from may) where equipo_id in (select id from ext) and exists (select 1 from may);

delete from vis_equipos q using vis_empresas e
where e.id = q.empresa_id and e.nombre = 'Camping 44' and q.nombre = 'Venta externa'
  and not exists (select 1 from vis_vendedores v where v.equipo_id = q.id)
  and not exists (select 1 from vis_zonas z where z.equipo_id = q.id);
