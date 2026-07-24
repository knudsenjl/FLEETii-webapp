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

/** Result of requireAdmin()/requireFleetiiAdmin(): either the verified caller's user id, or an HTTP status + Danish error message ready to return to the client as-is. */
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

/** Verifies the caller (via requireUser()) and additionally that their profile has the given role and isn't archived (deleted_at is null — see supabase/applied/user_profiles_add_deleted_at.sql) — an archived caller's still-valid JWT shouldn't keep passing this check just because the ban hasn't fully propagated yet. Shared by requireAdmin/requireFleetiiAdmin below rather than duplicating the same query per role. */
async function requireRole(req: Request, role: string, errorMessage: string): Promise<AdminCheckResult> {
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

  if (profileError || profile?.role !== role) {
    return { ok: false, status: 403, error: errorMessage };
  }

  return { ok: true, userId: userResult.userId };
}

/** Verifies the caller has role "admin" (see requireRole). */
export async function requireAdmin(req: Request): Promise<AdminCheckResult> {
  return requireRole(req, "admin", "Kun administratorer har adgang til denne handling.");
}

/** Verifies the caller has role "FLEETii admin" (see requireRole) — used by the costumer lifecycle functions (delete-costumer.mts), which only a FLEETii admin, not a regular department admin, may invoke. */
export async function requireFleetiiAdmin(req: Request): Promise<AdminCheckResult> {
  return requireRole(req, "FLEETii admin", "Kun FLEETii-administratorer har adgang til denne handling.");
}
