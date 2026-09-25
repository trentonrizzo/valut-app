-- Vault major pass — ADDITIVE ONLY. Never drops columns/tables or rewrites media.
-- Safe to re-run where CREATE IF NOT EXISTS / OR REPLACE is used.

-- Optional descriptive / provenance fields (NULL for all legacy rows).
alter table public.files add column if not exists original_filename text;
alter table public.files add column if not exists source_url text;
alter table public.files add column if not exists description text;
alter table public.files add column if not exists content_hash text;
alter table public.files add column if not exists hash_algo text;
alter table public.files add column if not exists hash_status text;

comment on column public.files.original_filename is 'Filename at import time; may differ from display file_name.';
comment on column public.files.source_url is 'Optional external source URL/domain when known; never fabricated.';
comment on column public.files.description is 'User or AI description; optional.';
comment on column public.files.content_hash is 'Cryptographic content hash when computed; NULL until indexed.';
comment on column public.files.hash_algo is 'e.g. sha256';
comment on column public.files.hash_status is 'pending | ready | failed | skipped';

create index if not exists files_user_content_hash_idx
  on public.files (user_id, content_hash)
  where content_hash is not null and deleted_at is null;

create index if not exists files_user_captured_at_idx
  on public.files (user_id, captured_at desc nulls last)
  where deleted_at is null and purpose = 'content';

-- Cached AI / visual analysis (additive).
create table if not exists public.media_analysis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  analysis_version text not null default '1',
  provider text,
  model text,
  status text not null default 'pending',
  description text,
  attributes_json jsonb not null default '{}'::jsonb,
  people_count integer,
  sample_info_json jsonb not null default '{}'::jsonb,
  embedding_ref text,
  confidence real,
  error text,
  content_hash_at_analysis text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (file_id, analysis_version, provider)
);

create index if not exists media_analysis_user_file_idx on public.media_analysis (user_id, file_id);
create index if not exists media_analysis_user_status_idx on public.media_analysis (user_id, status);

alter table public.media_analysis enable row level security;

drop policy if exists media_analysis_select_own on public.media_analysis;
create policy media_analysis_select_own on public.media_analysis
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists media_analysis_insert_own on public.media_analysis;
create policy media_analysis_insert_own on public.media_analysis
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists media_analysis_update_own on public.media_analysis;
create policy media_analysis_update_own on public.media_analysis
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists media_analysis_delete_own on public.media_analysis;
create policy media_analysis_delete_own on public.media_analysis
  for delete to authenticated using (auth.uid() = user_id);

-- Neutral person groups (Person 1 / Person 2…) — foundation only.
create table if not exists public.person_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null,
  sort_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists person_groups_user_idx on public.person_groups (user_id, sort_index);

create table if not exists public.person_group_media (
  person_group_id uuid not null references public.person_groups (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  confidence real,
  created_at timestamptz not null default now(),
  primary key (person_group_id, file_id)
);

create index if not exists person_group_media_user_file_idx on public.person_group_media (user_id, file_id);

alter table public.person_groups enable row level security;
alter table public.person_group_media enable row level security;

drop policy if exists person_groups_all_own on public.person_groups;
create policy person_groups_all_own on public.person_groups
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists person_group_media_all_own on public.person_group_media;
create policy person_group_media_all_own on public.person_group_media
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Tag counts (efficient).
create or replace function public.tag_file_counts()
returns table (tag_id uuid, file_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select ft.tag_id, count(*)::bigint as file_count
  from public.file_tags ft
  join public.files f on f.id = ft.file_id
  where ft.user_id = auth.uid()
    and f.user_id = auth.uid()
    and f.deleted_at is null
    and f.purpose = 'content'
    and coalesce(f.upload_status, 'ready') = 'ready'
  group by ft.tag_id;
$$;

grant execute on function public.tag_file_counts() to authenticated;

-- Whole-vault storage stats (physical rows; each file counted once).
create or replace function public.vault_storage_stats()
returns table (
  total_items bigint,
  total_bytes bigint,
  photo_items bigint,
  photo_bytes bigint,
  video_items bigint,
  video_bytes bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint as total_items,
    coalesce(sum(coalesce(f.stored_size_bytes, f.file_size_bytes, 0)), 0)::bigint as total_bytes,
    count(*) filter (where coalesce(f.mime_type, '') like 'image/%' or lower(f.file_name) ~ '\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$')::bigint as photo_items,
    coalesce(sum(coalesce(f.stored_size_bytes, f.file_size_bytes, 0)) filter (where coalesce(f.mime_type, '') like 'image/%' or lower(f.file_name) ~ '\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$'), 0)::bigint as photo_bytes,
    count(*) filter (where coalesce(f.mime_type, '') like 'video/%' or lower(f.file_name) ~ '\.(mp4|mov|m4v|webm|mkv|avi)$')::bigint as video_items,
    coalesce(sum(coalesce(f.stored_size_bytes, f.file_size_bytes, 0)) filter (where coalesce(f.mime_type, '') like 'video/%' or lower(f.file_name) ~ '\.(mp4|mov|m4v|webm|mkv|avi)$'), 0)::bigint as video_bytes
  from public.files f
  where f.user_id = auth.uid()
    and f.deleted_at is null
    and f.purpose = 'content'
    and coalesce(f.upload_status, 'ready') = 'ready';
$$;

grant execute on function public.vault_storage_stats() to authenticated;

-- Per-album referenced size (membership; same physical file can appear in multiple albums).
-- Must drop first when OUT columns change (function only — no table/data impact).
drop function if exists public.album_content_stats();
create or replace function public.album_content_stats()
returns table (
  album_id uuid,
  item_count bigint,
  total_bytes bigint,
  photo_items bigint,
  photo_bytes bigint,
  video_items bigint,
  video_bytes bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select af.album_id,
         count(*)::bigint as item_count,
         coalesce(sum(coalesce(f.stored_size_bytes, f.file_size_bytes, 0)), 0)::bigint as total_bytes,
         count(*) filter (where coalesce(f.mime_type, '') like 'image/%' or lower(f.file_name) ~ '\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$')::bigint as photo_items,
         coalesce(sum(coalesce(f.stored_size_bytes, f.file_size_bytes, 0)) filter (where coalesce(f.mime_type, '') like 'image/%' or lower(f.file_name) ~ '\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$'), 0)::bigint as photo_bytes,
         count(*) filter (where coalesce(f.mime_type, '') like 'video/%' or lower(f.file_name) ~ '\.(mp4|mov|m4v|webm|mkv|avi)$')::bigint as video_items,
         coalesce(sum(coalesce(f.stored_size_bytes, f.file_size_bytes, 0)) filter (where coalesce(f.mime_type, '') like 'video/%' or lower(f.file_name) ~ '\.(mp4|mov|m4v|webm|mkv|avi)$'), 0)::bigint as video_bytes
  from public.album_files af
  join public.files f on f.id = af.file_id
  where af.user_id = auth.uid()
    and f.user_id = auth.uid()
    and f.purpose = 'content'
    and coalesce(f.upload_status, 'ready') = 'ready'
    and f.deleted_at is null
  group by af.album_id;
$$;

grant execute on function public.album_content_stats() to authenticated;

-- Duplicate groups by exact content_hash (informational only).
create or replace function public.duplicate_content_groups()
returns table (content_hash text, file_count bigint, total_bytes bigint, file_ids uuid[])
language sql
stable
security invoker
set search_path = public
as $$
  select f.content_hash,
         count(*)::bigint as file_count,
         coalesce(sum(coalesce(f.stored_size_bytes, f.file_size_bytes, 0)), 0)::bigint as total_bytes,
         array_agg(f.id order by f.created_at) as file_ids
  from public.files f
  where f.user_id = auth.uid()
    and f.deleted_at is null
    and f.purpose = 'content'
    and coalesce(f.upload_status, 'ready') = 'ready'
    and f.content_hash is not null
    and length(f.content_hash) > 8
  group by f.content_hash
  having count(*) > 1
  order by count(*) desc, max(f.created_at) desc;
$$;

grant execute on function public.duplicate_content_groups() to authenticated;
