-- Hora pactada por médico (23/11, pedido de Facundo): en un mismo lugar cada médico atiende a una hora distinta.
-- Sergio la carga en «Armar el día» y en el Ruteo de la semana; la visitadora la ve en Hoy y en el lugar, y el panel
-- compara la hora de la visita con la pactada. Permisos: los de vis_parada_objetivos (supervisor escribe).
alter table vis_parada_objetivos add column hora_pactada time;
comment on column vis_parada_objetivos.hora_pactada is 'Hora acordada con ese médico en esa parada (la carga el supervisor).';
