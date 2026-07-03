-- Adds a public.profiles table that carries extra user data (name, phone,
-- department, role) beyond what Supabase Auth stores, and keeps it in sync
-- with auth.users automatically via triggers.
--
-- How to apply: paste this whole file into the Supabase Dashboard
-- (Project -> SQL Editor -> New query) and run it once. If you later set up
-- the Supabase CLI, `supabase db push` will pick it up from
-- supabase/migrations/ instead.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  phone text,
  department text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Users may edit their own contact details, but not their department or
-- role (those are org-assigned; change them from the SQL editor or a future
-- admin screen using the service role, which bypasses RLS/grants).
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create or replace function public.touch_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
  before update on public.profiles
  for each row execute function public.touch_profiles_updated_at();

-- Creates a profile row automatically whenever a new user shows up in
-- auth.users (sign-up, invite, or created from the Supabase dashboard).
-- If you set full_name / phone / department / role in the "User Metadata"
-- field when creating the user, those values are copied over too.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone, department, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'department',
    coalesce(new.raw_user_meta_data ->> 'role', 'user')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keeps profiles.email in sync if a user changes their login email.
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function public.handle_auth_user_email_change();

-- Backfill: create profiles for any users that already existed before this
-- migration ran.
insert into public.profiles (id, email)
select u.id, u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
