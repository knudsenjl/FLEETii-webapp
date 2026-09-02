// Shared "create a FLEETii user account" building blocks, used by both
// create-user.mts (single user, from UserDetailsPage.tsx's form) and
// bulk-import-users.mts (many users, from a customer-supplied CSV/JSON
// file) — extracted here so the two stay identical rather than drifting:
// same allowed roles, same retry behaviour against Supabase's Auth API,
// same welcome email.
import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml } from "./mailer.js";

export const ALLOWED_ROLES = ["user", "admin"] as const;
export type Role = (typeof ALLOWED_ROLES)[number];

/** True if `value` is exactly "user" or "admin" — the only valid `user_profiles.role` values a caller may assign via create-user.mts/bulk-import-users.mts ("sysadm" is never assignable through either). */
export function isAllowedRole(value: string): value is Role {
  return (ALLOWED_ROLES as readonly string[]).includes(value);
}

/** True if `message` is a real, human-readable error string — not empty and not a raw JSON blob (Supabase's Auth API occasionally returns an error with no proper "message" field, which supabase-js then fills in with something like the literal string "{}"; that's not fit to show an admin directly). */
export function isUsableErrorMessage(message: string | undefined): message is string {
  return Boolean(message?.trim()) && !message!.trim().startsWith("{");
}

/** Danish label for a `user_profiles.role` value, matching AuthContext.tsx's formatRoleLabel — not imported directly since that file is a client-side React context module, not something a Netlify Function should pull in for one string. */
export function roleLabel(role: Role): string {
  return role === "admin" ? "Administrator" : "Bruger";
}

/**
 * Creates one auth.users row with the shared default password
 * (email_confirm: true since there's no confirmation-link email to click —
 * an admin creating the account IS the verification) and marks it as
 * needing a real password on first login. Retries up to 3 times on
 * AuthRetryableFetchError (a dropped/incomplete HTTP response talking to
 * the Auth API, not a real rejection like "already registered", which
 * comes back as a different, non-retryable error) — worth a couple of
 * automatic retries rather than failing an entire bulk-import row (or a
 * single create-user.mts request) over a transient network blip.
 */
export async function createAuthUserWithRetry(
  admin: SupabaseClient,
  args: { email: string; password: string },
  logPrefix: string,
): Promise<Awaited<ReturnType<SupabaseClient["auth"]["admin"]["createUser"]>>> {
  const MAX_CREATE_ATTEMPTS = 3;
  let result: Awaited<ReturnType<SupabaseClient["auth"]["admin"]["createUser"]>> | undefined;
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
    result = await admin.auth.admin.createUser({
      email: args.email,
      password: args.password,
      email_confirm: true,
      app_metadata: { must_change_password: true },
    });
    if (!result.error || !isAuthRetryableFetchError(result.error) || attempt === MAX_CREATE_ATTEMPTS) {
      break;
    }
    console.error(`[${logPrefix}] createUser attempt ${attempt} hit a retryable network error, retrying:`, result.error);
    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }
  return result!;
}

/**
 * Builds the "your account is ready" HTML email sent to a newly created
 * user: FLEETii logo, a short intro with links to the user manual and the
 * login page (both omitted gracefully if their URL isn't known — the
 * manual's via VITE_BRUGERMANUAL_URL — a site-relative path to a
 * self-hosted static file under public/manualer/ (see AboutPage.tsx's own
 * doc comment), NOT an absolute URL, so building the email's manualUrl
 * requires prefixing it with loginUrl (the site's own base URL) below —
 * omitted if EITHER is unset, since a relative href is meaningless in an
 * email client with no "current page" to resolve against; the login page's
 * via process.env.URL, set automatically by Netlify but absent in some
 * local setups), the login credentials, and what happens on first login.
 * logoUrl points at public/fleetii-logo.png (served at the site's own root
 * by Netlify) rather than the Vite-hashed src/assets copy the app itself
 * uses, since an email needs one stable, publicly-fetchable URL, not a
 * build-time asset import a Netlify Function has no access to anyway.
 */
export function buildWelcomeEmailHtml(args: {
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
