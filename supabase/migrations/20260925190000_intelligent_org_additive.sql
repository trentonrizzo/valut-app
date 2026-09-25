-- Vault intelligent organization pass — ADDITIVE ONLY.
-- Never drops media columns/tables. Safe re-run where IF NOT EXISTS / OR REPLACE.

-- Nested collections (parent album). Existing albums stay roots (parent null).
alter table public.albums add column if not exists parent_album_id uuid references public.albums (id) on delete set null;

create index if not exists albums_user_parent_idx
  on public.albums (user_id, parent_album_id, order_index);

comment on column public.albums.parent_album_id is 'Optional parent collection for nesting. NULL = root. Cycles prevented in app.';

-- First-class links / URLs (not R2 media).
create table if not exists public.vault_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  url text not null,
  domain text,
  title text,
  notes text,
  preview_image_url text,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  imported_at timestamptz not null default now()
);

create index if not exists vault_links_user_idx on public.vault_links (user_id, created_at desc);
create index if not exists vault_links_user_domain_idx on public.vault_links (user_id, domain);

alter table public.vault_links enable row level security;

drop policy if exists vault_links_select_own on public.vault_links;
create policy vault_links_select_own on public.vault_links
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists vault_links_insert_own on public.vault_links;
create policy vault_links_insert_own on public.vault_links
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists vault_links_update_own on public.vault_links;
create policy vault_links_update_own on public.vault_links
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists vault_links_delete_own on public.vault_links;
create policy vault_links_delete_own on public.vault_links
  for delete to authenticated using (auth.uid() = user_id);

-- Link ↔ album membership (same pattern as album_files; no media duplication).
create table if not exists public.album_links (
  album_id uuid not null references public.albums (id) on delete cascade,
  link_id uuid not null references public.vault_links (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (album_id, link_id)
);

create index if not exists album_links_user_idx on public.album_links (user_id, link_id);

alter table public.album_links enable row level security;

drop policy if exists album_links_select_own on public.album_links;
create policy album_links_select_own on public.album_links
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists album_links_insert_own on public.album_links;
create policy album_links_insert_own on public.album_links
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists album_links_delete_own on public.album_links;
create policy album_links_delete_own on public.album_links
  for delete to authenticated using (auth.uid() = user_id);

-- Link ↔ related media.
create table if not exists public.link_files (
  link_id uuid not null references public.vault_links (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (link_id, file_id)
);

alter table public.link_files enable row level security;

drop policy if exists link_files_select_own on public.link_files;
create policy link_files_select_own on public.link_files
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists link_files_insert_own on public.link_files;
create policy link_files_insert_own on public.link_files
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists link_files_delete_own on public.link_files;
create policy link_files_delete_own on public.link_files
  for delete to authenticated using (auth.uid() = user_id);

-- Link tags (reuse tags table).
create table if not exists public.link_tags (
  link_id uuid not null references public.vault_links (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (link_id, tag_id)
);

alter table public.link_tags enable row level security;

drop policy if exists link_tags_select_own on public.link_tags;
create policy link_tags_select_own on public.link_tags
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists link_tags_insert_own on public.link_tags;
create policy link_tags_insert_own on public.link_tags
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists link_tags_delete_own on public.link_tags;
create policy link_tags_delete_own on public.link_tags
  for delete to authenticated using (auth.uid() = user_id);

-- Durable AI / organization jobs (resumable; not browser-timer based).
create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  request_text text not null,
  objective_json jsonb not null default '{}'::jsonb,
  scope_json jsonb not null default '{}'::jsonb,
  plan_json jsonb not null default '[]'::jsonb,
  status text not null default 'QUEUED',
  current_phase text not null default 'queued',
  progress_total integer not null default 0,
  progress_completed integer not null default 0,
  error_count integer not null default 0,
  retry_count integer not null default 0,
  result_summary text,
  verification_json jsonb not null default '{}'::jsonb,
  usage_json jsonb not null default '{}'::jsonb,
  cursor_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_jobs_user_status_idx on public.ai_jobs (user_id, status, updated_at desc);

alter table public.ai_jobs enable row level security;

drop policy if exists ai_jobs_select_own on public.ai_jobs;
create policy ai_jobs_select_own on public.ai_jobs
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists ai_jobs_insert_own on public.ai_jobs;
create policy ai_jobs_insert_own on public.ai_jobs
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists ai_jobs_update_own on public.ai_jobs;
create policy ai_jobs_update_own on public.ai_jobs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.ai_job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_jobs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  step_key text not null,
  label text not null,
  status text not null default 'pending',
  sort_index integer not null default 0,
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, step_key)
);

alter table public.ai_job_steps enable row level security;

drop policy if exists ai_job_steps_select_own on public.ai_job_steps;
create policy ai_job_steps_select_own on public.ai_job_steps
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists ai_job_steps_insert_own on public.ai_job_steps;
create policy ai_job_steps_insert_own on public.ai_job_steps
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists ai_job_steps_update_own on public.ai_job_steps;
create policy ai_job_steps_update_own on public.ai_job_steps
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.ai_job_events (
  id bigserial primary key,
  job_id uuid not null references public.ai_jobs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'info',
  message text not null,
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_job_events_job_idx on public.ai_job_events (job_id, id);

alter table public.ai_job_events enable row level security;

drop policy if exists ai_job_events_select_own on public.ai_job_events;
create policy ai_job_events_select_own on public.ai_job_events
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists ai_job_events_insert_own on public.ai_job_events;
create policy ai_job_events_insert_own on public.ai_job_events
  for insert to authenticated with check (auth.uid() = user_id);

create table if not exists public.ai_job_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_jobs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  result_kind text not null default 'file_ids',
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ai_job_results enable row level security;

drop policy if exists ai_job_results_select_own on public.ai_job_results;
create policy ai_job_results_select_own on public.ai_job_results
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists ai_job_results_insert_own on public.ai_job_results;
create policy ai_job_results_insert_own on public.ai_job_results
  for insert to authenticated with check (auth.uid() = user_id);

-- Dynamic smart-result bookmarks (optional persistence of last query title/filters).
create table if not exists public.smart_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  query_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.smart_results enable row level security;

drop policy if exists smart_results_select_own on public.smart_results;
create policy smart_results_select_own on public.smart_results
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists smart_results_insert_own on public.smart_results;
create policy smart_results_insert_own on public.smart_results
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists smart_results_delete_own on public.smart_results;
create policy smart_results_delete_own on public.smart_results
  for delete to authenticated using (auth.uid() = user_id);
