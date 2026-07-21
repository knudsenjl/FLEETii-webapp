-- Removes two legacy policies discovered via a security audit (2026-07-21)
-- while verifying the department_id migration: "Users can update own
-- profile" and "Users can view own profile", both scoped to {public} (not
-- just {authenticated}) — predate this repo's tracked rls_policies.sql,
-- origin unknown (likely a Supabase project template default).
--
-- Currently harmless in practice:
--   - anon: auth.uid() is always NULL for an unauthenticated request, so
--     auth.uid() = user_id can never be true — zero rows ever match,
--     regardless of anon's base grants (see below).
--   - authenticated: has no base UPDATE grant on user_profiles at all
--     (confirmed via information_schema.role_table_grants — only SELECT
--     and DELETE are granted), so the UPDATE policy can never actually
--     fire for a real logged-in user either; Postgres blocks it at the
--     GRANT level before RLS is even consulted.
--
-- But the UPDATE policy is a live time bomb: its WITH CHECK only
-- restricts by row ownership (auth.uid() = user_id), not by column. If
-- UPDATE is ever granted to `authenticated` in the future (e.g. to let
-- users edit their own phone/full_name — a plausible feature), this exact
-- policy would immediately let ANY authenticated user self-promote by
-- writing their own `role` to 'admin' or 'FLEETii admin', or move their
-- own `department_id`, via a single direct API call. Removing it now,
-- while it's provably inert, is much safer than leaving it for someone to
-- discover the hard way later. "Users can view own profile" is also just
-- a redundant, wider duplicate of the existing user_profiles_select_own
-- policy (already {authenticated}-only) — no functionality is lost by
-- dropping it.
--
-- Also revokes anon's unnecessary write privileges on user_profiles as
-- defense-in-depth: anon is the public, unauthenticated role (shipped in
-- the browser bundle's anon key) and has no legitimate reason to write to
-- this table — user creation goes exclusively through create-user.mts's
-- service-role key by design (see rls_policies.sql). Currently harmless
-- (RLS blocks every anon request via the null auth.uid() check above),
-- but removing the base grant closes the gap outright rather than relying
-- solely on RLS to catch every future policy mistake. anon's SELECT grant
-- is left alone — out of scope for this specific finding, and would need
-- its own check that no public-reachable page relies on it.
--
-- Safe to re-run: guarded/idempotent throughout.

drop policy if exists "Users can update own profile" on public.user_profiles;
drop policy if exists "Users can view own profile" on public.user_profiles;

revoke insert, update, delete, truncate on public.user_profiles from anon;
