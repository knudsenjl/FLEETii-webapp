// Netlify Function: looks up a vehicle's real-world data from MotorAPI
// (https://v1.motorapi.dk/doc/) by registration number or VIN — used by
// VehicleCreatePage.tsx's "i" button on the Nummerplade row. Calls three
// endpoints (base vehicle data, environment, equipment) and returns all
// three combined; each is independent (a used/older vehicle may lack
// environment/equipment data, or MotorAPI may 404 just one of the three),
// so one endpoint failing doesn't fail the whole request — its own error is
// embedded in that section of the response instead. FLEETii-admin gated,
// same access level as the rest of VehicleCreatePage.tsx (see App.tsx's
// requireRole="FLEETii admin" on /vehicle-create).
import { requireFleetiiAdmin } from "./_shared/serverAuth.js";

const MOTORAPI_BASE_URL = "https://v1.motorapi.dk";

/** One MotorAPI section's result — either the raw parsed JSON body, or an error message if that specific call failed (non-2xx, or a network/parse failure). */
type MotorApiSection = { data: unknown } | { error: string };

/** Calls one MotorAPI endpoint with the shared X-AUTH-TOKEN header, returning a MotorApiSection rather than throwing — so a single failing section (e.g. a 404 on /equipment for a vehicle MotorAPI has no equipment data for) doesn't take down the other two. */
async function fetchMotorApiSection(path: string, token: string): Promise<MotorApiSection> {
  try {
    const response = await fetch(`${MOTORAPI_BASE_URL}${path}`, {
      headers: { "X-AUTH-TOKEN": token },
    });
    const bodyText = await response.text();
    if (!response.ok) {
      return { error: `MotorAPI svarede ${response.status}: ${bodyText || "(intet svar)"}` };
    }
    try {
      return { data: JSON.parse(bodyText) as unknown };
    } catch {
      return { error: "MotorAPI svarede med ugyldig JSON." };
    }
  } catch {
    return { error: "Kunne ikke kontakte MotorAPI." };
  }
}

/**
 * GET ?regNo=<registration number or VIN>, as a logged-in FLEETii admin.
 * Returns { vehicle, environment, equipment }, each independently either
 * { data } or { error } — see fetchMotorApiSection.
 */
export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireFleetiiAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const token = process.env.MOTORAPI_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: "Serveren mangler MOTORAPI_TOKEN." }), { status: 500 });
  }

  const regNo = new URL(req.url).searchParams.get("regNo")?.trim();
  if (!regNo) {
    return new Response(JSON.stringify({ error: "regNo er påkrævet." }), { status: 400 });
  }

  const encodedRegNo = encodeURIComponent(regNo);
  const [vehicle, environment, equipment] = await Promise.all([
    fetchMotorApiSection(`/vehicles/${encodedRegNo}`, token),
    fetchMotorApiSection(`/vehicles/${encodedRegNo}/environment`, token),
    fetchMotorApiSection(`/vehicles/${encodedRegNo}/equipment`, token),
  ]);

  return new Response(JSON.stringify({ vehicle, environment, equipment }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
