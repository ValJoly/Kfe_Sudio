alter table public.profiles
  add column language text not null default 'en'
  check (language in ('en', 'fr'));
