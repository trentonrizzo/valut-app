-- Additive only: allow idempotent file_tags upserts (ON CONFLICT DO UPDATE).
-- Does not alter existing data. Safe to re-run.

drop policy if exists "file_tags_update_own" on public.file_tags;
create policy "file_tags_update_own"
  on public.file_tags for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.files f where f.id = file_id and f.user_id = auth.uid())
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid())
  );
