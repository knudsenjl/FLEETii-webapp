import { createClient } from "@supabase/supabase-js";

export type AdminCheckResult = { ok: true; userId: string } | { ok: false; status: 401 | 403 | 500; error: string };

/**
 * Verifies that the bearer token on an incoming Netlify Function request
 * belongs to a logged-in Supabase user whose profile has role "admin".
 * Netlify Functions authenticate to Supabase with the service-role key for
 * their own privileged work, but that key bypasses RLS entirely and says
 * nothing about WHO is calling the function — this checks the caller's own
 * identity via the anon key instead, so the profiles "read your own row" RLS
 * policy still applies.
 */
export async function requireAdmin(req: Request): Promise<AdminCheckResult> {
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

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle<{ role: string }>();

  if (profileError || profile?.role !== "admin") {
    return { ok: false, status: 403, error: "Kun administratorer har adgang til denne handling." };
  }

  return { ok: true, userId: userData.user.id };
}
