-- Found in code review: user_profiles_grant_alle_koretojer (grant_admins_
-- alle_koretojer_access.sql) only fired on `insert or update of role` — an
-- admin reassigned to a different costumer WITHOUT a role change (their
-- costumer_id updated some other way) wouldn't automatically get that new
-- costumer's "Alle køretøjer" grant. The trigger function itself already
-- reads new.costumer_id correctly; only the fired-columns list needed
-- extending.
--
-- Safe to re-run: trigger dropped before recreated, function unchanged.

drop trigger if exists user_profiles_grant_alle_koretojer on public.user_profiles;
create trigger user_profiles_grant_alle_koretojer
  after insert or update of role, costumer_id on public.user_profiles
  for each row
  execute function public.grant_alle_koretojer_to_admin();
