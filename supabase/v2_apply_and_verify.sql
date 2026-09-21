-- Manual apply helper for Vault V2 additive migrations.
-- Review, then run in the Supabase SQL editor. Does not drop media.

BEGIN;

\i supabase/migrations/20260921180000_v2_album_files_canonical.sql
\i supabase/migrations/20260921190000_v2_trash_locks_tags_editor.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'deleted_at'
  ) THEN
    RAISE EXCEPTION 'V2 files.deleted_at missing';
  END IF;
END $$;

COMMIT;
