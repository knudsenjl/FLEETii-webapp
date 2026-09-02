// Shared server-side authorization checks for Netlify Functions. Every
// function that needs to know WHO is calling (not just trust the
// service-role key, which bypasses RLS and says nothing about identity)
// reuses requireUser() here; admin-only functions layer requireAdmin()'s
// extra role check on top instead of re-implementing either check.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Result of requireUser(): either the verified caller's user id (plus a Supabase client scoped to their own token, so RLS applies), or an HTTP status + Danish error message ready to return to the client as-is. */
export type UserCheckResult =
  | { ok: true; userId: string; client: SupabaseClient }
  | { ok: false; status: 401 | 500; error: string };

/** Result of requireAdmin()/requireSysadm(): either the verified caller's user id, or an HTTP status + Danish error message ready to return to the client as-is. */
export type AdminCheckResult = { ok: true; userId: string } | { ok: false; status: 401 | 403 | 500; error: string };

/**
 * Verifies that the bearer token on an incoming Netlify Function request
 * belongs to a logged-in Supabase user. Netlify Functions authenticate to
 * Supabase with the service-role key for their own privileged work, but
 * that key bypasses RLS entirely and says nothing about WHO is calling —
 * this checks the caller's own identity via the anon key instead, so the
 * user_profiles "read your own row" RLS policy still applies for anything the
 * caller does with the returned client.
 */
export async function requireUser(req: Request): Promise<UserCheckResult> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, error: "Serveren mangler SUPABASE_URL/VITE_SUPABASE_ANON_KEY." };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) {
    return { ok: false, status: 401, error: "Log ind er påkrævet." };
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) {
    return { ok: false, status: 401, error: "Ugyldig session. Log venligst ind igen." };
  }

  return { ok: true, userId: userData.user.id, client };
}

/** Verifies the caller (via requireUser()) and additionally that their profile has one of the given roles and isn't archived (deleted_at is null — see supabase/applied/user_profiles_add_deleted_at.sql) — an archived caller's still-valid JWT shouldn't keep passing this check just because the ban hasn't fully propagated yet. Shared by requireAdmin/requireSysadm below rather than duplicating the same query per role. */
async function requireRole(req: Request, allowedRoles: string[], errorMessage: string): Promise<AdminCheckResult> {
  const userResult = await requireUser(req);
  if (!userResult.ok) {
    return userResult;
  }

  const { data: profile, error: profileError } = await userResult.client
    .from("user_profiles")
    .select("role")
    .eq("user_id", userResult.userId)
    .is("deleted_at", null)
    .maybeSingle<{ role: string }>();

  if (profileError || !profile || !allowedRoles.includes(profile.role)) {
    return { ok: false, status: 403, error: errorMessage };
  }

  return { ok: true, userId: userResult.userId };
}

/** Verifies the caller has role "admin" OR "sysadm" (a superset, same as ProtectedRoute.tsx's own client-side requireAdmin — see requireRole). */
export async function requireAdmin(req: Request): Promise<AdminCheckResult> {
  return requireRole(req, ["admin", "sysadm"], "Kun administratorer har adgang til denne handling.");
}

/** Verifies the caller has EXACTLY role "sysadm" (no "admin" superset, unlike requireAdmin — see requireRole) — used by the costumer lifecycle functions (delete-costumer.mts), which only a sysadm, not a regular department admin, may invoke. */
export async function requireSysadm(req: Request): Promise<AdminCheckResult> {
  return requireRole(req, ["sysadm"], "Kun sysadm har adgang til denne handling.");
}

/**
 * Shared `user_profiles.role` checks for a role value already fetched from
 * the DB (a `caller`/`target`'s own row) — distinct from requireAdmin/
 * requireSysadm above, which authenticate the CALLER via their bearer
 * token; these just answer "is this specific role value X?" for whichever
 * profile a function has already looked up (e.g. deciding costumer/
 * department scoping once the caller is known to be *some* kind of admin).
 * Every Netlify Function used to re-implement the same raw string
 * comparison at its own call site (delete-user.mts/update-user.mts/
 * create-user.mts/bulk-import-*.mts and the 2hire-*.mts functions) —
 * centralizing here, same as src/lib/roles.ts on the client side, avoids the
 * literal drifting out of sync in one call site. (Renamed from "FLEETii
 * admin" to "sysadm" 2026-09-02 — same role.)
 */
export function isSysadmRole(role?: string | null): boolean {
  return role === "sysadm";
}

/** True if `role` is either admin tier ("admin" or "sysadm") — see isSysadmRole. */
export function isAnyAdminRole(role?: string | null): boolean {
  return role === "admin" || role === "sysadm";
}
