// Shared outbound-email helper for Netlify Functions. Sends via plain SMTP
// (nodemailer) when SMTP_HOST is configured — a stopgap for while Resend's
// sending domain isn't DNS-verified yet, since the unverified Resend account
// can only deliver to its own address (see DEFAULT_RESEND_FROM below). Falls
// back to the Resend API otherwise. Originally lived only in
// send-vehicle-request.mts; extracted here once create-user.mts also needed
// to send mail, so both share one transport implementation instead of
// duplicating it.
import nodemailer from "nodemailer";
import { Resend } from "resend";

/** Escapes the five HTML-significant characters so user-supplied values can't break out of a generated email's markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Sender defaults to Resend's shared onboarding domain, which requires no
// DNS setup but can only deliver to the Resend account's own email address.
// Once a real domain is verified in Resend (Domains → Add Domain → add the
// SPF/DKIM records they give you), set RESEND_FROM to an address on that
// domain (e.g. "FLEETii <noreply@mh3.dk>") to lift that restriction.
const DEFAULT_RESEND_FROM = "FLEETii <onboarding@resend.dev>";

/**
 * Sends one HTML email, via plain SMTP (nodemailer) if SMTP_HOST is set,
 * otherwise via the Resend API — see this file's header comment for why
 * both paths exist. Returns a plain ok/error result rather than throwing,
 * so the caller can turn a failure into a friendly Danish error response
 * without a try/catch at the call site.
 */
export async function sendMail(args: { to: string; subject: string; html: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const smtpHost = process.env.SMTP_HOST;

  if (smtpHost) {
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

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Serveren mangler SMTP_HOST eller RESEND_API_KEY." };
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? DEFAULT_RESEND_FROM,
    to: args.to,
    subject: args.subject,
    html: args.html,
  });

  return error ? { ok: false, error: error.message } : { ok: true };
}
