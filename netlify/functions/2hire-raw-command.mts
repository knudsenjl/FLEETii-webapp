// Netlify Function backing TwoHireCommandPage.tsx ("/2hire-command",
// sysadm-only): sends an arbitrary, hand-typed request straight to 2hire's
// Adapter API and returns the raw response, for poking at endpoints this
// codebase has no dedicated wrapper for yet (unlike 2hire-vehicle-command.mts/
// 2hire-vehicle-state.mts, which each call one fixed, already-understood
// _shared/twoHireClient.ts function). Deliberately thin and unscoped beyond
// the sysadm check itself — this is a diagnostic console, not a
// user-facing feature, so it always authenticates as the global/sysadm
// 2hire credential (getGlobalCredentials) regardless of which vehicle the
// command targets, same as getDeviceState()'s own test-tooling-only
// shortcut in twoHireClient.ts.
//
// The one convenience this adds over a raw curl call: a command string may
// embed a REAL number plate wrapped in braces (e.g.
// "POST /api/v1/vehicle/{AB12345}/command/generic/locate") instead of
// requiring the caller to already know 2hire's own vehicle_id — every such
// {..} token is looked up against vehicle_profiles.number_plate and
// substituted with the matching vehicle_id before the request goes out.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "./_shared/adminClient.js";
import { requireSysadm } from "./_shared/serverAuth.js";
import { getGlobalCredentials, getTwoHireAccessToken, getTwoHireBaseUrl } from "./_shared/twoHireClient.js";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

/** Matches every "{...}" token in a command string — each one's inner text is treated as a number plate to resolve (see resolvePlatePlaceholders). */
const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/g;

/**
 * Replaces every "{plate}" token in `path` with that plate's real 2hire
 * vehicle_id, read from vehicle_profiles.number_plate (case/whitespace
 * insensitive — plates are typically typed in all-caps but this shouldn't
 * fail on a stray lowercase letter or trailing space). Throws naming the
 * first plate that doesn't resolve to exactly one vehicle, rather than
 * silently sending a half-substituted command to 2hire.
 */
async function resolvePlatePlaceholders(path: string, admin: SupabaseClient): Promise<string> {
  const plates = [...new Set([...path.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1].trim()))];
  if (plates.length === 0) return path;

  // ilike (not .in()) so a plate typed in any case still matches how it's
  // actually stored — number_plate isn't guaranteed to be all-caps in the DB.
  const { data: vehicles, error } = await admin
    .from("vehicle_profiles")
    .select("vehicle_id, number_plate")
    .or(plates.map((plate) => `number_plate.ilike.${plate}`).join(","))
    .returns<{ vehicle_id: string; number_plate: string | null }[]>();
  if (error) throw new Error(`Kunne ikke slå nummerplader op: ${error.message}`);

  const byPlate = new Map((vehicles ?? []).map((v) => [v.number_plate?.toUpperCase(), v.vehicle_id]));

  let resolved = path;
  for (const plate of plates) {
    const vehicleId = byPlate.get(plate.toUpperCase());
    if (!vehicleId) {
      throw new Error(`Intet køretøj fundet med nummerplade "${plate}".`);
    }
    resolved = resolved.split(`{${plate}}`).join(vehicleId);
  }
  return resolved;
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireSysadm(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const requestBody = (await req.json().catch(() => null)) as { command?: string; body?: string } | null;
  const command = requestBody?.command?.trim();
  if (!command) {
    return new Response(JSON.stringify({ error: "command er påkrævet." }), { status: 400 });
  }

  const [methodToken, ...pathParts] = command.split(/\s+/);
  const method = methodToken?.toUpperCase() as HttpMethod;
  const rawPath = pathParts.join(" ");
  if (!HTTP_METHODS.includes(method) || !rawPath) {
    return new Response(
      JSON.stringify({ error: `Ugyldig kommando. Forventet format: "METODE /sti" (${HTTP_METHODS.join(", ")}).` }),
      { status: 400 },
    );
  }
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }

  try {
    const resolvedPath = await resolvePlatePlaceholders(path, adminClientResult.admin);

    const token = await getTwoHireAccessToken(getGlobalCredentials());
    const hasBody = method !== "GET" && method !== "DELETE" && requestBody?.body?.trim();

    const response = await fetch(`${getTwoHireBaseUrl()}${resolvedPath}`, {
      method,
      headers: {
        Authorization: `${token.tokenType} ${token.value}`,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? requestBody!.body : undefined,
    });

    const rawText = await response.text();
    let parsed: unknown = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      // Not JSON — return the raw text as-is.
    }

    return new Response(
      JSON.stringify({ requestUrl: `${getTwoHireBaseUrl()}${resolvedPath}`, status: response.status, ok: response.ok, result: parsed }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
};
