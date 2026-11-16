-- Ciclos de rutas (0034): cada día a las 04:30 de Paraguay (07:30 UTC) genera, para los ciclos activos,
-- la semana actual y las 2 siguientes que falten. Lo que ya existe no se toca.
select cron.schedule('vis_generar_ciclos', '30 7 * * *', $$select public.vis_generar_ciclos_todos()$$);
