-- Optional marker so automatic person-name tags can be listed separately.
-- Existing tags, file links, and media rows are unchanged.
alter table public.tags add column if not exists kind text;
comment on column public.tags.kind is 'name for automatic person-name tags. Null for ordinary tags.';
