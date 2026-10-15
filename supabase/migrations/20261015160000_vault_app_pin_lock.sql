-- Additive application PIN lock. Does not delete files, albums, memberships, or encryption keys.

alter table public.vault_secrets
  add column if not exists fail_count integer not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists breakin_enabled boolean not null default false;

create table if not exists public.vault_unlock_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists vault_unlock_sessions_user_idx
  on public.vault_unlock_sessions (user_id, expires_at desc);
alter table public.vault_unlock_sessions enable row level security;

create table if not exists public.vault_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.vault_recovery_codes enable row level security;

create table if not exists public.vault_pin_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  capture_status text not null default 'unavailable',
  user_agent text,
  image_base64 text
);
create index if not exists vault_pin_attempts_user_idx
  on public.vault_pin_attempts (user_id, created_at desc);
alter table public.vault_pin_attempts enable row level security;

alter table public.files add column if not exists captured_at_user timestamptz;
alter table public.files add column if not exists captured_at_confidence text;

create or replace function public.vault_private_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.vault_unlock_sessions s
    where s.user_id = auth.uid()
      and s.revoked_at is null
      and s.expires_at > now()
  );
$$;

create or replace function public.vault_lock_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  has_pin boolean;
  until_at timestamptz;
  breakin boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('authenticated', false);
  end if;
  select true, s.locked_until, s.breakin_enabled
    into has_pin, until_at, breakin
  from public.vault_secrets s
  where s.user_id = auth.uid();
  return jsonb_build_object(
    'authenticated', true,
    'pin_set', coalesce(has_pin, false),
    'server_enforced', true,
    'retry_at', until_at,
    'breakin_enabled', coalesce(breakin, false),
    'unlocked', public.vault_private_access()
  );
end;
$$;

create or replace function public.vault_create_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  codes text[] := array[]::text[];
  i int;
  raw text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{1,6}$' then
    raise exception 'invalid pin';
  end if;
  if exists (select 1 from public.vault_secrets s where s.user_id = auth.uid()) then
    raise exception 'pin already set';
  end if;
  insert into public.vault_secrets (user_id, pin_hash, updated_at)
  values (auth.uid(), crypt(p_pin, gen_salt('bf', 10)), now());
  for i in 1..8 loop
    raw := encode(gen_random_bytes(9), 'hex');
    insert into public.vault_recovery_codes (user_id, code_hash)
    values (auth.uid(), crypt(raw, gen_salt('bf', 8)));
    codes := codes || raw;
  end loop;
  return jsonb_build_object('ok', true, 'recovery_codes', to_jsonb(codes));
end;
$$;

create or replace function public.vault_unlock_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
  fails int;
  until_at timestamptz;
  wait_for interval;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  select s.pin_hash, s.fail_count, s.locked_until
    into stored, fails, until_at
  from public.vault_secrets s
  where s.user_id = auth.uid();
  if stored is null then
    return jsonb_build_object('ok', false, 'error', 'setup_required');
  end if;
  if until_at is not null and until_at > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'retry_at', until_at);
  end if;
  if p_pin is null or crypt(p_pin, stored) <> stored then
    fails := coalesce(fails, 0) + 1;
    wait_for := case
      when fails >= 10 then interval '2 hours'
      when fails >= 8 then interval '30 minutes'
      when fails >= 5 then interval '5 minutes'
      when fails >= 3 then interval '30 seconds'
      else interval '0 seconds'
    end;
    update public.vault_secrets
      set fail_count = fails,
          locked_until = case when wait_for > interval '0 seconds' then now() + wait_for else null end,
          updated_at = now()
      where user_id = auth.uid();
    insert into public.vault_pin_attempts (user_id, capture_status)
    values (auth.uid(), 'unavailable');
    return jsonb_build_object('ok', false, 'error', 'locked', 'retry_at', case when wait_for > interval '0 seconds' then now() + wait_for else null end);
  end if;
  update public.vault_secrets
    set fail_count = 0, locked_until = null, updated_at = now()
    where user_id = auth.uid();
  insert into public.vault_unlock_sessions (user_id, expires_at)
  values (auth.uid(), now() + interval '12 hours');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.vault_lock_now()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  update public.vault_unlock_sessions
    set revoked_at = now()
    where user_id = auth.uid() and revoked_at is null;
  return true;
end;
$$;

create or replace function public.vault_change_pin(p_current text, p_next text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_next is null or p_next !~ '^[0-9]{1,6}$' then
    raise exception 'invalid pin';
  end if;
  select s.pin_hash into stored from public.vault_secrets s where s.user_id = auth.uid();
  if stored is null or p_current is null or crypt(p_current, stored) <> stored then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  update public.vault_secrets
    set pin_hash = crypt(p_next, gen_salt('bf', 10)),
        fail_count = 0,
        locked_until = null,
        updated_at = now()
    where user_id = auth.uid();
  perform public.vault_lock_now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.vault_recover_pin(p_code text, p_next text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  match_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_next is null or p_next !~ '^[0-9]{1,6}$' then
    raise exception 'invalid pin';
  end if;
  select c.id into match_id
  from public.vault_recovery_codes c
  where c.user_id = auth.uid()
    and c.used_at is null
    and crypt(p_code, c.code_hash) = c.code_hash
  limit 1;
  if match_id is null then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  update public.vault_recovery_codes set used_at = now() where id = match_id;
  update public.vault_secrets
    set pin_hash = crypt(p_next, gen_salt('bf', 10)),
        fail_count = 0,
        locked_until = null,
        updated_at = now()
    where user_id = auth.uid();
  perform public.vault_lock_now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.vault_set_breakin(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  update public.vault_secrets set breakin_enabled = coalesce(p_enabled, false) where user_id = auth.uid();
  return true;
end;
$$;

create or replace function public.vault_record_breakin(p_status text, p_user_agent text, p_image text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  img text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  img := left(coalesce(p_image, ''), 160000);
  if length(img) = 0 then
    img := null;
  end if;
  insert into public.vault_pin_attempts (user_id, capture_status, user_agent, image_base64)
  values (auth.uid(), coalesce(nullif(p_status, ''), 'unavailable'), left(coalesce(p_user_agent, ''), 300), img)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.vault_breakin_history()
returns table (id uuid, created_at timestamptz, capture_status text, user_agent text, image_base64 text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.created_at, a.capture_status, a.user_agent, a.image_base64
  from public.vault_pin_attempts a
  where a.user_id = auth.uid()
    and public.vault_private_access()
  order by a.created_at desc
  limit 50;
$$;

create or replace function public.vault_delete_breakin(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.vault_pin_attempts
  where id = p_id and user_id = auth.uid() and public.vault_private_access();
  return true;
end;
$$;

-- Account login alone must not clear the application PIN.
create or replace function public.clear_vault_pin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'current pin required';
end;
$$;

-- First-time setup only. Does not overwrite an existing PIN or encryption keys.
create or replace function public.set_vault_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.vault_secrets s where s.user_id = auth.uid()) then
    raise exception 'pin already set';
  end if;
  perform public.vault_create_pin(p_pin);
  return true;
end;
$$;

-- Replace permissive policies. Multiple SELECT policies are OR'd, so old ones must go.
do $$
declare r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('files', 'albums', 'album_files', 'tags', 'file_tags', 'album_tags', 'editor_projects', 'vault_links')
      and cmd = 'SELECT'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

drop policy if exists "files_select_own" on public.files;
create policy "files_select_own" on public.files for select
  using (auth.uid() = user_id and public.vault_private_access());
drop policy if exists "files_update_own" on public.files;
create policy "files_update_own" on public.files for update
  using (auth.uid() = user_id and public.vault_private_access())
  with check (auth.uid() = user_id and public.vault_private_access());
drop policy if exists "files_insert_own" on public.files;
create policy "files_insert_own" on public.files for insert
  with check (auth.uid() = user_id and public.vault_private_access());
drop policy if exists "files_delete_own" on public.files;
create policy "files_delete_own" on public.files for delete
  using (auth.uid() = user_id and public.vault_private_access());

drop policy if exists "albums_select_own" on public.albums;
create policy "albums_select_own" on public.albums for select
  using (auth.uid() = user_id and public.vault_private_access());
drop policy if exists "albums_update_own" on public.albums;
create policy "albums_update_own" on public.albums for update
  using (auth.uid() = user_id and public.vault_private_access())
  with check (auth.uid() = user_id and public.vault_private_access());
drop policy if exists "albums_insert_own" on public.albums;
create policy "albums_insert_own" on public.albums for insert
  with check (auth.uid() = user_id and public.vault_private_access());
drop policy if exists "albums_delete_own" on public.albums;
create policy "albums_delete_own" on public.albums for delete
  using (auth.uid() = user_id and public.vault_private_access());

drop policy if exists "album_files_select_own" on public.album_files;
create policy "album_files_select_own" on public.album_files for select
  using (auth.uid() = user_id and public.vault_private_access());

drop policy if exists "tags_select_own" on public.tags;
create policy "tags_select_own" on public.tags for select
  using (auth.uid() = user_id and public.vault_private_access());
drop policy if exists "file_tags_select_own" on public.file_tags;
create policy "file_tags_select_own" on public.file_tags for select
  using (auth.uid() = user_id and public.vault_private_access());
drop policy if exists "editor_projects_select_own" on public.editor_projects;
create policy "editor_projects_select_own" on public.editor_projects for select
  using (auth.uid() = user_id and public.vault_private_access());

do $$
begin
  if to_regclass('public.album_tags') is not null then
    execute 'drop policy if exists album_tags_select_own on public.album_tags';
    execute 'create policy album_tags_select_own on public.album_tags for select using (auth.uid() = user_id and public.vault_private_access())';
  end if;
end $$;

do $$
begin
  if to_regclass('public.vault_links') is not null then
    execute 'drop policy if exists vault_links_select_own on public.vault_links';
    execute 'create policy vault_links_select_own on public.vault_links for select using (auth.uid() = user_id and public.vault_private_access())';
  end if;
end $$;

grant execute on function public.vault_private_access() to authenticated;
grant execute on function public.vault_lock_status() to authenticated;
grant execute on function public.vault_create_pin(text) to authenticated;
grant execute on function public.vault_unlock_pin(text) to authenticated;
grant execute on function public.vault_lock_now() to authenticated;
grant execute on function public.vault_change_pin(text, text) to authenticated;
grant execute on function public.vault_recover_pin(text, text) to authenticated;
grant execute on function public.vault_set_breakin(boolean) to authenticated;
grant execute on function public.vault_record_breakin(text, text, text) to authenticated;
grant execute on function public.vault_breakin_history() to authenticated;
grant execute on function public.vault_delete_breakin(uuid) to authenticated;
