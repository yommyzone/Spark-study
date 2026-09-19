-- Spark Study Library setup
-- Run this once in Supabase SQL Editor after supabase-schema.sql.

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

alter table public.materials enable row level security;
create policy "Users manage own materials" on public.materials for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('study-materials', 'study-materials', false)
on conflict (id) do nothing;

create policy "Users upload own study materials" on storage.objects
for insert to authenticated
with check (bucket_id = 'study-materials' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "Users read own study materials" on storage.objects
for select to authenticated
using (bucket_id = 'study-materials' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "Users delete own study materials" on storage.objects
for delete to authenticated
using (bucket_id = 'study-materials' and (storage.foldername(name))[1] = (select auth.uid()::text));
