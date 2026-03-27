-- Original MIME type for display and metadata (client sends File.type)
alter table public.files add column if not exists mime_type text;
