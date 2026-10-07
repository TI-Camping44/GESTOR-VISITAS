-- ════════════════════════════════════════════════════════════════════
-- Fotos de fachada (Storage). Bucket privado; cada vendedor sube a su
-- carpeta (<vendedor_id>/<client_uuid>.jpg). Supervisor/admin ven todas.
-- ════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vis-fotos', 'vis-fotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy vis_fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vis-fotos' and (storage.foldername(name))[1] = (select public.vis_mi_id())::text);

create policy vis_fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'vis-fotos' and ((select public.vis_es_supervisor()) or (storage.foldername(name))[1] = (select public.vis_mi_id())::text));
