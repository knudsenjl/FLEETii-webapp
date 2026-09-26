-- Drop-in reservation retention (2026-09-26, user decision): a drop-in
-- guest's personal data is anonymised 30 days after their booking's end.
-- Called once a day by netlify/functions/anonymize-drop-in-guests.mts (a
-- Netlify scheduled function — this project has no pg_cron), via the
-- service-role client.
--
-- Anonymising means:
--   * booking_guests: name/email/phone/address/license_no set to NULL and
--     anonymized_at stamped — which also kills the guest link for good
--     (evaluateGuestAccess treats anonymised as revoked). id_checked,
--     created_by and created_at stay: they say nothing about the guest.
--   * guest_access_log: the ip column (personal data too) is nulled for the
--     same bookings; the action/timestamp audit trail itself stays.
-- The booking row is untouched — it's the fleet's own history and holds no
-- guest data (user_id is NULL for a drop-in).
--
-- A booking without an end can't be a drop-in (create-drop-in-booking.mts
-- requires Slut), so it's simply never selected here.
--
-- Run in the Supabase SQL editor (staging first). Safe to re-run.

create or replace function public.anonymize_expired_drop_in_guests()
returns integer
language plpgsql
set search_path = public
as $$
declare
  affected integer;
begin
  with expired as (
    select g.booking_id
    from public.booking_guests g
    join public.bookings b on b.booking_id = g.booking_id
    where g.anonymized_at is null
      and b."end" is not null
      and b."end" < now() - interval '30 days'
  ), anonymized as (
    update public.booking_guests g
    set name = null,
        email = null,
        phone = null,
        address = null,
        license_no = null,
        anonymized_at = now()
    from expired e
    where g.booking_id = e.booking_id
    returning g.booking_id
  ), scrubbed as (
    update public.guest_access_log l
    set ip = null
    from anonymized a
    where l.booking_id = a.booking_id
      and l.ip is not null
    returning 1
  )
  select count(*) into affected from anonymized;
  -- `scrubbed` is a data-modifying CTE: Postgres always runs it to
  -- completion even though nothing reads it.
  return affected;
end;
$$;

-- Service role only — no logged-in user may trigger (or even call) this.
revoke all on function public.anonymize_expired_drop_in_guests() from public, anon, authenticated;
grant execute on function public.anonymize_expired_drop_in_guests() to service_role;

-- ---------------------------------------------------------------------------
-- Verification (run after applying):
--   select has_function_privilege('authenticated', 'public.anonymize_expired_drop_in_guests()', 'execute'); -- false
--   select has_function_privilege('service_role', 'public.anonymize_expired_drop_in_guests()', 'execute');  -- true
--   select public.anonymize_expired_drop_in_guests(); -- number of guests anonymised (0 when nothing is due)
