-- Usuarios y empresas (pedido de Facundo, 16/10): desde el panel se elige a qué empresa
-- pertenece cada usuario, o "Ambas" (multi_empresa). Solo lo cambia un admin con acceso
-- a las dos empresas (TI); el admin de una empresa sigue gestionando solo la suya.

-- ¿Soy admin con acceso a todas las empresas?
create or replace function vis_soy_admin_multi() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vis_vendedores where auth_user_id = auth.uid() and activo and multi_empresa and rol = 'admin')
$$;

-- Quien tiene "Ambas" aparece en la lista de las dos empresas.
alter policy vendedores_select on vis_vendedores
  using (empresa_id = (select vis_mi_empresa()) or multi_empresa or id = (select vis_mi_id()));

-- El admin de todas las empresas edita a cualquiera; el resto, solo los de su empresa.
alter policy vendedores_update on vis_vendedores
  using ((select vis_es_admin()) and (empresa_id = (select vis_mi_empresa()) or (select vis_soy_admin_multi())))
  with check ((select vis_es_admin()) and (empresa_id = (select vis_mi_empresa()) or (select vis_soy_admin_multi())));

-- Empresa de un usuario: una (p_empresa) o ambas (p_ambas, con p_empresa como la de origen).
create or replace function vis_asignar_empresa(p_vendedor uuid, p_empresa uuid, p_ambas boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vis_soy_admin_multi() then
    raise exception 'Solo un admin con acceso a todas las empresas puede cambiar la empresa de un usuario.';
  end if;
  if not exists (select 1 from vis_empresas where id = p_empresa) then raise exception 'Empresa inexistente.'; end if;
  if p_vendedor = vis_mi_id() and not coalesce(p_ambas, false) then
    raise exception 'No podés quitarte el acceso a todas las empresas a vos mismo.';
  end if;
  update vis_vendedores set
    empresa_id = p_empresa,
    multi_empresa = coalesce(p_ambas, false),
    empresa_activa = case when coalesce(p_ambas, false) then empresa_activa end
  where id = p_vendedor;
  if not found then raise exception 'Usuario inexistente.'; end if;
end $$;

revoke execute on function vis_soy_admin_multi(), vis_asignar_empresa(uuid, uuid, boolean) from anon, public;
grant execute on function vis_soy_admin_multi(), vis_asignar_empresa(uuid, uuid, boolean) to authenticated;
