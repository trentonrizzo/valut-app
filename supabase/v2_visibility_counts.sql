-- COUNTS ONLY. Safe to run in the SQL editor. Does not modify rows.
-- Do not select filenames.
-- Requires V2 columns (files.deleted_at). If this errors, apply the V2 migrations first.

select
  (select count(*) from public.files) as total_files,
  (select count(*) from public.files f where coalesce(f.purpose, 'content') = 'content') as content_files,
  (select count(*) from public.files f where f.upload_status = 'ready') as ready_files,
  (select count(*) from public.files f where f.upload_status is null) as legacy_null_status_files,
  (select count(*) from public.files f where f.deleted_at is not null) as deleted_files,
  (select count(*) from public.files f where f.album_id is not null) as files_with_legacy_album_id,
  (select count(*) from public.album_files) as album_files_memberships,
  (select count(*)
     from public.files f
     where f.album_id is not null
       and not exists (
         select 1 from public.album_files af
         where af.album_id = f.album_id and af.file_id = f.id
       )) as legacy_album_id_missing_membership,
  (select count(*)
     from public.album_files af
     where not exists (select 1 from public.files f where f.id = af.file_id)) as album_files_pointing_at_missing_files;
