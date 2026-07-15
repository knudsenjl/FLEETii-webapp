// Netlify Function: clears app_metadata.must_change_password for the
// CALLING user, after they've set a real password via
// supabase.auth.updateUser() on SetPasswordPage.tsx. app_metadata is
// service-role-only to write (that's the whole point of using it for this
// flag — a user can't just clear it themselves client-side), so this
// small server-side step is required to finish the flow.
//
// Any authenticated user may call this — not admin-only, since it's a
// self-service action every account (admin or not) created via create-user.mts
// needs to complete. It only ever touches the caller's OWN id, taken from
// their verified bearer token, never a client-supplied one — so one user
// can never clear another's flag.
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_shared/serverAuth.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Serveren mangler SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY." }),
      { status: 500 },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin.auth.admin.updateUserById(authResult.userId, {
    app_metadata: { must_change_password: false },
  });

  if (error) {
    console.error("[complete-password-change] updateUserById failed:", error);
    return new Response(JSON.stringify({ error: "Kunne ikke fuldføre adgangskodeskiftet. Prøv igen." }), {
      status: 500,
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
