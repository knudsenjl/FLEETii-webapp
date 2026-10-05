// Shared "create a FLEETii user account" building blocks, used by both
// create-user.mts (single user, from UserDetailsPage.tsx's form) and
// bulk-import-users.mts (many users, from a customer-supplied CSV/JSON
// file) — extracted here so the two stay identical rather than drifting:
// same allowed roles, same retry behaviour against Supabase's Auth API,
// same welcome email.
import { randomInt } from "node:crypto";
import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml } from "./mailer.js";

// Character sets for generateTemporaryPassword — look-alike characters
// (0/O/o, 1/l/I) left out, since the password is read off an email and typed
// by hand.
const TEMP_PASSWORD_LOWER = "abcdefghijkmnpqrstuvwxyz";
const TEMP_PASSWORD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const TEMP_PASSWORD_DIGITS = "23456789";
const TEMP_PASSWORD_ALL = TEMP_PASSWORD_LOWER + TEMP_PASSWORD_UPPER + TEMP_PASSWORD_DIGITS;
const TEMP_PASSWORD_LENGTH = 12;

/**
 * A fresh, random, single-use temporary password for one new account —
 * replaces the old shared DEFAULT_USER_PASSWORD env var, which gave every
 * new account the SAME password (printed in every welcome email), so anyone
 * who had ever received one could log in as any other not-yet-activated
 * user. Cryptographically random (node:crypto's randomInt), 12 characters,
 * always containing at least one lowercase letter, uppercase letter and
 * digit so it satisfies any character-class rule Supabase Auth's password
 * policy may be configured with.
 */
export function generateTemporaryPassword(): string {
  const pick = (chars: string) => chars[randomInt(chars.length)];
  const chars = [pick(TEMP_PASSWORD_LOWER), pick(TEMP_PASSWORD_UPPER), pick(TEMP_PASSWORD_DIGITS)];
  while (chars.length < TEMP_PASSWORD_LENGTH) {
    chars.push(pick(TEMP_PASSWORD_ALL));
  }
  // Fisher-Yates shuffle, so the guaranteed classes aren't always the first three characters.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export const ALLOWED_ROLES = ["user", "admin"] as const;
export type Role = (typeof ALLOWED_ROLES)[number];

/** True if `value` is exactly "user" or "admin" — the only valid `user_profiles.role` values an ordinary caller may assign via create-user.mts/bulk-import-users.mts. "sysadm" is deliberately NOT in this list: its one assignable path (a sysadm creating another sysadm) is checked separately in create-user.mts. */
export function isAllowedRole(value: string): value is Role {
  return (ALLOWED_ROLES as readonly string[]).includes(value);
}

/** True if `message` is a real, human-readable error string — not empty and not a raw JSON blob (Supabase's Auth API occasionally returns an error with no proper "message" field, which supabase-js then fills in with something like the literal string "{}"; that's not fit to show an admin directly). */
export function isUsableErrorMessage(message: string | undefined): message is string {
  return Boolean(message?.trim()) && !message!.trim().startsWith("{");
}

/** Danish label for a `user_profiles.role` value, matching AuthContext.tsx's formatRoleLabel — not imported directly since that file is a client-side React context module, not something a Netlify Function should pull in for one string. */
function roleLabel(role: Role | "sysadm"): string {
  if (role === "sysadm") return "Systemadministrator";
  return role === "admin" ? "Administrator" : "Bruger";
}

/**
 * Creates one auth.users row with the given temporary password (see generateTemporaryPassword)
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

/** One manual link in the welcome email: the Danish noun it's shown as, and its absolute URL. */
export type WelcomeManualLink = { label: string; url: string };

/**
 * Which manuals a new account's welcome email links to, by role (user
 * decision 2026-10-05): a "user" gets the Bruger manual, an "admin" the
 * Bruger and Administrator manuals, a "sysadm" all three. Each comes from
 * the same env var AboutPage.tsx reads (VITE_BRUGERMANUAL_URL /
 * VITE_ADMINMANUAL_URL / VITE_FLEETIIMANUAL_URL) — a site-relative path to
 * a self-hosted static file under public/manualer/, NOT an absolute URL, so
 * it's prefixed with loginUrl (the site's own base URL) here. A manual
 * whose env var is unset is simply left out, and with no loginUrl there are
 * none at all, since a relative href is meaningless in an email client.
 * `env` is a parameter only so tests don't have to touch process.env.
 */
export function welcomeManualLinks(
  role: Role | "sysadm",
  loginUrl: string | null,
  env: Record<string, string | undefined> = process.env,
): WelcomeManualLink[] {
  if (!loginUrl) return [];
  const candidates: { label: string; path: string | undefined; show: boolean }[] = [
    { label: "brugermanualen", path: env.VITE_BRUGERMANUAL_URL, show: true },
    { label: "administratormanualen", path: env.VITE_ADMINMANUAL_URL, show: role === "admin" || role === "sysadm" },
    { label: "systemadministratormanualen", path: env.VITE_FLEETIIMANUAL_URL, show: role === "sysadm" },
  ];
  return candidates.flatMap(({ label, path, show }) => (show && path ? [{ label, url: `${loginUrl}${path}` }] : []));
}

/**
 * Builds the "your account is ready" HTML email sent to a newly created
 * user: FLEETii logo, a short intro with links to the role's manuals (see
 * welcomeManualLinks) and the login page (each omitted gracefully if its
 * URL isn't known; the login page's
 * via process.env.URL, set automatically by Netlify but absent in some
 * local setups), the login credentials, and what happens on first login.
 * logoUrl points at public/fleetii-logo.png (served at the site's own root
 * by Netlify) rather than the Vite-hashed src/assets copy the app itself
 * uses, since an email needs one stable, publicly-fetchable URL, not a
 * build-time asset import a Netlify Function has no access to anyway.
 */
export function buildWelcomeEmailHtml(args: {
  /** "sysadm" only ever comes from create-user.mts's own sysadm-creates-sysadm path — see its doc comment. */
  role: Role | "sysadm";
  email: string;
  password: string;
  loginUrl: string | null;
  /** The role's manuals — see welcomeManualLinks. Empty when none are known. */
  manuals: WelcomeManualLink[];
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

  // One manual (a regular user) keeps the original wording with a single
  // "her" link; several are listed by name, each its own link, joined as
  // "a, b og c".
  const namedManualLinks = args.manuals.map((m) => `<a href="${escapeHtml(m.url)}">${escapeHtml(m.label)}</a>`);
  const manualSentence =
    args.manuals.length === 1
      ? `Du kan finde en kort introduktion til FLEETii <a href="${escapeHtml(args.manuals[0].url)}">her</a>`
      : args.manuals.length > 1
        ? `Du kan finde en introduktion til FLEETii i ${namedManualLinks.slice(0, -1).join(", ")} og ${namedManualLinks[namedManualLinks.length - 1]}`
        : null;
  const loginLink = args.loginUrl
    ? `<a href="${escapeHtml(args.loginUrl)}">${escapeHtml(args.loginUrl)}</a>`
    : null;

  const introParts: string[] = [];
  if (manualSentence) introParts.push(manualSentence);
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
