alter table public.fabrics add column image_path text;
alter table public.patterns add column image_path text;

-- Private bucket; objects live under "<collection_id>/<file>" so access follows collection membership.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-images', 'item-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Members read item images"
on storage.objects for select to authenticated
using (
  bucket_id = 'item-images'
  and (select public.is_collection_member(((storage.foldername(name))[1])::uuid))
);

create policy "Editors upload item images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'item-images'
  and (select public.can_manage_collection(((storage.foldername(name))[1])::uuid))
);

create policy "Editors delete item images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'item-images'
  and (select public.can_manage_collection(((storage.foldername(name))[1])::uuid))
);
