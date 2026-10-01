-- Monthly usage ledger for Free and Premium plans.
-- Run after subscription-schema.sql and usage-limits-schema.sql.

create table if not exists public.usage_monthly (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  file_imports_used integer not null default 0,
  link_imports_used integer not null default 0,
  ai_generations_used integer not null default 0,
  unique(user_id, usage_month)
);

alter table public.usage_monthly enable row level security;
create policy "Users view own usage" on public.usage_monthly for select using (auth.uid() = user_id);
create policy "Users create own usage" on public.usage_monthly for insert with check (auth.uid() = user_id);
create policy "Users update own usage" on public.usage_monthly for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.enforce_material_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_plan text;
  current_status text;
  expiry timestamptz;
  active_count integer;
  monthly_imports integer;
  limit_active integer;
  limit_monthly integer;
  month_start date := date_trunc('month', now())::date;
begin
  select plan, subscription_status, subscription_expires_at into current_plan, current_status, expiry
  from public.profiles where id = auth.uid();
  if coalesce(current_plan, 'free') = 'premium' and coalesce(current_status, 'inactive') = 'active' and (expiry is null or expiry > now()) then
    limit_active := 100; limit_monthly := 100;
  else
    limit_active := 10; limit_monthly := 10;
  end if;
  select count(*) into active_count from public.materials where user_id = auth.uid();
  if active_count >= limit_active then raise exception 'Material limit reached'; end if;
  select coalesce(file_imports_used, 0) into monthly_imports from public.usage_monthly where user_id = auth.uid() and usage_month = month_start;
  if monthly_imports >= limit_monthly then raise exception 'Monthly file import limit reached'; end if;
  insert into public.usage_monthly(user_id, usage_month, file_imports_used) values (auth.uid(), month_start, 1)
  on conflict (user_id, usage_month) do update set file_imports_used = public.usage_monthly.file_imports_used + 1;
  return new;
end;
$$;

drop trigger if exists enforce_material_limit_before_insert on public.materials;
create trigger enforce_material_limit_before_insert before insert on public.materials
for each row execute function public.enforce_material_limit();
