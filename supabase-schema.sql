-- Spark Study database schema
-- Run this in Supabase Dashboard -> SQL Editor -> New query.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_initials text,
  created_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default 'green',
  created_at timestamptz not null default now()
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  score integer not null default 0,
  total_questions integer not null default 0,
  duration_seconds integer not null default 0,
  completed_at timestamptz not null default now()
);

create table if not exists public.study_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  topic text not null,
  mastery integer not null default 0 check (mastery between 0 and 100),
  questions_answered integer not null default 0,
  questions_correct integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(user_id, subject_id, topic)
);

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_progress enable row level security;

create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

create policy "Users manage own subjects" on public.subjects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own sessions" on public.study_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own progress" on public.study_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_initials)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    upper(left(coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 2))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

insert into public.subjects (user_id, name, color)
select id, 'Biology', 'green' from auth.users
where not exists (select 1 from public.subjects s where s.user_id = auth.users.id and s.name = 'Biology');
