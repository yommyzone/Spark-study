-- Enforce the free 10-material limit at the database layer.
-- Run after subscription-schema.sql.

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
  material_count integer;
begin
  select plan, subscription_status, subscription_expires_at
    into current_plan, current_status, expiry
    from public.profiles
   where id = auth.uid();

  if coalesce(current_plan, 'free') <> 'premium'
     or coalesce(current_status, 'inactive') <> 'active'
     or (expiry is not null and expiry <= now()) then
    select count(*) into material_count from public.materials where user_id = auth.uid();
    if material_count >= 10 then
      raise exception 'Free plan limit reached: 10 active materials';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_material_limit_before_insert on public.materials;
create trigger enforce_material_limit_before_insert
before insert on public.materials
for each row execute function public.enforce_material_limit();
