-- Drop-in reservation (2026-09-26): a receptionist (role admin) books a
-- vehicle for a walk-in visitor who has NO FLEETii account. The visitor gets
-- an emailed link to a public page (/gaest#<token>) where they can Lås/Lås op
-- that vehicle during the reservation — see the drop-in plan and
-- netlify/functions/create-drop-in-booking.mts / guest-*.mts.
--
-- Data model:
-- 1. bookings.is_guest — a drop-in booking is an ordinary bookings row with
--    user_id NULL and is_guest = true. No placeholder "Gæst" user: every
--    user_profiles row needs a real auth.users account, and bookings.user_id
--    is already nullable. The flag itself is non-sensitive (every user at the
--    costumer can SELECT bookings) so lists can show "Drop-in" to everyone.
--    The CHECK means a regular user can never create or edit a drop-in
--    booking (their own INSERT/UPDATE policies require user_id = auth.uid()).
-- 2. booking_guests — the visitor's personal data + the access token's
--    SHA-256 hash, one row per drop-in booking. Kept OUT of bookings because
--    every regular user at the costumer can read bookings rows.
--    * SELECT only for sysadm and admins of the vehicle's costumer (same
--      costumer-wide admin scope as user editing). token_hash is excluded from
--      the column grant, so not even they can read it.
--    * No client-side writes at all: rows are created, re-tokened, revoked
--      and anonymised only by service-role Netlify Functions.
--    * The link's validity window is NOT stored: it's computed from the
--      booking's current start/end at request time (start -15 min to
--      end +30 min), so editing or deleting the booking moves or ends access
--      automatically. revoked_at is the only manual kill switch.
--    * anonymized_at: set by the retention job 30 days after the booking's
--      end, which also nulls the personal columns (hence all nullable).
-- 3. guest_access_log — audit trail of every token use (status/lock/unlock/
--    denied) and the per-token rate-limit counter (Netlify Functions share no
--    memory, so the limit counts recent rows here). Service-role only: RLS on
--    with zero policies, all grants revoked — same pattern as
--    costumer_purge_log.
--
-- Both new tables cascade on booking delete, so purge_costumer() (which
-- deletes bookings explicitly) and a normal "Slet reservation" both clean
-- them up with no further changes.
--
-- Run in the Supabase SQL editor (staging first). Safe to re-run.

-- 1. bookings.is_guest -------------------------------------------------------
alter table public.bookings
  add column if not exists is_guest boolean not null default false;

alter table public.bookings drop constraint if exists bookings_guest_has_no_user;
alter table public.bookings
  add constraint bookings_guest_has_no_user check (not is_guest or user_id is null);

-- 2. booking_guests ----------------------------------------------------------
create table if not exists public.booking_guests (
  booking_id uuid primary key references public.bookings (booking_id) on delete cascade,
  name text,
  email text,
  phone text,
  address text,
  license_no text,
  -- "Kørekort og legitimation kontrolleret" — the receptionist's own
  -- confirmation; FLEETii stores no ID/CPR data itself.
  id_checked boolean not null default false,
  token_hash text not null unique,
  revoked_at timestamptz,
  anonymized_at timestamptz,
  created_by uuid references public.user_profiles (user_id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.booking_guests enable row level security;

drop policy if exists "booking_guests_select_admin_own_costumer" on public.booking_guests;
create policy "booking_guests_select_admin_own_costumer" on public.booking_guests
  for select
  to authenticated
  using (
    public.is_sysadm()
    or (
      public.is_admin()
      and exists (
        select 1
        from public.bookings b
        join public.vehicle_profiles vp on vp.vehicle_id = b.vehicle_id
        where b.booking_id = booking_guests.booking_id
          and vp.costumer_id = public.current_costumer_id()
      )
    )
  );

-- Supabase's default privileges grant everything on new public tables to
-- anon/authenticated; strip that and grant back only the readable columns.
revoke all on public.booking_guests from anon, authenticated;
grant select (booking_id, name, email, phone, address, license_no, id_checked,
  revoked_at, anonymized_at, created_by, created_at) on public.booking_guests to authenticated;

-- 3. guest_access_log --------------------------------------------------------
create table if not exists public.guest_access_log (
  guest_access_log_id uuid not null default gen_random_uuid() primary key,
  booking_id uuid not null references public.bookings (booking_id) on delete cascade,
  action text not null check (action in ('status', 'lock', 'unlock', 'denied')),
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists guest_access_log_booking_created_idx
  on public.guest_access_log (booking_id, created_at desc);

alter table public.guest_access_log enable row level security;
revoke all on public.guest_access_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verification (run after applying; each should behave as described):
--
-- a) Columns/constraint exist:
--    select column_name from information_schema.columns
--      where table_name = 'bookings' and column_name = 'is_guest';
--    select conname from pg_constraint where conname = 'bookings_guest_has_no_user';
--
-- b) Grants — authenticated has SELECT on booking_guests' columns except
--    token_hash, and nothing on guest_access_log; anon has nothing on either:
--    select grantee, table_name, privilege_type from information_schema.role_table_grants
--      where table_name in ('booking_guests', 'guest_access_log') and grantee in ('anon', 'authenticated');
--    select grantee, column_name from information_schema.column_privileges
--      where table_name = 'booking_guests' and grantee = 'authenticated' order by column_name;
--
-- b2) bookings is still readable table-wide (if bookings ever got
--    column-level grants instead, is_guest would need its own grant):
--    select grantee, privilege_type from information_schema.role_table_grants
--      where table_name = 'bookings' and grantee = 'authenticated';
--
-- c) A regular user can't read guest data (role impersonation, rolled back):
--    begin;
--    set local role authenticated;
--    set local request.jwt.claims = '{"sub": "<a regular user_id>"}';
--    select count(*) from public.booking_guests;   -- expect 0
--    select count(*) from public.guest_access_log; -- expect permission denied
--    rollback;
