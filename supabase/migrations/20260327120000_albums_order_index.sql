-- Manual ordering for album list (dashboard drag-and-drop)
alter table public.albums add column if not exists order_index integer not null default 0;

-- Backfill: preserve previous "newest first" list order per user
update public.albums a
set order_index = sub.rn
from (
  select id, row_number() over (partition by user_id order by created_at desc) - 1 as rn
  from public.albums
) sub
where a.id = sub.id;

create index if not exists albums_user_order_idx on public.albums (user_id, order_index);
