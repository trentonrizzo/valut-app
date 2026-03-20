-- Run in SQL Editor if profiles INSERT policy is missing (needed for client upsert).
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);
