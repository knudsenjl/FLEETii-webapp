// Netlify Function: looks up a Danish company's registered details from
// cvrapi.dk (https://cvrapi.dk/documentation) by CVR number — used by
// CostumerNewPage.tsx's "Slå op i CVR-registret" button to auto-fill
// Navn/Vej og husnr./Postnr. og by from a typed-in CVR number, the same
// "external lookup fills in the form" shape as motorapi-vehicle-lookup.mts.
// sysadm gated, same access level as the rest of CostumerNewPage.tsx
// (see App.tsx's requireRole="sysadm" on /costumer-new).
import { requireSysadm } from "./_shared/serverAuth.js";
import { stripNumberSpacing } from "../../src/lib/textNormalization.js";

const CVRAPI_BASE_URL = "https://cvrapi.dk/api";

/** cvrapi.dk requires "a descriptive user agent" naming the calling
 * application (undocumented exact format, but their own docs' example is
 * "<company/app name> - <project name> - <contact>") — an empty/generic
 * User-Agent gets rejected with error INVALID_UA. No real contact address
 * is wired up for this yet, so this stays a plain app identifier rather
 * than inventing one. */
const CVRAPI_USER_AGENT = "FLEETii - Kundeoprettelse (https://fleetii.dk)";

/** cvrapi.dk's documented error codes, translated to a Danish message a sysadm can act on — see https://cvrapi.dk/documentation. */
function friendlyCvrApiError(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case "NOT_FOUND":
      return "Intet CVR-nummer fundet med den værdi.";
    case "INVALID_VAT":
      return "Ugyldigt CVR-nummer.";
    case "QUOTA_EXCEEDED":
      return "CVR-opslag er midlertidigt utilgængeligt (dagens kvote hos cvrapi.dk er brugt op). Udfyld felterne manuelt.";
    case "BANNED":
    case "INVALID_UA":
      return "CVR-opslag er midlertidigt utilgængeligt. Udfyld felterne manuelt.";
    default:
      return message ?? "Kunne ikke slå CVR-nummeret op.";
  }
}

/** The subset of cvrapi.dk's (much larger — company code/description, credit status, every production unit, owners, ...) response CostumerNewPage.tsx actually fills fields from. Trimmed down rather than passed through raw, since none of that extra data is shown or used anywhere here. */
type CvrLookupResult = {
  vat: number;
  name: string | null;
  address: string | null;
  zipcode: string | number | null;
  city: string | null;
  cityname: string | null;
};

/**
 * GET ?cvr=<8-digit CVR number>, as a logged-in sysadm. Returns
 * { vat, name, address, zipcode, city, cityname } on success (see
 * CvrLookupResult), or { error } with a Danish message on failure.
 */
export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireSysadm(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  // Stripped of ALL whitespace (not just trimmed) before validating/sending
  // on to cvrapi.dk — the admin may have typed/pasted it with spaces (a
  // normal, readable way to enter a CVR number), but cvrapi.dk's own
  // search param and the 8-digit check below both need the plain digit
  // string.
  const cvr = stripNumberSpacing(new URL(req.url).searchParams.get("cvr") ?? "");
  if (!cvr || !/^\d{8}$/.test(cvr)) {
    return new Response(JSON.stringify({ error: "CVR-nummeret skal være 8 cifre." }), { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(`${CVRAPI_BASE_URL}?search=${encodeURIComponent(cvr)}&country=dk`, {
      headers: { "User-Agent": CVRAPI_USER_AGENT },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Kunne ikke kontakte cvrapi.dk." }), { status: 502 });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new Response(JSON.stringify({ error: "cvrapi.dk svarede med ugyldig JSON." }), { status: 502 });
  }

  const errorCode = (body as { error?: string } | null)?.error;
  if (!response.ok || errorCode) {
    const message = friendlyCvrApiError(errorCode, (body as { message?: string } | null)?.message);
    return new Response(JSON.stringify({ error: message }), { status: response.ok ? 502 : response.status });
  }

  const company = body as Partial<CvrLookupResult>;
  const result: CvrLookupResult = {
    vat: company.vat ?? Number(cvr),
    name: company.name ?? null,
    address: company.address ?? null,
    zipcode: company.zipcode ?? null,
    city: company.city ?? null,
    cityname: company.cityname ?? null,
  };

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
