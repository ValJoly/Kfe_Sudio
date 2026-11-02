-- Patterns accept any file (PDF, image, document...), so they get their own bucket without a MIME allow-list.
alter table public.patterns
  drop column if exists image_path,
  add column file_path text,
  add column file_name text,
  add column file_type text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('pattern-files', 'pattern-files', false, 20971520)
on conflict (id) do nothing;

create policy "Members read pattern files"
on storage.objects for select to authenticated
using (
  bucket_id = 'pattern-files'
  and (select public.is_collection_member(((storage.foldername(name))[1])::uuid))
);

create policy "Editors upload pattern files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'pattern-files'
  and (select public.can_manage_collection(((storage.foldername(name))[1])::uuid))
);

create policy "Editors delete pattern files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'pattern-files'
  and (select public.can_manage_collection(((storage.foldername(name))[1])::uuid))
);
