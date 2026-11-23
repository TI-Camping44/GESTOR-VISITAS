-- Hora pactada de cada parada (23/11, pedido de Facundo para la visita médica): Sergio la carga en el Ruteo de la
-- semana (hora en que la visitadora tiene que estar en ese lugar, la que acordó con el médico o el consultorio).
-- La visitadora la ve en Hoy en vez de la llegada aproximada, y el panel la compara con la llegada real.
-- Sin hora pactada, sigue la aproximada de siempre. Los permisos son los de vis_ruta_paradas (supervisor escribe).
alter table vis_ruta_paradas add column hora_pactada time;
comment on column vis_ruta_paradas.hora_pactada is 'Hora acordada para llegar a esa parada (la carga el supervisor en el Ruteo de la semana).';
