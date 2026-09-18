-- Additional indexes for library filters. Listing is done via PostgREST + file_ids_with_all_tags.

create index if not exists files_user_width_height_idx
  on public.files (user_id, width, height);

create index if not exists album_files_user_album_idx
  on public.album_files (user_id, album_id, added_at desc);
