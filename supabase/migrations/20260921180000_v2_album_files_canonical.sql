-- Vault V2 Phase 1: album_files is the canonical membership source.
-- Additive and idempotent. Does not delete files.album_id or any media rows.

alter table public.album_files
  add column if not exists sort_index integer not null default 0;

create index if not exists album_files_album_sort_idx
  on public.album_files (album_id, sort_index, added_at desc);

-- Re-backfill any legacy files.album_id memberships that are missing from album_files.
insert into public.album_files (album_id, file_id, user_id)
select f.album_id, f.id, f.user_id
from public.files f
where f.album_id is not null
on conflict do nothing;

-- Keep album_content_stats content-only and ready-only. Recreate if an older
-- definition omitted upload_status. Never drops memberships.
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
  group by af.album_id;
$$;

grant execute on function public.album_content_stats() to authenticated;
