-- «Ya no atiende acá» (16/11, pedido de Facundo): la visitadora va a un lugar y un médico se mudó o dejó de
-- atender ahí. Registra la visita a ese médico con este resultado (y, si sabe, a dónde se fue en Observaciones):
-- el médico sale solo de ese lugar (vis_medico_lugares). No se borra: sus visitas y sus otros lugares quedan.
insert into vis_resultados (nombre, es_venta, orden, tipo) values ('Ya no atiende acá', false, 6, 'medica')
on conflict (nombre) do nothing;

create or replace function vis_medico_ya_no_atiende() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.medico_id is not null and new.resultado_id = (select id from vis_resultados where nombre = 'Ya no atiende acá') then
    delete from vis_medico_lugares where medico_id = new.medico_id and lugar_id = new.cliente_id;
  end if;
  return new;
end $$;
create trigger vis_visitas_ya_no_atiende after insert or update of resultado_id on vis_visitas
  for each row execute function vis_medico_ya_no_atiende();
