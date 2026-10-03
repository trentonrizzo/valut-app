-- Provider-derived link metadata. ADDITIVE ONLY; URLs and existing titles are untouched.
alter table public.vault_links add column if not exists provider text;
alter table public.vault_links add column if not exists automatic_title text;
alter table public.vault_links add column if not exists provider_created_at timestamptz;
alter table public.vault_links add column if not exists metadata_status text;
alter table public.vault_links add column if not exists metadata_updated_at timestamptz;

comment on column public.vault_links.title is 'User-entered title. When present it always wins over automatic_title.';
comment on column public.vault_links.automatic_title is 'Provider-derived title; never overwrites the user-entered title.';
comment on column public.vault_links.provider_created_at is 'Trustworthy provider resource creation time only; never the Vault import time.';
comment on column public.vault_links.metadata_status is 'pending, resolved, unavailable, or failed.';

create index if not exists vault_links_user_metadata_status_idx
  on public.vault_links (user_id, metadata_status, created_at);
