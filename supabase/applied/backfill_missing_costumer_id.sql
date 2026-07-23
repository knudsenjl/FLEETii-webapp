-- Backfills user_profiles.costumer_id for any row still null — every user
-- created via create-user.mts since costumer_id was added this session has
-- had a null costumer_id (that function's upsert never set it until just
-- now — see the create-user.mts fix alongside this migration), which is
-- what caused update-user.mts's "Du kan kun opdatere brugere hos din egen
-- kunde." for a freshly created user. Same value-preserving derivation as
-- the original backfill (user_profiles_add_costumer_id.sql): resolve
-- through department_id -> departments.costumer_id.
--
-- Safe to re-run: only touches rows where costumer_id is still null.

update public.user_profiles
set costumer_id = departments.costumer_id
from public.departments
where departments.department_id = user_profiles.department_id
  and user_profiles.costumer_id is null;
