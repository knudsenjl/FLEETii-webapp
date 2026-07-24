-- Guarantees every admin (role = 'admin') always has a user_departments
-- grant for their own costumer's "Alle køretøjer" department — so it always
-- shows up in "Skift afdeling" (PageHeader.tsx) for admins specifically,
-- never for role "user" (a deliberate restriction, unlike the vehicle side
-- of this — see backfill_and_assign_vehicles_to_alle_koretojer.sql, where
-- EVERY vehicle gets it regardless of who manages it).
--
-- Two parts:
--
-- 1. One-time backfill for every existing admin, via user_profiles'
--    own costumer_id column directly (no need to infer it from existing
--    grants like the vehicle version had to — user_profiles has this
--    already, vehicle_profiles doesn't).
--
-- 2. A trigger on user_profiles itself (not user_departments) that fires on
--    every INSERT and on every UPDATE of role — this covers a brand-new
--    admin created via create-user.mts (which never touches
--    user_departments at all today) AND a "user" promoted to "admin" via
--    update-user.mts, without needing either Netlify Function to change.
--
-- SECURITY DEFINER (same pattern as the other auto-grant triggers this
-- session) so this works regardless of the inserting/updating caller's own
-- user_departments RLS.
--
-- Safe to re-run: backfill's ON CONFLICT DO NOTHING is idempotent, function
-- is CREATE OR REPLACE, trigger dropped before recreated.

-- 1. Backfill.
insert into public.user_departments (user_id, department_id)
select up.user_id, alle.department_id
from public.user_profiles up
join public.departments alle on alle.costumer_id = up.costumer_id and alle.name = 'Alle køretøjer'
where up.role = 'admin'
on conflict (user_id, department_id) do nothing;

-- 2. Trigger for future admins (new or promoted).
create or replace function public.grant_alle_koretojer_to_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  alle_id uuid;
begin
  if new.role <> 'admin' or new.costumer_id is null then
    return new;
  end if;

  select department_id into alle_id
  from public.departments
  where costumer_id = new.costumer_id
    and name = 'Alle køretøjer';

  if alle_id is not null then
    insert into public.user_departments (user_id, department_id)
    values (new.user_id, alle_id)
    on conflict (user_id, department_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists user_profiles_grant_alle_koretojer on public.user_profiles;
create trigger user_profiles_grant_alle_koretojer
  after insert or update of role on public.user_profiles
  for each row
  execute function public.grant_alle_koretojer_to_admin();
