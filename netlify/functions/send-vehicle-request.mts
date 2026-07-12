import { Resend } from "resend";
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { requireAdmin } from "./_shared/serverAuth.js";

type SendVehicleRequestBody = {
  afdeling?: string | null;
  nummerplade?: string;
  brand?: string;
  maerke?: string;
  aargang?: string;
  kontaktperson?: string;
  kontaktnummer?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

// Sender defaults to Resend's shared onboarding domain, which requires no
// DNS setup but can only deliver to the Resend account's own email address.
// Once a real domain is verified in Resend (Domains → Add Domain → add the
// SPF/DKIM records they give you), set RESEND_FROM to an address on that
// domain (e.g. "FLEETii <noreply@mh3.dk>") to lift that restriction.
const DEFAULT_FROM = "FLEETii <onboarding@resend.dev>";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const mailReceiver = process.env.RESEND_MAIL_RECIEVER;
  if (!apiKey || !mailReceiver) {
    return new Response(
      JSON.stringify({ error: "Serveren mangler RESEND_API_KEY/RESEND_MAIL_RECIEVER." }),
      { status: 500 },
    );
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

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? DEFAULT_FROM,
    to: mailReceiver,
    subject: "Create new vehicle",
    html: buildHtmlBody({ afdeling, nummerplade, brand, maerke, aargang, kontaktperson, kontaktnummer }),
  });

  if (error) {
    return new Response(JSON.stringify({ error: `Kunne ikke sende mail: ${error.message}` }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
