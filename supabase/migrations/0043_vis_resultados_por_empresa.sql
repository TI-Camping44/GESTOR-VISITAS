-- Resultados de visita por empresa (23/11, pedido de Sergio: «habilitame para agregar más resultados a la lista»).
-- La lista era una sola para Camping 44 y Vitalica: lo que agregaba un admin lo veían las dos.
-- Ahora: empresa_id nulo = compartido (los de siempre; solo un admin de ambas empresas los cambia) y
-- empresa_id = la empresa → solo esa empresa lo ve y su admin lo agrega, renombra, ordena u oculta.
alter table vis_resultados add column if not exists empresa_id uuid references vis_empresas(id);

alter policy resultados_select on vis_resultados
  using ((select vis_mi_id()) is not null and (empresa_id is null or empresa_id = (select vis_mi_empresa())));

alter policy resultados_write on vis_resultados
  using ((select vis_es_admin()) and (empresa_id = (select vis_mi_empresa()) or (empresa_id is null and (select vis_soy_admin_multi()))))
  with check ((select vis_es_admin()) and (empresa_id = (select vis_mi_empresa()) or (empresa_id is null and (select vis_soy_admin_multi()))));
