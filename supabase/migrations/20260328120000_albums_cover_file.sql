-- Optional custom album cover (falls back to newest file in album when null)
alter table public.albums add column if not exists cover_file_id uuid references public.files (id) on delete set null;

create index if not exists albums_cover_file_id_idx on public.albums (cover_file_id);
