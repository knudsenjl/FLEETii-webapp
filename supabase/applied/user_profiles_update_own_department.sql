-- Lets a logged-in user switch their own ACTIVE department ("Skift
-- afdeling", see PageHeader.tsx) by updating user_profiles.department_id
-- directly from the browser — restricted to (a) their own row, (b) only the
-- department_id column, and (c) only to a value they hold a grant for in
-- user_departments (see user_departments_table.sql).
--
-- Column-scoped GRANT is essential here, not just the RLS policy: a plain
-- row-level UPDATE policy applies to the WHOLE row, not just department_id
-- — without restricting the grant to this one column, a user could PATCH
-- any other column on their own row (role, email, ...) as long as
-- department_id still satisfies the WITH CHECK afterwards. Same class of
-- self-promotion bug found earlier this session via the legacy
-- public-scoped policy (see security_advisor_fixes.sql).
--
-- Safe to re-run: GRANT is additive/idempotent, policy is dropped and
-- recreated.

grant update (department_id) on public.user_profiles to authenticated;

drop policy if exists "user_profiles_update_own_department" on public.user_profiles;
create policy "user_profiles_update_own_department" on public.user_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.user_departments ud
      where ud.user_id = user_profiles.user_id
        and ud.department_id = user_profiles.department_id
    )
  );
