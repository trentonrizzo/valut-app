-- Client-side AES-GCM: per-user key + per-file ciphertext flag
alter table public.profiles add column if not exists encryption_key text;

alter table public.files add column if not exists is_encrypted boolean not null default false;

create index if not exists files_is_encrypted_idx on public.files (is_encrypted);
