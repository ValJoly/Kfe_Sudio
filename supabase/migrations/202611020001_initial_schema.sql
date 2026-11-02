create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  preferred_unit text not null default 'metres'
    check (preferred_unit in ('metres', 'yards')),
  created_at timestamptz not null default now()
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.collection_members (
  collection_id uuid not null references public.collections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (collection_id, user_id)
);

create table public.fabrics (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  category text,
  color text,
  quantity numeric(10, 2) not null check (quantity >= 0),
  quantity_unit text not null check (quantity_unit in ('metres', 'yards')),
  notes text,
  created_at timestamptz not null default now(),
  unique (id, collection_id)
);

create table public.patterns (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  brand text,
  pattern_type text,
  size_notes text,
  notes text,
  created_at timestamptz not null default now(),
  unique (id, collection_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  pattern_id uuid,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed', 'paused')),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (pattern_id, collection_id)
    references public.patterns (id, collection_id) on delete set null (pattern_id),
  unique (id, collection_id)
);

create table public.project_fabrics (
  project_id uuid not null,
  fabric_id uuid not null,
  collection_id uuid not null,
  planned_quantity numeric(10, 2) not null check (planned_quantity > 0),
  quantity_unit text not null check (quantity_unit in ('metres', 'yards')),
  created_at timestamptz not null default now(),
  primary key (project_id, fabric_id),
  foreign key (project_id, collection_id)
    references public.projects (id, collection_id) on delete cascade,
  foreign key (fabric_id, collection_id)
    references public.fabrics (id, collection_id) on delete cascade
);

create index fabrics_collection_id_idx on public.fabrics (collection_id);
create index patterns_collection_id_idx on public.patterns (collection_id);
create index projects_collection_id_idx on public.projects (collection_id);
create index collection_members_user_id_idx on public.collection_members (user_id);

create function public.is_collection_member(target_collection uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.collection_members
    where collection_id = target_collection
      and user_id = (select auth.uid())
  );
$$;

create function public.can_manage_collection(target_collection uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.collection_members
    where collection_id = target_collection
      and user_id = (select auth.uid())
      and role in ('owner', 'editor')
  );
$$;

create function public.is_collection_owner(target_collection uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.collection_members
    where collection_id = target_collection
      and user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

create function public.add_collection_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.collection_members (collection_id, user_id, role, added_by)
  values (new.id, new.created_by, 'owner', new.created_by);
  return new;
end;
$$;

create trigger collections_add_creator
after insert on public.collections
for each row execute function public.add_collection_creator();

create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_user_created_profile
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

create function public.share_collection_by_email(p_collection_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited_user_id uuid;
begin
  if auth.uid() is null or not public.is_collection_owner(p_collection_id) then
    raise exception 'Only a collection owner can invite members';
  end if;

  select id into invited_user_id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if invited_user_id is null then
    raise exception 'No account exists for that email address yet';
  end if;

  insert into public.collection_members as current_member (collection_id, user_id, role, added_by)
  values (p_collection_id, invited_user_id, 'editor', auth.uid())
  on conflict (collection_id, user_id) do update
    set role = case
      when current_member.role = 'owner' then 'owner'
      else 'editor'
    end;
end;
$$;

alter table public.profiles enable row level security;
alter table public.collections enable row level security;
alter table public.collection_members enable row level security;
alter table public.fabrics enable row level security;
alter table public.patterns enable row level security;
alter table public.projects enable row level security;
alter table public.project_fabrics enable row level security;

create policy "Users read their own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy "Users update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Members read collections"
on public.collections for select to authenticated
using ((select public.is_collection_member(id)));
create policy "Users create collections"
on public.collections for insert to authenticated
with check ((select auth.uid()) = created_by);
create policy "Editors update collections"
on public.collections for update to authenticated
using ((select public.can_manage_collection(id)))
with check ((select public.can_manage_collection(id)));
create policy "Owners delete collections"
on public.collections for delete to authenticated
using ((select public.is_collection_owner(id)));

create policy "Members read collection members"
on public.collection_members for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_collection_member(collection_id))
);

create policy "Members read fabrics"
on public.fabrics for select to authenticated
using ((select public.is_collection_member(collection_id)));
create policy "Editors manage fabrics"
on public.fabrics for all to authenticated
using ((select public.can_manage_collection(collection_id)))
with check ((select public.can_manage_collection(collection_id)));

create policy "Members read patterns"
on public.patterns for select to authenticated
using ((select public.is_collection_member(collection_id)));
create policy "Editors manage patterns"
on public.patterns for all to authenticated
using ((select public.can_manage_collection(collection_id)))
with check ((select public.can_manage_collection(collection_id)));

create policy "Members read projects"
on public.projects for select to authenticated
using ((select public.is_collection_member(collection_id)));
create policy "Editors manage projects"
on public.projects for all to authenticated
using ((select public.can_manage_collection(collection_id)))
with check ((select public.can_manage_collection(collection_id)));

create policy "Members read planned fabrics"
on public.project_fabrics for select to authenticated
using ((select public.is_collection_member(collection_id)));
create policy "Editors manage planned fabrics"
on public.project_fabrics for all to authenticated
using ((select public.can_manage_collection(collection_id)))
with check ((select public.can_manage_collection(collection_id)));

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.collections to authenticated;
grant select on public.collection_members to authenticated;
grant select, insert, update, delete on public.fabrics to authenticated;
grant select, insert, update, delete on public.patterns to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_fabrics to authenticated;

revoke all on function public.is_collection_member(uuid) from public;
revoke all on function public.can_manage_collection(uuid) from public;
revoke all on function public.is_collection_owner(uuid) from public;
revoke all on function public.add_collection_creator() from public;
revoke all on function public.create_profile_for_new_user() from public;
revoke all on function public.share_collection_by_email(uuid, text) from public;
grant execute on function public.is_collection_member(uuid) to authenticated;
grant execute on function public.can_manage_collection(uuid) to authenticated;
grant execute on function public.is_collection_owner(uuid) to authenticated;
grant execute on function public.share_collection_by_email(uuid, text) to authenticated;
