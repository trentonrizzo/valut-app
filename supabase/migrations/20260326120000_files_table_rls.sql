-- Files metadata table for uploaded media
-- This migration is required for the R2 upload flow to work end-to-end.

create extension if not exists "pgcrypto";

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  album_id uuid not null references public.albums (id) on delete cascade,
  file_name text not null,
  file_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists files_user_id_idx on public.files (user_id);
create index if not exists files_album_id_idx on public.files (album_id);

alter table public.files enable row level security;

drop policy if exists "files_select_own" on public.files;
create policy "files_select_own"
  on public.files for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.albums a
      where a.id = files.album_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "files_insert_own" on public.files;
create policy "files_insert_own"
  on public.files for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.albums a
      where a.id = files.album_id and a.user_id = auth.uid()
    )
  );

