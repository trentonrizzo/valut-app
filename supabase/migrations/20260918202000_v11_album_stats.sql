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
