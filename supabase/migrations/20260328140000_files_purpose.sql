-- Distinguish gallery content from dedicated album cover assets (cover rows excluded from stats/grid).
alter table public.files add column if not exists purpose text not null default 'content';

alter table public.files drop constraint if exists files_purpose_check;

alter table public.files
  add constraint files_purpose_check check (purpose in ('content', 'cover'));

update public.files set purpose = 'content' where purpose is null;
