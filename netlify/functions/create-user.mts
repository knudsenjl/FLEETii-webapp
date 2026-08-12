// Netlify Function: creates a new FLEETii user. Creates the Supabase Auth
// account directly with a known default password (DEFAULT_USER_PASSWORD)
// and marks it as needing a real password (app_metadata.must_change_password),
// rather than using Supabase's own invite/confirmation email — that proved
// unreliable in practice (rate limits on the default mailer, persistent
// unexplained failures with a custom SMTP relay), and account creation
// shouldn't depend on email working at all: the account is fully usable
// (login, bookings, etc.) the moment this function returns, regardless of
// whether the welcome email below actually gets delivered. That email is
// this app's own notification (via _shared/mailer.ts, not Supabase's
// built-in one) telling the person their account exists and how to log in;
// its failure is logged but does not fail the request or roll anything
// back, since the account itself is already fully created by that point.
// The user sets their own real password on first login, via
// SetPasswordPage.tsx (see netlify/functions/complete-password-change.mts
// for how that flag gets cleared). Also upserts a matching `user_profiles`
// row, using the service-role key — which bypasses RLS entirely, so the
// requireAdmin() check below is this function's actual authorization
// boundary (RLS's INSERT policy on `user_profiles` is deliberately absent,
// precisely because writes are meant to only ever happen here). Reached
// from UserDetailsPage.tsx.
import { createClient } from "@supabase/supabase-js";
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { requireAdmin } from "./_shared/serverAuth.js";
import { sendMail } from "./_shared/mailer.js";
import {
  buildWelcomeEmailHtml,
  createAuthUserWithRetry,
  isAllowedRole,
  isUsableErrorMessage,
} from "./_shared/userAccount.js";

type CreateUserBody = {
  email?: string;
  full_name?: string | null;
  phone?: string | null;
  /** Company-wide "Bruger-ID" identifier (see supabase/applied/user_profiles_add_user_ident.sql) — optional. */
  user_ident?: string | null;
  department?: string | null;
  role?: string;
};

/**
 * POST { email, full_name?, phone?, department?, role? } as an
 * authenticated admin. Validates the caller (requireAdmin), the email, the
 * role (must be "user"/"admin", default "user"), and that the requested
 * department matches the caller's own, creates the auth user with the
 * shared default password, upserts their profile, and rolls back the
 * created account if the profile write fails so the email doesn't end up
 * permanently "stuck".
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

  // An admin may only create users within their own costumer — mirrors
  // update-user.mts's identical check (broadened from an earlier, stricter
  // "own department only" check once UserDetailsPage's department dropdown
  // itself became costumer-scoped, listing every department under the
  // caller's costumer, not just their own — the stricter check would have
  // rejected picking any other department in the same costumer). Service-
  // role bypasses RLS entirely, so without this, any admin could create an
  // account in any other costumer's department by hand-crafting a request.
  // body.department is a department NAME (from UserDetailsPage's dropdown,
  // which is name-based) — resolved to its department_id/costumer_id here
  // since user_profiles now stores the uuid, not the name (see
  // supabase/applied/user_profiles_department_to_department_id.sql).
  const requestedDepartmentName = asTrimmedString(body.department) || null;
  const [{ data: caller }, { data: requestedDepartmentRow }] = await Promise.all([
    admin
      .from("user_profiles")
      .select("costumer_id, role")
      .eq("user_id", authResult.userId)
      .maybeSingle<{ costumer_id: string | null; role: string }>(),
    requestedDepartmentName
      ? admin
          .from("departments")
          .select("department_id, costumer_id")
          .eq("name", requestedDepartmentName)
          .maybeSingle<{ department_id: string; costumer_id: string | null }>()
      : Promise.resolve({ data: null }),
  ]);
  const requestedDepartmentId = requestedDepartmentRow?.department_id ?? null;

  // A FLEETii admin isn't scoped to one costumer — same platform-wide
  // exception as department_settings/user_departments' own RLS policies
  // (see supabase/applied/department_settings_allow_fleetii_admin.sql) —
  // they just need the requested department to actually exist.
  const isFleetiiAdmin = caller?.role === "FLEETii admin";
  if (isFleetiiAdmin) {
    if (!requestedDepartmentRow) {
      return new Response(JSON.stringify({ error: "Ugyldig afdeling." }), { status: 400 });
    }
  } else if (!caller?.costumer_id || requestedDepartmentRow?.costumer_id !== caller.costumer_id) {
    return new Response(JSON.stringify({ error: "Du kan kun oprette brugere hos din egen kunde." }), { status: 403 });
  }

  // AuthRetryableFetchError-aware retry (dropped/incomplete HTTP response
  // talking to the Auth API, not a real rejection like "already
  // registered") — see createAuthUserWithRetry's own doc comment.
  const { data: created, error: createError } = await createAuthUserWithRetry(
    admin,
    { email, password: defaultPassword },
    "create-user",
  );

  if (createError || !created?.user) {
    console.error("[create-user] createUser failed:", createError);
    const message = isUsableErrorMessage(createError?.message)
      ? createError.message
      : "Kunne ikke oprette bruger efter flere forsøg. Tjek Supabase-projektets Authentication-log for detaljer.";
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }

  // Upsert rather than update: covers both the case where a DB trigger
  // already created the user_profiles row from auth.users, and the case
  // where it didn't (that trigger, handle_new_user(), doesn't set
  // costumer_id/department_id at all — see
  // supabase/applied/fix_handle_new_user_department_column.sql — so this
  // upsert is what actually populates them for a new user).
  const { error: profileError } = await admin.from("user_profiles").upsert({
    user_id: created.user.id,
    email,
    full_name: body.full_name ?? null,
    phone: body.phone ?? null,
    user_ident: asTrimmedString(body.user_ident) || null,
    department_id: requestedDepartmentId,
    // The requested department's own costumer_id is authoritative (matters
    // for a FLEETii admin, whose own costumer_id — if they even have one —
    // may differ from the department they're assigning); falls back to the
    // caller's own only if somehow no department resolved.
    costumer_id: requestedDepartmentRow?.costumer_id ?? caller?.costumer_id ?? null,
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

  // Best-effort: the account is already fully created and usable at this
  // point, so a failed welcome email is logged, not surfaced as a request
  // failure — the admin still sees it via emailSent below and can pass the
  // credentials on some other way.
  const loginUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? null;
  // VITE_BRUGERMANUAL_URL is a site-relative path (e.g.
  // "/manualer/fleetii-brugermanual-bruger.html"), not an absolute URL —
  // needs loginUrl to become one for the email; omitted if either is unset.
  const manualUrl = loginUrl && process.env.VITE_BRUGERMANUAL_URL ? `${loginUrl}${process.env.VITE_BRUGERMANUAL_URL}` : null;
  const emailResult = await sendMail({
    to: email,
    subject: "Din FLEETii-konto er oprettet",
    html: buildWelcomeEmailHtml({ role, email, password: defaultPassword, loginUrl, manualUrl }),
  });
  if (!emailResult.ok) {
    console.error("[create-user] welcome email failed to send (account was still created):", emailResult.error);
  }

  return new Response(JSON.stringify({ id: created.user.id, emailSent: emailResult.ok }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
