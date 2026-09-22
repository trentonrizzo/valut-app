-- Idempotent visibility repair. Does not delete files, memberships, or R2 objects.
-- For every non-null files.album_id, ensure an album_files row exists.

insert into public.album_files (album_id, file_id, user_id)
select f.album_id, f.id, f.user_id
from public.files f
where f.album_id is not null
on conflict do nothing;
