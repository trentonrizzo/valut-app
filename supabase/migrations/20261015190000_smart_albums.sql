-- Smart albums point at a tag. They do not copy media or change memberships.
alter table public.albums add column if not exists smart_tag_id uuid references public.tags (id) on delete set null;
create index if not exists albums_smart_tag_idx on public.albums (smart_tag_id);

-- One original instant for sorting: a manual correction, otherwise the stored capture.
-- Filesystem-modified timestamps stay out of this value.
alter table public.files add column if not exists original_at timestamptz
  generated always as (
    case
      when captured_at_user is not null then captured_at_user
      when captured_at_source = 'file_last_modified' then null
      else captured_at
    end
  ) stored;
