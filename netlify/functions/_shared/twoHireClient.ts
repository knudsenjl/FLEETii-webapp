// Shared client for 2hire's Adapter API (https://developer.2hire.io). Used by
// netlify/functions/2hire-subscribe.mts to authenticate and register our
// webhook subscription. All endpoints are identical between environments —
// only the host differs — so this reads the same VITE_DATA_SOURCE value the
// client build uses to pick mock vs. live (Netlify injects the same env vars
// into both the client build and Functions), rather than a second, separate
// server-only switch. Credentials themselves never reach the client bundle:
// this file only runs inside Netlify Functions.

/** Picks the 2hire host based on VITE_DATA_SOURCE: "2hire-production-adaptor" -> the real fleet; anything else (e.g. "2hire-test-adaptor") -> the test/simulated environment, the safe default. */
export function getTwoHireBaseUrl(): string {
  return process.env.VITE_DATA_SOURCE === "2hire-production-adaptor"
    ? "https://adapter.2hire.io"
    : "https://test.adapter.2hire.io";
}

type CachedToken = {
  value: string;
  tokenType: string;
  expiresAt: number; // ms since epoch
};

let cachedToken: CachedToken | null = null;

function isExpired(token: CachedToken): boolean {
  // Refresh a bit early so a request doesn't race the real expiry.
  return Date.now() >= token.expiresAt - 30_000;
}

async function requestNewToken(): Promise<CachedToken> {
  const clientId = process.env.TWOHIRE_CLIENT_ID;
  const clientSecret = process.env.TWOHIRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Serveren mangler TWOHIRE_CLIENT_ID/TWOHIRE_CLIENT_SECRET.");
  }

  const response = await fetch(`${getTwoHireBaseUrl()}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });

  if (!response.ok) {
    throw new Error(`2hire auth fejlede (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token: string; token_type?: string; expires_in: number | string };
  return {
    value: body.access_token,
    tokenType: body.token_type ?? "Bearer",
    expiresAt: Date.now() + Number(body.expires_in) * 1000,
  };
}

/** Returns a cached 2hire access token, fetching a new one if missing or expired. */
export async function getTwoHireAccessToken(): Promise<CachedToken> {
  if (!cachedToken || isExpired(cachedToken)) {
    cachedToken = await requestNewToken();
  }
  return cachedToken;
}

/**
 * Subscribes to every generic signal (online, position, distance_covered,
 * autonomy_percentage, ...) for every vehicle in one call, via 2hire's
 * wildcard topic "vehicle:*:generic:*". 2hire will first GET `callbackUrl`
 * with a `hub.challenge` to confirm it (see 2hire-webhook.mts), then POST
 * signed signal updates to it going forward.
 */
export async function subscribeToGenericSignals(callbackUrl: string): Promise<void> {
  const secret = process.env.TWOHIRE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Serveren mangler TWOHIRE_WEBHOOK_SECRET.");
  }

  const token = await getTwoHireAccessToken();
  const response = await fetch(`${getTwoHireBaseUrl()}/api/v1/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${token.tokenType} ${token.value}`,
    },
    body: JSON.stringify({
      "hub.mode": "subscribe",
      "hub.topic": "vehicle:*:generic:*",
      "hub.callback": callbackUrl,
      "hub.secret": secret,
    }),
  });

  if (!response.ok) {
    throw new Error(`2hire webhook-abonnement fejlede (${response.status}): ${await response.text()}`);
  }
}

/**
 * One of 2hire's own reusable vehicle-configuration profiles (brand/model/
 * setup) for a 2hire-board device — its `id` is what registerVehicle's
 * `profileId` expects. Loosely typed: 2hire's reference page doesn't publish
 * this response's field names in readable form (only via their interactive
 * "Try It" panel), so this is deliberately not asserted beyond "an array of
 * objects" — inspect an actual response before relying on a specific field.
 * Docs: https://developer.2hire.io/reference/getpublicprofilelist
 */
export type TwoHireBoardProfile = Record<string, unknown>;

/** Lists the 2hire-board vehicle-configuration profiles available to pick a `profileId` from for registerVehicle(). */
export async function getTwoHireBoardProfiles(): Promise<TwoHireBoardProfile[]> {
  const token = await getTwoHireAccessToken();
  const response = await fetch(`${getTwoHireBaseUrl()}/api/v1/connectivity-provider/2hire-board/profile`, {
    headers: { Authorization: `${token.tokenType} ${token.value}` },
  });

  if (!response.ok) {
    throw new Error(`Kunne ikke hente 2hire-profiler (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as TwoHireBoardProfile[];
}

/**
 * Registers a physical 2hire-board device (identified by the QR code printed
 * on the unit) as a new vehicle in 2hire, associating it with one of 2hire's
 * own vehicle-configuration profiles (see getTwoHireBoardProfiles for valid
 * profileId values). Only implements the "2HIRE_BOARD" connectivityProvider
 * variant — the only one this fleet's hardware actually uses (every
 * vehicle_profiles.iot_id seeded so far is a "2H2000..." 2hire-board
 * identifier, see supabase/applied/seed_vehicle_profiles.sql). The same
 * endpoint also supports OEM-specific variants (VIN-based for STELLANTIS/
 * MERCEDES/TOYOTA/..., IMEI-based for OMNI_NINEBOT/TELTONIKA, plus
 * provider-specific credentials for TESLA/SEGWAY_CLOUD/...) that this fleet
 * has no use for today.
 *
 * On success, 2hire hands back a system-generated `vehicleId` — this is the
 * same id that ends up as vehicle_profiles.vehicle_id once the vehicle is
 * seeded into our own DB (see rename_vehicle_id_to_uuid.sql), and is what
 * 2hire's webhook payloads/commands address it by afterwards.
 *
 * Docs: https://developer.2hire.io/reference/putregistervehicle
 */
export async function registerVehicle(params: {
  /** The QR code printed on the physical 2hire-board device being onboarded (see createvehicle/POST /devices for how a *simulated* device's QR code is generated in the e2e test environment — a real physical unit already has one). */
  qrCode: string;
  /** One of 2hire's own vehicle-configuration profile ids — see getTwoHireBoardProfiles(). */
  profileId: string;
}): Promise<{ vehicleId: string }> {
  const token = await getTwoHireAccessToken();
  const response = await fetch(`${getTwoHireBaseUrl()}/api/v1/vehicle/register`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${token.tokenType} ${token.value}`,
    },
    body: JSON.stringify({
      connectivityProvider: "2HIRE_BOARD",
      data: { qrCode: params.qrCode, profileId: params.profileId },
    }),
  });

  if (!response.ok) {
    throw new Error(`2hire køretøjsregistrering fejlede (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as { vehicleId: string };
}

/**
 * The e2e/simulation-only host used by createvehicle (POST /devices) and
 * simulateTrip — distinct from getTwoHireBaseUrl()'s test/production switch,
 * since simulating a device or a trip is never something a real, physical
 * vehicle needs (see starttrip's/createvehicle's own "Full Path" docs, both
 * fixed to this host regardless of VITE_DATA_SOURCE).
 */
const TWOHIRE_E2E_BASE_URL = "https://e2e.adapter.2hire.io";

/** One GPS fix in a simulated trip — see simulateTrip(). */
export type SimulatedTripPosition = { latitude: number; longitude: number };

/**
 * Feeds a simulated 2hire-board device a sequence of GPS positions, which
 * 2hire's e2e adapter plays back as real `position` signals — arriving at
 * 2hire-webhook.mts and updating vehicle_signals.lat/lng exactly as if the
 * physical vehicle had actually moved through them. Test/simulation-only:
 * there's no equivalent for a real, in-service vehicle.
 *
 * IMPORTANT — pass at least 2 positions: 2hire interpolates motion between
 * consecutive waypoints roughly every 10s and fires a webhook `position`
 * event per leg of that interpolation; a single-element `positions` array
 * has no leg to interpolate, so it updates the device's internal state
 * instantly (visible via a direct `GET /devices/{identifier}/state` call —
 * not implemented here) but never actually broadcasts a signal, so it never
 * reaches our own vehicle_signals/2hire-webhook.mts at all. Confirmed by
 * testing: a 1-position call produced no webhook event even after 30+
 * seconds; a 2-position call produced one ~10s after the call returned.
 *
 * `identifier` is the DEVICE identifier from POST /devices (createvehicle) —
 * NOT the vehicleId registerVehicle() returns. For our WB20499 test vehicle
 * that's the value stored as vehicle_profiles.iot_id (see
 * supabase/applied/register_2hire_test_vehicle.sql).
 *
 * Resolves normally on `{ success: true }`; throws otherwise — including on
 * 2hire's documented `{ success: false, cause: "VEHICLE_LOCKED" }` case
 * (2hire's own lock state, unrelated to our local virtual
 * vehicle_signals.locked flag — see set-vehicle-lock.mts's doc comment).
 *
 * Docs: https://developer.2hire.io/reference/starttrip
 */
export async function simulateTrip(identifier: string, positions: SimulatedTripPosition[]): Promise<void> {
  const token = await getTwoHireAccessToken();
  const response = await fetch(`${TWOHIRE_E2E_BASE_URL}/devices/${encodeURIComponent(identifier)}/trips`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${token.tokenType} ${token.value}`,
    },
    body: JSON.stringify({ positions }),
  });

  const result = (await response.json().catch(() => null)) as
    | { success?: boolean; code?: string; details?: { cause?: string } }
    | null;

  if (!response.ok || !result?.success) {
    const cause = result?.details?.cause ?? result?.code ?? response.status;
    throw new Error(`2hire trip-simulering fejlede (${cause}).`);
  }
}

/**
 * Sets a simulated 2hire-board device's battery/autonomy percentage —
 * unlike position, this has no relation to simulateTrip()/starttrip at all
 * (that endpoint only accepts positions and never touches battery), so it's
 * the only way to move autonomy_percentage ("Brændstofniveau") off null for
 * a simulated test vehicle. Confirmed by testing: distance_covered has no
 * equivalent setter anywhere in 2hire's docs — 2hire's own
 * GET /devices/{identifier}/state shows a distance_covered value after a
 * trip (seemingly computed internally), but it's never broadcast as a
 * webhook signal the way position is, so "Kilometerstand" has no lever we
 * can pull from our side today.
 *
 * Test/simulation-only, same e2e host as createvehicle/simulateTrip — no
 * equivalent for a real, in-service vehicle (that gets its battery level
 * from the vehicle's own real telemetry).
 *
 * Docs: https://developer.2hire.io/reference/updatebattery
 */
export async function updateBattery(identifier: string, percentage: number): Promise<void> {
  const token = await getTwoHireAccessToken();
  const response = await fetch(`${TWOHIRE_E2E_BASE_URL}/devices/${encodeURIComponent(identifier)}/state/battery`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${token.tokenType} ${token.value}`,
    },
    body: JSON.stringify({ percentage }),
  });

  const result = (await response.json().catch(() => null)) as
    | { success?: boolean; code?: string; details?: { cause?: string } }
    | null;

  if (!response.ok || !result?.success) {
    const cause = result?.details?.cause ?? result?.code ?? response.status;
    throw new Error(`2hire batteri-opdatering fejlede (${cause}).`);
  }
}
