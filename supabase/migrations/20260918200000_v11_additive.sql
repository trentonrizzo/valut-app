-- Vault V1.1 additive, backwards-compatible schema.
-- DOES NOT drop tables, truncate, or delete existing media rows/objects.
-- Album deletion will no longer cascade-delete files (membership only).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- files: extra columns (legacy file_url / album_id retained)
-- ---------------------------------------------------------------------------
alter table public.files add column if not exists storage_key text;
alter table public.files add column if not exists storage_provider text not null default 'r2';
alter table public.files add column if not exists upload_status text not null default 'ready';
alter table public.files add column if not exists checksum text;
alter table public.files add column if not exists width integer;
alter table public.files add column if not exists height integer;
alter table public.files add column if not exists duration_ms integer;
alter table public.files add column if not exists captured_at timestamptz;
alter table public.files add column if not exists favorite boolean not null default false;
alter table public.files add column if not exists rating smallint;
alter table public.files add column if not exists thumbnail_key text;
alter table public.files add column if not exists poster_key text;
alter table public.files add column if not exists encryption_version integer not null default 0;
alter table public.files add column if not exists wrapped_dek text;
alter table public.files add column if not exists encryption_chunk_size integer;
alter table public.files add column if not exists metadata_json jsonb not null default '{}'::jsonb;

alter table public.files drop constraint if exists files_upload_status_check;
alter table public.files
  add constraint files_upload_status_check
  check (upload_status in ('uploading', 'ready', 'failed'));

alter table public.files drop constraint if exists files_rating_check;
alter table public.files
  add constraint files_rating_check
  check (rating is null or (rating >= 1 and rating <= 5));

alter table public.files drop constraint if exists files_encryption_version_check;
alter table public.files
  add constraint files_encryption_version_check
  check (encryption_version >= 0);

create unique index if not exists files_storage_key_uidx
  on public.files (storage_key)
  where storage_key is not null;

create index if not exists files_user_created_idx
  on public.files (user_id, created_at desc, id desc);

create index if not exists files_user_captured_idx
  on public.files (user_id, captured_at desc nulls last, id desc);

create index if not exists files_user_size_idx
  on public.files (user_id, file_size_bytes desc nulls last);

create index if not exists files_user_duration_idx
  on public.files (user_id, duration_ms desc nulls last);

create index if not exists files_user_favorite_idx
  on public.files (user_id, favorite, created_at desc);

create index if not exists files_user_rating_idx
  on public.files (user_id, rating desc nulls last);

create index if not exists files_user_purpose_status_idx
  on public.files (user_id, purpose, upload_status);

create index if not exists files_user_mime_idx
  on public.files (user_id, mime_type);

create index if not exists files_filename_trgm_idx
  on public.files (user_id, file_name);

-- Allow library items with zero albums. Existing rows keep album_id.
alter table public.files alter column album_id drop not null;

-- CRITICAL: deleting an album must NOT delete original file rows.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'files_album_id_fkey' and conrelid = 'public.files'::regclass
  ) then
    alter table public.files drop constraint files_album_id_fkey;
  end if;
end $$;

alter table public.files
  add constraint files_album_id_fkey
  foreign key (album_id) references public.albums (id) on delete set null;

-- ---------------------------------------------------------------------------
-- files RLS: add UPDATE (no DELETE policy — V1.1 does not permanently delete originals)
-- ---------------------------------------------------------------------------
drop policy if exists "files_update_own" on public.files;
create policy "files_update_own"
  on public.files for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- album_files (many-to-many membership; album delete removes membership only)
-- ---------------------------------------------------------------------------
create table if not exists public.album_files (
  album_id uuid not null references public.albums (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (album_id, file_id)
);

create index if not exists album_files_user_idx on public.album_files (user_id);
create index if not exists album_files_file_idx on public.album_files (file_id);
create index if not exists album_files_album_added_idx on public.album_files (album_id, added_at desc);

alter table public.album_files enable row level security;

drop policy if exists "album_files_select_own" on public.album_files;
create policy "album_files_select_own"
  on public.album_files for select
  using (auth.uid() = user_id);

drop policy if exists "album_files_insert_own" on public.album_files;
create policy "album_files_insert_own"
  on public.album_files for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.albums a where a.id = album_id and a.user_id = auth.uid())
    and exists (select 1 from public.files f where f.id = file_id and f.user_id = auth.uid())
  );

drop policy if exists "album_files_delete_own" on public.album_files;
create policy "album_files_delete_own"
  on public.album_files for delete
  using (auth.uid() = user_id);

-- Backfill membership from legacy files.album_id. Does not modify files rows.
insert into public.album_files (album_id, file_id, user_id)
select f.album_id, f.id, f.user_id
from public.files f
where f.album_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  name_normalized text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name_normalized)
);

create index if not exists tags_user_name_idx on public.tags (user_id, name_normalized);

alter table public.tags enable row level security;

drop policy if exists "tags_select_own" on public.tags;
create policy "tags_select_own" on public.tags for select using (auth.uid() = user_id);
drop policy if exists "tags_insert_own" on public.tags;
create policy "tags_insert_own" on public.tags for insert with check (auth.uid() = user_id);
drop policy if exists "tags_update_own" on public.tags;
create policy "tags_update_own" on public.tags for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "tags_delete_own" on public.tags;
create policy "tags_delete_own" on public.tags for delete using (auth.uid() = user_id);

create table if not exists public.file_tags (
  file_id uuid not null references public.files (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (file_id, tag_id)
);

create index if not exists file_tags_user_tag_idx on public.file_tags (user_id, tag_id);
create index if not exists file_tags_file_idx on public.file_tags (file_id);

alter table public.file_tags enable row level security;

drop policy if exists "file_tags_select_own" on public.file_tags;
create policy "file_tags_select_own" on public.file_tags for select using (auth.uid() = user_id);
drop policy if exists "file_tags_insert_own" on public.file_tags;
create policy "file_tags_insert_own"
  on public.file_tags for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.files f where f.id = file_id and f.user_id = auth.uid())
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid())
  );
drop policy if exists "file_tags_delete_own" on public.file_tags;
create policy "file_tags_delete_own" on public.file_tags for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- storage orphans (R2 succeeded, metadata insert failed). Never auto-deleted.
-- ---------------------------------------------------------------------------
create table if not exists public.storage_orphans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_key text not null,
  original_name text,
  file_size_bytes bigint,
  upload_id text,
  error text,
  created_at timestamptz not null default now(),
  reconciled boolean not null default false
);

create index if not exists storage_orphans_user_idx on public.storage_orphans (user_id, created_at desc);

alter table public.storage_orphans enable row level security;

drop policy if exists "storage_orphans_select_own" on public.storage_orphans;
create policy "storage_orphans_select_own"
  on public.storage_orphans for select using (auth.uid() = user_id);
drop policy if exists "storage_orphans_insert_own" on public.storage_orphans;
create policy "storage_orphans_insert_own"
  on public.storage_orphans for insert with check (auth.uid() = user_id);
drop policy if exists "storage_orphans_update_own" on public.storage_orphans;
create policy "storage_orphans_update_own"
  on public.storage_orphans for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- vault wrapping metadata (NOT the raw master key; do not use encryption_key)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists vault_wrap_salt text;
alter table public.profiles add column if not exists vault_wrapped_master_key text;
alter table public.profiles add column if not exists vault_key_created_at timestamptz;

-- ---------------------------------------------------------------------------
-- RPC: files that contain ALL given tags (AND)
-- ---------------------------------------------------------------------------
create or replace function public.file_ids_with_all_tags(p_tag_ids uuid[])
returns table (file_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select ft.file_id
  from public.file_tags ft
  where ft.user_id = auth.uid()
    and ft.tag_id = any (p_tag_ids)
  group by ft.file_id
  having count(distinct ft.tag_id) = cardinality(p_tag_ids);
$$;

grant execute on function public.file_ids_with_all_tags(uuid[]) to authenticated;
