-- Ciudades para elegir de una lista al dar de alta un cliente.
-- Las abreviaturas y variantes ("CDE", "Fdo de la Mora") pasan a su propia columna: siguen sirviendo
-- para reconocer la zona de un cliente que venga de Odoo así escrito, pero no aparecen en la lista.

alter table vis_zonas add column ciudades_alias text[] not null default '{}';

with alias(nombre) as (values
  ('Asunción Centro'), ('Mariano'), ('Fdo de la Mora'),
  ('Mcal Estigarribia'),
  ('Cnel Oviedo'), ('J E Estigarribia'), ('Juan Eulogio Estigarribia'), ('Campo 9'), ('Sta Rita'), ('Juan Emilio O''Leary'), ('Oleary'),
  ('CDE'), ('Pte Franco'),
  ('PJC'), ('Bella Vista Norte'),
  ('Nva Durango'), ('San Pedro del Ycuamandiyú'), ('San Pedro de Ycuamandiyú'), ('General Resquín'), ('Santa Rosa Aguaray'),
  ('Itac Rosario'), ('Saltos del Guairá'), ('La Paloma del Espíritu Santo'), ('Nva Esperanza'),
  ('M Auxiliadora'),
  ('Col Pfannel'), ('Col Independencia')
)
update vis_zonas z set
  ciudades_alias = array(select c from unnest(z.ciudades) c where c in (select nombre from alias)),
  ciudades       = array(select c from unnest(z.ciudades) c where c not in (select nombre from alias));

create or replace function vis_zona_por_ciudad(p_ciudad text) returns uuid
language sql stable set search_path = public, extensions as $$
  select case when count(*) = 1 then (array_agg(z.id))[1] end
  from vis_zonas z
  where z.activo and btrim(coalesce(p_ciudad, '')) <> ''
    and exists (select 1 from unnest(z.ciudades || z.ciudades_alias) c where vis_nombre_cmp(c) = vis_nombre_cmp(p_ciudad))
$$;
