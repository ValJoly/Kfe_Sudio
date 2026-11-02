-- INSERT ... RETURNING checks the SELECT policy before the membership trigger's row is visible,
-- so creators must be able to read the collections they just created.
drop policy "Members read collections" on public.collections;

create policy "Members and creators read collections"
on public.collections for select to authenticated
using (
  created_by = (select auth.uid())
  or (select public.is_collection_member(id))
);
