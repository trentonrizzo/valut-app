-- Capture-date provenance + complete saved-link lifecycle. ADDITIVE and idempotent.
alter table public.files add column if not exists captured_at_local text;
alter table public.files add column if not exists captured_at_offset text;
alter table public.files add column if not exists captured_at_source text;
comment on column public.files.captured_at is 'Exact original capture instant when timezone/offset is known; distinct from created_at (Vault upload/import).';
comment on column public.files.captured_at_local is 'Original local wall-clock timestamp when embedded metadata omits timezone. Never interpreted as upload time.';
comment on column public.files.captured_at_offset is 'Embedded UTC offset such as -05:00 when available.';
comment on column public.files.captured_at_source is 'exif_datetime_original, exif_create_date, quicktime_day, quicktime_mvhd, file_last_modified, or user_entered.';

alter table public.vault_links add column if not exists deleted_at timestamptz;
alter table public.vault_links add column if not exists membership_snapshot jsonb not null default '[]'::jsonb;
alter table public.vault_links add column if not exists locked boolean not null default false;
alter table public.vault_links add column if not exists rating smallint;
create index if not exists vault_links_user_visible_idx on public.vault_links (user_id, deleted_at, created_at desc);
create index if not exists vault_links_user_favorite_idx on public.vault_links (user_id, favorite, created_at desc);

-- Tighten ownership on existing link join tables; existing rows are untouched.
drop policy if exists album_links_select_own on public.album_links;
create policy album_links_select_own on public.album_links for select to authenticated
  using (auth.uid() = user_id and exists (select 1 from public.albums a where a.id = album_id and a.user_id = auth.uid()) and exists (select 1 from public.vault_links l where l.id = link_id and l.user_id = auth.uid()));
drop policy if exists album_links_insert_own on public.album_links;
create policy album_links_insert_own on public.album_links for insert to authenticated
  with check (auth.uid() = user_id and exists (select 1 from public.albums a where a.id = album_id and a.user_id = auth.uid()) and exists (select 1 from public.vault_links l where l.id = link_id and l.user_id = auth.uid()));
drop policy if exists album_links_delete_own on public.album_links;
create policy album_links_delete_own on public.album_links for delete to authenticated
  using (auth.uid() = user_id and exists (select 1 from public.albums a where a.id = album_id and a.user_id = auth.uid()) and exists (select 1 from public.vault_links l where l.id = link_id and l.user_id = auth.uid()));

drop policy if exists link_tags_select_own on public.link_tags;
create policy link_tags_select_own on public.link_tags for select to authenticated
  using (auth.uid() = user_id and exists (select 1 from public.vault_links l where l.id = link_id and l.user_id = auth.uid()) and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid()));
drop policy if exists link_tags_insert_own on public.link_tags;
create policy link_tags_insert_own on public.link_tags for insert to authenticated
  with check (auth.uid() = user_id and exists (select 1 from public.vault_links l where l.id = link_id and l.user_id = auth.uid()) and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid()));
drop policy if exists link_tags_delete_own on public.link_tags;
create policy link_tags_delete_own on public.link_tags for delete to authenticated
  using (auth.uid() = user_id and exists (select 1 from public.vault_links l where l.id = link_id and l.user_id = auth.uid()) and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid()));

-- Album item counts include visible saved links; byte totals remain physical media bytes.
create or replace function public.album_content_stats()
returns table (album_id uuid, item_count bigint, total_bytes bigint, photo_items bigint, photo_bytes bigint, video_items bigint, video_bytes bigint)
language sql stable security invoker set search_path = public as $$
  with media as (
    select af.album_id, count(*)::bigint item_count,
      coalesce(sum(coalesce(f.stored_size_bytes, f.file_size_bytes, 0)), 0)::bigint total_bytes,
      count(*) filter (where coalesce(f.mime_type, '') like 'image/%' or lower(f.file_name) ~ '\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$')::bigint photo_items,
      coalesce(sum(coalesce(f.stored_size_bytes, f.file_size_bytes, 0)) filter (where coalesce(f.mime_type, '') like 'image/%' or lower(f.file_name) ~ '\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$'), 0)::bigint photo_bytes,
      count(*) filter (where coalesce(f.mime_type, '') like 'video/%' or lower(f.file_name) ~ '\.(mp4|mov|m4v|webm|mkv|avi)$')::bigint video_items,
      coalesce(sum(coalesce(f.stored_size_bytes, f.file_size_bytes, 0)) filter (where coalesce(f.mime_type, '') like 'video/%' or lower(f.file_name) ~ '\.(mp4|mov|m4v|webm|mkv|avi)$'), 0)::bigint video_bytes
    from public.album_files af join public.files f on f.id = af.file_id
    where af.user_id = auth.uid() and f.user_id = auth.uid() and f.purpose = 'content'
      and coalesce(f.upload_status, 'ready') = 'ready' and f.deleted_at is null group by af.album_id
  ), links as (
    select al.album_id, count(*)::bigint item_count
    from public.album_links al join public.vault_links l on l.id = al.link_id
    where al.user_id = auth.uid() and l.user_id = auth.uid() and l.deleted_at is null group by al.album_id
  )
  select coalesce(m.album_id, l.album_id), coalesce(m.item_count, 0) + coalesce(l.item_count, 0),
    coalesce(m.total_bytes, 0), coalesce(m.photo_items, 0), coalesce(m.photo_bytes, 0),
    coalesce(m.video_items, 0), coalesce(m.video_bytes, 0)
  from media m full outer join links l on l.album_id = m.album_id;
$$;
grant execute on function public.album_content_stats() to authenticated;
