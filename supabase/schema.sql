-- Vault App: tables, RLS, and profile auto-creation on signup.
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query).

-- Extensions
create extension if not exists "pgcrypto";

-- Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- Albums
create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  order_index integer not null default 0
);

create index if not exists albums_user_id_idx on public.albums (user_id);
create index if not exists albums_user_order_idx on public.albums (user_id, order_index);

-- Items (for future uploads)
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums (id) on delete cascade,
  type text not null,
  url text not null,
  created_at timestamptz not null default now()
);

create index if not exists items_album_id_idx on public.items (album_id);

-- Auto-create profile when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.albums enable row level security;
alter table public.items enable row level security;

-- Profiles: users can read/update only their row
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Allow authenticated users to insert their own profile row (client-side upsert after signup/login)
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Albums: CRUD for own rows
create policy "albums_select_own"
  on public.albums for select
  using (auth.uid() = user_id);

create policy "albums_insert_own"
  on public.albums for insert
  with check (auth.uid() = user_id);

create policy "albums_update_own"
  on public.albums for update
  using (auth.uid() = user_id);

create policy "albums_delete_own"
  on public.albums for delete
  using (auth.uid() = user_id);

-- Items: access only through albums owned by the user
create policy "items_select_own_albums"
  on public.items for select
  using (
    exists (
      select 1 from public.albums a
      where a.id = items.album_id and a.user_id = auth.uid()
    )
  );

create policy "items_insert_own_albums"
  on public.items for insert
  with check (
    exists (
      select 1 from public.albums a
      where a.id = album_id and a.user_id = auth.uid()
    )
  );

create policy "items_update_own_albums"
  on public.items for update
  using (
    exists (
      select 1 from public.albums a
      where a.id = items.album_id and a.user_id = auth.uid()
    )
  );

create policy "items_delete_own_albums"
  on public.items for delete
  using (
    exists (
      select 1 from public.albums a
      where a.id = items.album_id and a.user_id = auth.uid()
    )
  );
