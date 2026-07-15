// Netlify Function: creates a new FLEETii user. Creates the Supabase Auth
// account directly with a known default password (DEFAULT_USER_PASSWORD)
// and marks it as needing a real password (app_metadata.must_change_password),
// rather than emailing an invite — Supabase's invite/email delivery proved
// unreliable in practice (rate limits on the default mailer, persistent
// unexplained failures with a custom SMTP relay), and account creation
// shouldn't depend on email working at all. The user sets their own real
// password on first login, via SetPasswordPage.tsx (see
// netlify/functions/complete-password-change.mts for how that flag gets
// cleared). Also upserts a matching `profiles` row, using the service-role
// key — which bypasses RLS entirely, so the requireAdmin() check below is
// this function's actual authorization boundary (RLS's INSERT policy on
// `profiles` is deliberately absent, precisely because writes are meant to
// only ever happen here). Reached from UserDetailsPage.tsx.
import { createClient, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { requireAdmin } from "./_shared/serverAuth.js";

type CreateUserBody = {
  email?: string;
  full_name?: string | null;
  phone?: string | null;
  department?: string | null;
  role?: string;
};

const ALLOWED_ROLES = ["user", "admin"] as const;
type Role = (typeof ALLOWED_ROLES)[number];

/** True if `value` is exactly "user" or "admin" — the only valid `profiles.role` values. */
function isAllowedRole(value: string): value is Role {
  return (ALLOWED_ROLES as readonly string[]).includes(value);
}

/** True if `message` is a real, human-readable error string — not empty and not a raw JSON blob (Supabase's Auth API occasionally returns an error with no proper "message" field, which supabase-js then fills in with something like the literal string "{}"; that's not fit to show an admin directly). */
function isUsableErrorMessage(message: string | undefined): message is string {
  return Boolean(message?.trim()) && !message!.trim().startsWith("{");
}

/**
 * POST { email, full_name?, phone?, department?, role? } as an
 * authenticated admin. Validates the caller (requireAdmin), the email, and
 * the role (must be "user"/"admin", default "user"), creates the auth user
 * with the shared default password, upserts their profile, and rolls back
 * the created account if the profile write fails so the email doesn't end
 * up permanently "stuck".
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const defaultPassword = process.env.DEFAULT_USER_PASSWORD;

  if (!supabaseUrl || !serviceRoleKey || !defaultPassword) {
    return new Response(
      JSON.stringify({ error: "Serveren mangler SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/DEFAULT_USER_PASSWORD." }),
      { status: 500 },
    );
  }

  let body: CreateUserBody;
  try {
    body = (await req.json()) as CreateUserBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const email = asTrimmedString(body.email);
  if (!email) {
    return new Response(JSON.stringify({ error: "E-mail er påkrævet." }), { status: 400 });
  }

  const rawRole = asTrimmedString(body.role) || "user";
  if (!isAllowedRole(rawRole)) {
    return new Response(JSON.stringify({ error: 'Rolle skal være "user" eller "admin".' }), { status: 400 });
  }
  const role = rawRole;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Creates the auth.users row directly with the shared default password
  // (email_confirm: true since there's no confirmation-link email to click
  // — an admin creating the account IS the verification) and marks it as
  // needing a real password. AuthRetryableFetchError is supabase-js's own
  // name for a dropped/incomplete HTTP response talking to the Auth API
  // (not a real rejection like "already registered", which comes back as a
  // different, non-retryable error) — worth a couple of automatic retries
  // rather than making the admin manually re-click "Opret bruger".
  const MAX_CREATE_ATTEMPTS = 3;
  let created: Awaited<ReturnType<typeof admin.auth.admin.createUser>>["data"] | undefined;
  let createError: Awaited<ReturnType<typeof admin.auth.admin.createUser>>["error"] = null;
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
    ({ data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: defaultPassword,
      email_confirm: true,
      app_metadata: { must_change_password: true },
    }));
    if (!createError || !isAuthRetryableFetchError(createError) || attempt === MAX_CREATE_ATTEMPTS) {
      break;
    }
    console.error(`[create-user] createUser attempt ${attempt} hit a retryable network error, retrying:`, createError);
    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }

  if (createError || !created?.user) {
    console.error("[create-user] createUser failed:", createError);
    const message = isUsableErrorMessage(createError?.message)
      ? createError.message
      : "Kunne ikke oprette bruger efter flere forsøg. Tjek Supabase-projektets Authentication-log for detaljer.";
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }

  // Upsert rather than update: covers both the case where a DB trigger
  // already created the profiles row from auth.users, and the case where
  // it didn't.
  const { error: profileError } = await admin.from("profiles").upsert({
    id: created.user.id,
    email,
    full_name: body.full_name ?? null,
    phone: body.phone ?? null,
    department: body.department ?? null,
    role,
  });

  if (profileError) {
    // Roll back the created account so the email isn't permanently stuck
    // as "already registered" with no matching profile and no way to retry.
    const { error: rollbackError } = await admin.auth.admin.deleteUser(created.user.id);
    if (rollbackError) {
      console.error("[create-user] rollback of created user failed:", rollbackError);
    }
    return new Response(JSON.stringify({ error: profileError.message }), { status: 400 });
  }

  return new Response(JSON.stringify({ id: created.user.id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
