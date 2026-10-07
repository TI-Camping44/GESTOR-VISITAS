-- ════════════════════════════════════════════════════════════════════
-- Tareas programadas en la base (pg_cron).
--   · Cierre de jornadas olvidadas: cada 15 min (cierra las que pasaron las 20:00).
--   · Retención: el 1.º de cada mes borra posiciones de más de 90 días
--     (el resumen de cada jornada queda en vis_jornadas).
-- El sync con Odoo NO va acá: lo corre Vercel Cron (/api/cron/sync).
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule('vis_cerrar_jornadas', '*/15 * * * *', $$select public.vis_cerrar_jornadas_olvidadas()$$);
select cron.schedule('vis_retencion_posiciones', '0 7 1 * *',
  $$delete from public.vis_posiciones where fecha_hora < now() - interval '90 days'$$);
