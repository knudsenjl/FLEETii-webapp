// Shared outbound-email helper for Netlify Functions. Sends via plain SMTP
// (nodemailer) — SMTP_HOST is always required now that Resend has been
// dropped entirely (was a fallback for while a sending domain awaited DNS
// verification; no longer used). Originally lived only in
// send-vehicle-request.mts; extracted here once create-user.mts also needed
// to send mail, so both share one transport implementation instead of
// duplicating it.
import nodemailer from "nodemailer";

/** Escapes the five HTML-significant characters so user-supplied values can't break out of a generated email's markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The fields of a nodemailer error worth reading: `code` (EAUTH, ECONNECTION, …), the SMTP reply code and the server's raw reply text. */
type SmtpError = { code?: string; responseCode?: number; response?: string; message?: string };

/**
 * Turns a nodemailer failure into a Danish message that says which setting to
 * check. A bare "Invalid login: 535 …" didn't make that clear (2026-11-12, when
 * production's SMTP password had stopped working). Admins see this text, so it
 * names the env vars and the SMTP login, but never the password.
 */
export function describeSmtpError(error: unknown, settings: { host: string; port: number; user: string }): string {
  const e = (error ?? {}) as SmtpError;
  const serverReply = e.response?.trim() || e.message?.trim() || "intet svar";
  const where = `${settings.host}:${settings.port}`;
  switch (e.code) {
    case "EAUTH":
      return `Mailserveren (${settings.host}) afviste login for ${settings.user}${e.responseCode ? ` (SMTP ${e.responseCode})` : ""}. Adgangskoden (SMTP_PASS) er sandsynligvis forkert eller udløbet, eller kontoen er spærret. Serverens svar: ${serverReply}`;
    case "ECONNECTION":
    case "ETIMEDOUT":
    case "ESOCKET":
    case "EDNS":
      return `Kunne ikke forbinde til mailserveren ${where} (${e.code}). Tjek SMTP_HOST/SMTP_PORT, eller om mailserveren er nede. Detaljer: ${serverReply}`;
    case "ETLS":
      return `Den krypterede forbindelse til mailserveren ${where} fejlede (ETLS). Tjek SMTP_PORT (587 = STARTTLS, 465 = TLS). Detaljer: ${serverReply}`;
    case "EENVELOPE":
      return `Mailserveren afviste afsender eller modtager${e.responseCode ? ` (SMTP ${e.responseCode})` : ""}. Tjek modtagerens emailadresse og SMTP_FROM. Serverens svar: ${serverReply}`;
    default:
      return `Mailfejl${e.code ? ` (${e.code})` : ""}${e.responseCode ? ` (SMTP ${e.responseCode})` : ""} via ${where}: ${serverReply}`;
  }
}

/**
 * Sends one HTML email via plain SMTP (nodemailer). Returns a plain
 * ok/error result rather than throwing, so the caller can turn a failure
 * into a friendly Danish error response without a try/catch at the call
 * site. The error text comes from describeSmtpError.
 */
export async function sendMail(args: { to: string; subject: string; html: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    return { ok: false, error: "Serveren mangler SMTP_HOST." };
  }

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    return { ok: false, error: "Serveren mangler SMTP_USER/SMTP_PASS." };
  }

  const smtpPort = Number(process.env.SMTP_PORT ?? 587);
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    // Port 465 is implicit TLS from the first byte; 587 (and everything
    // else) starts in plaintext and upgrades via STARTTLS instead —
    // nodemailer needs to be told which one applies for the given port.
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
    // nodemailer's own defaults wait up to 2 min to connect and 10 min on an
    // idle socket — far past Netlify's Function limit, so a stuck mail
    // server used to kill the whole request. Fail fast with a real error
    // instead (code review 2026-09-26).
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? smtpUser,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeSmtpError(error, { host: smtpHost, port: smtpPort, user: smtpUser }) };
  }
}
