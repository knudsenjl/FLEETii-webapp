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
import { createClient, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { requireAdmin } from "./_shared/serverAuth.js";
import { escapeHtml, sendMail } from "./_shared/mailer.js";

type CreateUserBody = {
  email?: string;
  full_name?: string | null;
  phone?: string | null;
  department?: string | null;
  role?: string;
};

const ALLOWED_ROLES = ["user", "admin"] as const;
type Role = (typeof ALLOWED_ROLES)[number];

/** True if `value` is exactly "user" or "admin" — the only valid `user_profiles.role` values. */
function isAllowedRole(value: string): value is Role {
  return (ALLOWED_ROLES as readonly string[]).includes(value);
}

/** True if `message` is a real, human-readable error string — not empty and not a raw JSON blob (Supabase's Auth API occasionally returns an error with no proper "message" field, which supabase-js then fills in with something like the literal string "{}"; that's not fit to show an admin directly). */
function isUsableErrorMessage(message: string | undefined): message is string {
  return Boolean(message?.trim()) && !message!.trim().startsWith("{");
}

/** Danish label for a `user_profiles.role` value, matching AuthContext.tsx's formatRoleLabel — not imported directly since that file is a client-side React context module, not something a Netlify Function should pull in for one string. */
function roleLabel(role: Role): string {
  return role === "admin" ? "Administrator" : "Bruger";
}

/**
 * Builds the "your account is ready" HTML email sent to a newly created
 * user: FLEETii logo, a short intro with links to the user manual and the
 * login page (both omitted gracefully if their URL isn't known — the
 * manual's via VITE_BRUGERMANUAL_URL, unset until configured; the login
 * page's via process.env.URL, set automatically by Netlify but absent in
 * some local setups), the login credentials, and what happens on first
 * login. logoUrl points at public/fleetii-logo.png (served at the site's
 * own root by Netlify) rather than the Vite-hashed src/assets copy the app
 * itself uses, since an email needs one stable, publicly-fetchable URL, not
 * a build-time asset import a Netlify Function has no access to anyway.
 */
function buildWelcomeEmailHtml(args: {
  role: Role;
  email: string;
  password: string;
  loginUrl: string | null;
  manualUrl: string | null;
}): string {
  // A table (not flex) for the header row — reliable across email clients,
  // several of which (Outlook chief among them) ignore flexbox entirely.
  // The logo cell is width:1% + white-space:nowrap so it shrinks to the
  // image's own size, leaving the heading the rest of the row. Both the
  // width/height HTML attributes AND the matching inline style are set on
  // the <img> — some clients (Gmail included) render at the image's native
  // resolution and ignore CSS-only sizing unless the attributes are there
  // too. fleetii-logo.png is ~2172×776 (≈2.8:1), hence 73×26.
  const logoCell = args.loginUrl
    ? `<td style="vertical-align:middle;width:1%;white-space:nowrap;padding-left:16px;"><a href="https://www.fleetii.dk"><img src="${escapeHtml(args.loginUrl)}/fleetii-logo.png" alt="FLEETii" width="73" height="26" style="height:26px;width:73px;display:block;border:0;" /></a></td>`
    : "";

  const manualLink = args.manualUrl ? `<a href="${escapeHtml(args.manualUrl)}">her</a>` : null;
  const loginLink = args.loginUrl
    ? `<a href="${escapeHtml(args.loginUrl)}">${escapeHtml(args.loginUrl)}</a>`
    : null;

  const introParts: string[] = [];
  if (manualLink) introParts.push(`Du kan finde en kort introduktion til FLEETii ${manualLink}`);
  if (loginLink) introParts.push(`du starter FLEETii på denne adresse: ${loginLink}`);
  const introLine = introParts.length > 0 ? `<p>${introParts.join(", og ")}.</p>` : "";

  return `
    <div style="font-family:sans-serif;font-size:14px;color:#1f2933;line-height:1.5;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr>
          <td style="vertical-align:middle;">
            <h1 style="margin:0;font-size:19px;font-weight:700;color:#18385b;">Velkommen som ${escapeHtml(roleLabel(args.role))} på FLEETii platformen.</h1>
          </td>
          ${logoCell}
        </tr>
      </table>
      ${introLine}
      <p>Du er blevet tildelt flg. brugeroplysninger, som du skal bruge ved login til FLEETii:</p>
      <table style="border-collapse:collapse;margin:4px 0 12px 20px;">
        <tr>
          <td style="padding:2px 12px 2px 0;font-weight:600;">Brugernavn / e-mail:</td>
          <td style="padding:2px 0;">${escapeHtml(args.email)}</td>
        </tr>
        <tr>
          <td style="padding:2px 12px 2px 0;font-weight:600;">Midlertidig adgangskode:</td>
          <td style="padding:2px 0;">${escapeHtml(args.password)}</td>
        </tr>
      </table>
      <p>Ved første login vil FLEETii bede dig om at skifte adgangskoden ${escapeHtml(args.password)} til en personlig adgangskode, hvorefter FLEETii vil blive tilgængelig for dig.</p>
      <h2 style="margin:16px 0 0;font-size:16px;font-weight:700;font-style:italic;color:#18385b;">God fornøjelse med FLEETii</h2>
    </div>`;
}

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

  // An admin may only create users within their own department — mirrors
  // delete-user.mts's identical check. Service-role bypasses RLS entirely,
  // so without this, any department-scoped admin could create an account
  // (including another admin) in any other department simply by picking a
  // different one from UserDetailsPage's dropdown, which lists every
  // department, not just the caller's own. body.department is a
  // department NAME (from UserDetailsPage's dropdown, which is
  // name-based) — resolved to its department_id here since user_profiles
  // now stores that uuid, not the name (see
  // supabase/applied/user_profiles_department_to_department_id.sql).
  const requestedDepartmentName = asTrimmedString(body.department) || null;
  const [{ data: caller }, { data: requestedDepartmentRow }] = await Promise.all([
    admin.from("user_profiles").select("department_id").eq("user_id", authResult.userId).maybeSingle<{ department_id: string | null }>(),
    requestedDepartmentName
      ? admin.from("departments").select("department_id").eq("name", requestedDepartmentName).maybeSingle<{ department_id: string }>()
      : Promise.resolve({ data: null }),
  ]);
  const requestedDepartmentId = requestedDepartmentRow?.department_id ?? null;

  if (!caller || requestedDepartmentId !== caller.department_id) {
    return new Response(JSON.stringify({ error: "Du kan kun oprette brugere i din egen afdeling." }), { status: 403 });
  }

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
  // already created the user_profiles row from auth.users, and the case
  // where it didn't.
  const { error: profileError } = await admin.from("user_profiles").upsert({
    user_id: created.user.id,
    email,
    full_name: body.full_name ?? null,
    phone: body.phone ?? null,
    department_id: requestedDepartmentId,
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
  const manualUrl = process.env.VITE_BRUGERMANUAL_URL ?? null;
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
