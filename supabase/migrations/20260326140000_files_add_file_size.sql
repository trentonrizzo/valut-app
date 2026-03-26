-- Optional byte size for gallery sorting (new uploads populate this from the client)
alter table public.files add column if not exists file_size_bytes bigint;
