// Shared "get a service-role Supabase client, or the error Response to
// return if the required env vars are missing" helper. Every Netlify
// Function that writes with the service-role key (bypassing RLS — see each
// function's own doc comment for why) repeated this same three-part
// read-env-vars/validate/createClient block at its own top; centralizing it
// here means the env var names and the Danish error message only need to
// agree in one place.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AdminClientResult = { ok: true; admin: SupabaseClient } | { ok: false; status: 500; error: string };

/**
 * Reads SUPABASE_URL (falling back to VITE_SUPABASE_URL) and
 * SUPABASE_SERVICE_ROLE_KEY and returns a service-role client — bypasses
 * RLS entirely, so callers must have already established their own
 * authorization boundary (requireAdmin/requireSysadm plus any
 * function-specific scoping check) before using it — or, if either var is
 * missing, the ready-to-return 500 Response's error/status. createClient()
 * itself is a pure local object construction (no network call), so building
 * it here before a caller's own body validation is safe even though the
 * original per-function code built it only after that validation.
 */
export function getAdminClient(): AdminClientResult {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, status: 500, error: "Serveren mangler SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY." };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { ok: true, admin };
}
