// Netlify Function: sets the CALLING user's new password AND clears
// app_metadata.must_change_password, in one Auth Admin API call — reached
// from SetPasswordPage.tsx (first login on a temporary password, or a
// "reset password" email link's session). app_metadata is service-role-only
// to write (that's the whole point of using it for this flag — a user can't
// just clear it themselves client-side).
//
// Setting the password HERE, rather than SetPasswordPage calling
// supabase.auth.updateUser() itself and this function only clearing the
// flag afterwards, is deliberate: in that older split a user could skip the
// password change entirely by POSTing straight to this endpoint, clearing
// the flag while keeping the temporary password from their welcome email.
// Now the flag can only ever be cleared together with a real new password.
//
// Any authenticated user may call this — not admin-only, since it's a
// self-service action every account (admin or not) created via
// create-user.mts needs to complete. It only ever touches the caller's OWN
// id, taken from their verified bearer token, never a client-supplied one —
// so one user can never change another's password or flag.
import { getAdminClient } from "./_shared/adminClient.js";
import { requireUser } from "./_shared/serverAuth.js";

/** Same minimum as SetPasswordPage.tsx's own client-side check — re-checked here since the client check alone is bypassable. */
const MIN_PASSWORD_LENGTH = 8;

type CompletePasswordChangeBody = { password?: unknown };

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  let body: CompletePasswordChangeBody;
  try {
    body = (await req.json()) as CompletePasswordChangeBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  // Not trimmed — leading/trailing spaces are legitimate password characters.
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return new Response(JSON.stringify({ error: `Adgangskoden skal være mindst ${MIN_PASSWORD_LENGTH} tegn.` }), {
      status: 400,
    });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  const { error } = await admin.auth.admin.updateUserById(authResult.userId, {
    password,
    app_metadata: { must_change_password: false },
  });

  if (error) {
    console.error("[complete-password-change] updateUserById failed:", error);
    // Supabase Auth's own password-policy rejections (too weak, etc.) are
    // written for end users — pass those through; anything else gets a
    // generic message.
    const message = error.status === 422 && error.message ? error.message : "Kunne ikke gemme adgangskoden. Prøv igen.";
    return new Response(JSON.stringify({ error: message }), { status: error.status === 422 ? 400 : 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
