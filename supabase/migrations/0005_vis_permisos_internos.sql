-- ════════════════════════════════════════════════════════════════════
-- Supabase da EXECUTE por defecto a anon/authenticated sobre toda función
-- nueva en public. Las funciones internas (triggers, cron) no tienen que
-- poder llamarse por la API. A partir de acá, cada migración otorga
-- EXECUTE explícito a lo que la app usa (ver 0002 y 0003).
-- ════════════════════════════════════════════════════════════════════

alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

revoke execute on function
  vis_cerrar_jornadas_olvidadas(),
  vis_posicion_a_actual(),
  vis_parada_en_semana(),
  vis_touch_updated_at()
from anon, authenticated, public;

-- Función del ajuste "Enable automatic RLS" del proyecto (event trigger): no es para la API.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
  end if;
end $$;
