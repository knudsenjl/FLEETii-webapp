// Netlify Function: emails FLEETii staff a "please create/provision this
// vehicle" request on behalf of an admin (there's no vehicle-provisioning
// API to call directly — a human sets the device up). Reached from
// NewVehiclePage.tsx.
//
// Mail transport (SMTP vs. Resend) lives in _shared/mailer.ts, shared with
// create-user.mts's welcome email. RESEND_MAIL_RECIEVER is this function's
// own recipient (FLEETii staff) — unrelated to who create-user.mts emails.
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { requireAdmin } from "./_shared/serverAuth.js";
import { escapeHtml, sendMail } from "./_shared/mailer.js";

type SendVehicleRequestBody = {
  afdeling?: string | null;
  nummerplade?: string;
  brand?: string;
  maerke?: string;
  aargang?: string;
  kontaktperson?: string;
  kontaktnummer?: string;
};

/** Builds the HTML table of vehicle-request fields that becomes the email body. */
function buildHtmlBody(fields: {
  afdeling: string;
  nummerplade: string;
  brand: string;
  maerke: string;
  aargang: string;
  kontaktperson: string;
  kontaktnummer: string;
}): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="border:1px solid #d6dce2;padding:6px 12px;font-weight:600;background:#f3f5f7;">${escapeHtml(label)}</td>
      <td style="border:1px solid #d6dce2;padding:6px 12px;">${escapeHtml(value)}</td>
    </tr>`;

  return `
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
      ${row("Afdeling", fields.afdeling)}
      ${row("Nummerplade", fields.nummerplade)}
      ${row("Brand", fields.brand)}
      ${row("Mærke", fields.maerke)}
      ${row("Årgang", fields.aargang)}
      ${row("Kontaktperson", fields.kontaktperson)}
      ${row("Kontaktnummer", fields.kontaktnummer)}
    </table>`;
}

/**
 * POST { afdeling?, nummerplade, brand, maerke, aargang, kontaktperson,
 * kontaktnummer } as an authenticated admin (see requireAdmin). Validates
 * every field is a non-empty string, then emails the request to
 * RESEND_MAIL_RECIEVER — via SMTP or Resend, see sendMail.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const mailReceiver = process.env.RESEND_MAIL_RECIEVER;
  if (!mailReceiver) {
    return new Response(JSON.stringify({ error: "Serveren mangler RESEND_MAIL_RECIEVER." }), { status: 500 });
  }

  let body: SendVehicleRequestBody;
  try {
    body = (await req.json()) as SendVehicleRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const nummerplade = asTrimmedString(body.nummerplade);
  const brand = asTrimmedString(body.brand);
  const maerke = asTrimmedString(body.maerke);
  const aargang = asTrimmedString(body.aargang);
  const kontaktperson = asTrimmedString(body.kontaktperson);
  const kontaktnummer = asTrimmedString(body.kontaktnummer);
  if (!nummerplade || !brand || !maerke || !aargang || !kontaktperson || !kontaktnummer) {
    return new Response(
      JSON.stringify({
        error: "Nummerplade, brand, mærke, årgang, kontaktperson og kontaktnummer er påkrævet.",
      }),
      { status: 400 },
    );
  }

  const afdeling = asTrimmedString(body.afdeling) || "—";

  const result = await sendMail({
    to: mailReceiver,
    subject: "Create new vehicle",
    html: buildHtmlBody({ afdeling, nummerplade, brand, maerke, aargang, kontaktperson, kontaktnummer }),
  });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: `Kunne ikke sende mail: ${result.error}` }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
