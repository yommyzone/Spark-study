-- Spark Premium subscription structure
-- Run this in Supabase SQL Editor after the existing schema.

alter table public.profiles
  add column if not exists plan text not null default 'free',
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists paystack_customer_code text;

create table if not exists public.link_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  links_used integer not null default 0,
  unique(user_id, usage_month)
);

alter table public.link_usage enable row level security;
create policy "Users manage own link usage" on public.link_usage for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
