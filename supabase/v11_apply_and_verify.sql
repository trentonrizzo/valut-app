-- Vault V1.1 ONE-SHOT apply + verify
-- Paste this entire file into Supabase SQL Editor and Run.
-- Additive only. Rolls back if profiles/albums/files/items counts decrease.
-- Does not delete, truncate, or rewrite existing media objects.

BEGIN;

CREATE TEMP TABLE _v11_before AS
SELECT * FROM (
  SELECT 'profiles'::text AS entity, count(*)::bigint AS n FROM public.profiles
  UNION ALL SELECT 'albums', count(*) FROM public.albums
  UNION ALL SELECT 'files', count(*) FROM public.files
  UNION ALL SELECT 'items', count(*) FROM public.items
  UNION ALL SELECT 'files_with_album_id', count(*) FROM public.files WHERE album_id IS NOT NULL
  UNION ALL SELECT 'files_with_https_url', count(*) FROM public.files WHERE file_url ~* '^https?://'
) s;

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
-- Recreate FK only when missing or still ON DELETE CASCADE. Does not rewrite rows.
do $$
declare
  def text;
begin
  select pg_get_constraintdef(oid) into def
  from pg_constraint
  where conname = 'files_album_id_fkey' and conrelid = 'public.files'::regclass;

  if def is null or def !~* 'on delete set null' then
    if def is not null then
      alter table public.files drop constraint files_album_id_fkey;
    end if;
    alter table public.files
      add constraint files_album_id_fkey
      foreign key (album_id) references public.albums (id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- files RLS: own rows regardless of album membership (Library / zero-album).
-- No DELETE policy — V1.1 does not permanently delete originals.
-- ---------------------------------------------------------------------------
drop policy if exists "files_select_own" on public.files;
create policy "files_select_own"
  on public.files for select
  using (auth.uid() = user_id);

drop policy if exists "files_insert_own" on public.files;
create policy "files_insert_own"
  on public.files for insert
  with check (
    auth.uid() = user_id
    and (
      album_id is null
      or exists (select 1 from public.albums a where a.id = album_id and a.user_id = auth.uid())
    )
  );

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


-- Additional indexes for library filters. Listing is done via PostgREST + file_ids_with_all_tags.

create index if not exists files_user_width_height_idx
  on public.files (user_id, width, height);

create index if not exists album_files_user_album_idx
  on public.album_files (user_id, album_id, added_at desc);


-- Per-album counts without loading every file row into the client.
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
    and f.purpose = 'content'
    and f.upload_status = 'ready'
  group by af.album_id;
$$;

grant execute on function public.album_content_stats() to authenticated;


DO $$
DECLARE
  b_profiles bigint; a_profiles bigint;
  b_albums bigint; a_albums bigint;
  b_files bigint; a_files bigint;
  b_items bigint; a_items bigint;
  fk_def text;
  backfill_gap bigint;
BEGIN
  SELECT n INTO b_profiles FROM _v11_before WHERE entity = 'profiles';
  SELECT n INTO b_albums FROM _v11_before WHERE entity = 'albums';
  SELECT n INTO b_files FROM _v11_before WHERE entity = 'files';
  SELECT n INTO b_items FROM _v11_before WHERE entity = 'items';
  SELECT count(*) INTO a_profiles FROM public.profiles;
  SELECT count(*) INTO a_albums FROM public.albums;
  SELECT count(*) INTO a_files FROM public.files;
  SELECT count(*) INTO a_items FROM public.items;

  IF a_profiles < b_profiles THEN
    RAISE EXCEPTION 'profiles count decreased: % -> %', b_profiles, a_profiles;
  END IF;
  IF a_albums < b_albums THEN
    RAISE EXCEPTION 'albums count decreased: % -> %', b_albums, a_albums;
  END IF;
  IF a_files < b_files THEN
    RAISE EXCEPTION 'files count decreased: % -> %', b_files, a_files;
  END IF;
  IF a_items < b_items THEN
    RAISE EXCEPTION 'items count decreased: % -> %', b_items, a_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'storage_key'
  ) THEN
    RAISE EXCEPTION 'files.storage_key missing';
  END IF;

  IF to_regclass('public.album_files') IS NULL THEN RAISE EXCEPTION 'album_files missing'; END IF;
  IF to_regclass('public.tags') IS NULL THEN RAISE EXCEPTION 'tags missing'; END IF;
  IF to_regclass('public.file_tags') IS NULL THEN RAISE EXCEPTION 'file_tags missing'; END IF;
  IF to_regclass('public.storage_orphans') IS NULL THEN RAISE EXCEPTION 'storage_orphans missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'favorite'
  ) THEN
    RAISE EXCEPTION 'files.favorite missing';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO fk_def
  FROM pg_constraint
  WHERE conname = 'files_album_id_fkey' AND conrelid = 'public.files'::regclass;
  IF fk_def IS NULL OR fk_def !~* 'on delete set null' THEN
    RAISE EXCEPTION 'files_album_id_fkey is not ON DELETE SET NULL: %', fk_def;
  END IF;

  SELECT count(*) INTO backfill_gap
  FROM public.files f
  WHERE f.album_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.album_files af
      WHERE af.file_id = f.id AND af.album_id = f.album_id
    );
  IF backfill_gap <> 0 THEN
    RAISE EXCEPTION 'album_files backfill incomplete, gap=%', backfill_gap;
  END IF;
END $$;

SELECT b.entity,
       b.n AS before_count,
       CASE b.entity
         WHEN 'profiles' THEN (SELECT count(*) FROM public.profiles)
         WHEN 'albums' THEN (SELECT count(*) FROM public.albums)
         WHEN 'files' THEN (SELECT count(*) FROM public.files)
         WHEN 'items' THEN (SELECT count(*) FROM public.items)
         WHEN 'files_with_album_id' THEN (SELECT count(*) FROM public.files WHERE album_id IS NOT NULL)
         WHEN 'files_with_https_url' THEN (SELECT count(*) FROM public.files WHERE file_url ~* '^https?://')
       END AS after_count,
       pg_get_constraintdef((
         SELECT oid FROM pg_constraint
         WHERE conname = 'files_album_id_fkey' AND conrelid = 'public.files'::regclass
       )) AS files_album_id_fkey
FROM _v11_before b
ORDER BY b.entity;

COMMIT;
