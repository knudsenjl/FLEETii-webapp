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

/**
 * Sends one HTML email via plain SMTP (nodemailer). Returns a plain
 * ok/error result rather than throwing, so the caller can turn a failure
 * into a friendly Danish error response without a try/catch at the call
 * site.
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

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT ?? 587),
    // Port 465 is implicit TLS from the first byte; 587 (and everything
    // else) starts in plaintext and upgrades via STARTTLS instead —
    // nodemailer needs to be told which one applies for the given port.
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: { user: smtpUser, pass: smtpPass },
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
    const message = error instanceof Error ? error.message : "Ukendt SMTP-fejl.";
    return { ok: false, error: message };
  }
}
