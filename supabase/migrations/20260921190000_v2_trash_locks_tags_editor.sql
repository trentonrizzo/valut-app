-- Vault V2 additive: trash, locks, album protection, album tags, editor projects.
-- Does not drop tables, truncate, or rewrite R2 keys.

alter table public.files add column if not exists deleted_at timestamptz;
alter table public.files add column if not exists membership_snapshot jsonb not null default '[]'::jsonb;
alter table public.files add column if not exists locked boolean not null default false;
alter table public.files add column if not exists stored_size_bytes bigint;
alter table public.files add column if not exists storage_integrity text not null default 'ready';

alter table public.files drop constraint if exists files_storage_integrity_check;
alter table public.files
  add constraint files_storage_integrity_check
  check (storage_integrity in ('ready', 'missing', 'problem'));

create index if not exists files_user_deleted_idx
  on public.files (user_id, deleted_at desc)
  where deleted_at is not null;

alter table public.albums add column if not exists is_protected boolean not null default false;

-- Owner may delete own file rows (used only after successful permanent R2 delete).
drop policy if exists "files_delete_own" on public.files;
create policy "files_delete_own"
  on public.files for delete
  using (auth.uid() = user_id);

create table if not exists public.album_tags (
  album_id uuid not null references public.albums (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (album_id, tag_id)
);

create index if not exists album_tags_user_tag_idx on public.album_tags (user_id, tag_id);
alter table public.album_tags enable row level security;
drop policy if exists "album_tags_select_own" on public.album_tags;
create policy "album_tags_select_own" on public.album_tags for select using (auth.uid() = user_id);
drop policy if exists "album_tags_insert_own" on public.album_tags;
create policy "album_tags_insert_own"
  on public.album_tags for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.albums a where a.id = album_id and a.user_id = auth.uid())
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid())
  );
drop policy if exists "album_tags_delete_own" on public.album_tags;
create policy "album_tags_delete_own" on public.album_tags for delete using (auth.uid() = user_id);

create table if not exists public.album_secrets (
  album_id uuid primary key references public.albums (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.album_secrets enable row level security;

create table if not exists public.vault_secrets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.vault_secrets enable row level security;

create table if not exists public.editor_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'Untitled',
  kind text not null default 'collage',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists editor_projects_user_idx on public.editor_projects (user_id, updated_at desc);
alter table public.editor_projects enable row level security;
drop policy if exists "editor_projects_own" on public.editor_projects;
create policy "editor_projects_select_own" on public.editor_projects for select using (auth.uid() = user_id);
create policy "editor_projects_insert_own" on public.editor_projects for insert with check (auth.uid() = user_id);
create policy "editor_projects_update_own" on public.editor_projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "editor_projects_delete_own" on public.editor_projects for delete using (auth.uid() = user_id);

create or replace function public.album_content_stats()
returns table (album_id uuid, item_count bigint, total_bytes bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select af.album_id,
         count(*)::bigint as item_count,
         coalesce(sum(f.file_size_bytes), 0)::bigint as total_bytes
  from public.album_files af
  join public.files f on f.id = af.file_id
  where af.user_id = auth.uid()
    and coalesce(f.purpose, 'content') = 'content'
    and coalesce(f.upload_status, 'ready') = 'ready'
    and f.deleted_at is null
  group by af.album_id;
$$;

grant execute on function public.album_content_stats() to authenticated;

create or replace function public.set_album_password(p_album_id uuid, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_password is null or length(btrim(p_password)) < 4 then
    raise exception 'password too short';
  end if;
  if not exists (select 1 from public.albums a where a.id = p_album_id and a.user_id = auth.uid()) then
    raise exception 'album not found';
  end if;
  insert into public.album_secrets (album_id, user_id, password_hash, updated_at)
  values (p_album_id, auth.uid(), crypt(p_password, gen_salt('bf', 10)), now())
  on conflict (album_id) do update
    set password_hash = excluded.password_hash,
        updated_at = now()
    where public.album_secrets.user_id = auth.uid();
  update public.albums set is_protected = true where id = p_album_id and user_id = auth.uid();
  return true;
end;
$$;

create or replace function public.verify_album_password(p_album_id uuid, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
begin
  if auth.uid() is null then
    return false;
  end if;
  select s.password_hash into stored
  from public.album_secrets s
  where s.album_id = p_album_id and s.user_id = auth.uid();
  if stored is null then
    return false;
  end if;
  return crypt(p_password, stored) = stored;
end;
$$;

create or replace function public.clear_album_password(p_album_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.album_secrets where album_id = p_album_id and user_id = auth.uid();
  update public.albums set is_protected = false where id = p_album_id and user_id = auth.uid();
  return true;
end;
$$;

create or replace function public.set_vault_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_pin is null or length(btrim(p_pin)) < 4 then
    raise exception 'PIN too short';
  end if;
  insert into public.vault_secrets (user_id, pin_hash, updated_at)
  values (auth.uid(), crypt(p_pin, gen_salt('bf', 10)), now())
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, updated_at = now();
  return true;
end;
$$;

create or replace function public.verify_vault_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
begin
  if auth.uid() is null then
    return false;
  end if;
  select v.pin_hash into stored from public.vault_secrets v where v.user_id = auth.uid();
  if stored is null then
    return false;
  end if;
  return crypt(p_pin, stored) = stored;
end;
$$;

create or replace function public.vault_pin_is_set()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.vault_secrets v where v.user_id = auth.uid());
$$;

create or replace function public.clear_vault_pin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.vault_secrets where user_id = auth.uid();
  return true;
end;
$$;

grant execute on function public.set_album_password(uuid, text) to authenticated;
grant execute on function public.verify_album_password(uuid, text) to authenticated;
grant execute on function public.clear_album_password(uuid) to authenticated;
grant execute on function public.set_vault_pin(text) to authenticated;
grant execute on function public.verify_vault_pin(text) to authenticated;
grant execute on function public.vault_pin_is_set() to authenticated;
grant execute on function public.clear_vault_pin() to authenticated;

create or replace function public.album_ids_with_all_tags(p_tag_ids uuid[])
returns table (album_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select at.album_id
  from public.album_tags at
  where at.user_id = auth.uid()
    and at.tag_id = any (p_tag_ids)
  group by at.album_id
  having count(distinct at.tag_id) = coalesce(cardinality(p_tag_ids), 0);
$$;

grant execute on function public.album_ids_with_all_tags(uuid[]) to authenticated;
