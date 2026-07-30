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
 * `profileId` expects. CONFIRMED shape (developer.2hire.io/reference/
 * getpublicprofilelist-1's own example response, clicked directly on the
 * docs page — id values are UUIDs matching the format a real
 * registerVehicle() call genuinely returned in this project's own testing,
 * see register_2hire_test_vehicle.sql): { id, title, description, makerName,
 * modelName, modelYearRange }. Still typed loosely (Record<string, unknown>)
 * rather than asserting every field, since only id/title are actually used.
 * Docs: https://developer.2hire.io/reference/getpublicprofilelist-1
 */
export type TwoHireBoardProfile = Record<string, unknown>;

/** Lists the 2hire-board vehicle-configuration profiles available to pick a `profileId` from for registerVehicle(). The confirmed real response shape wraps the array as {profiles: [...]} (see TwoHireBoardProfile's own doc comment) — a bare array is also accepted defensively, though not known to actually occur. */
export async function getTwoHireBoardProfiles(): Promise<TwoHireBoardProfile[]> {
  const token = await getTwoHireAccessToken();
  const response = await fetch(`${getTwoHireBaseUrl()}/api/v1/connectivity-provider/2hire-board/profile`, {
    headers: { Authorization: `${token.tokenType} ${token.value}` },
  });

  if (!response.ok) {
    throw new Error(`Kunne ikke hente 2hire-profiler (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as TwoHireBoardProfile[] | { profiles?: TwoHireBoardProfile[] };
  return Array.isArray(body) ? body : (body.profiles ?? []);
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
 * Deregisters a vehicle from 2hire — PUT /api/v1/vehicle/deregister, body
 * {vehicleId}. Inverse of registerVehicle(); same host/auth pattern and
 * response.ok-only check (this endpoint doesn't return the {success,cause}
 * shape sendGenericCommand's does). Called best-effort from
 * delete-vehicle.mts alongside delete_vehicle() (SQL) — most vehicles were
 * never actually registered with 2hire in the first place, so a failure
 * here shouldn't block removing the vehicle from our own DB.
 *
 * Docs: https://developer.2hire.io/reference/putderegistervehicle
 */
export async function deregisterVehicle(vehicleId: string): Promise<void> {
  const token = await getTwoHireAccessToken();
  const response = await fetch(`${getTwoHireBaseUrl()}/api/v1/vehicle/deregister`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${token.tokenType} ${token.value}`,
    },
    body: JSON.stringify({ vehicleId }),
  });

  if (!response.ok) {
    throw new Error(`2hire afregistrering fejlede (${response.status}): ${await response.text()}`);
  }
}

/**
 * The e2e/simulation-only host used by createvehicle (POST /devices) and
 * simulateTrip — distinct from getTwoHireBaseUrl()'s test/production switch,
 * since simulating a device or a trip is never something a real, physical
 * vehicle needs (see starttrip's/createvehicle's own "Full Path" docs, both
 * fixed to this host regardless of VITE_DATA_SOURCE).
 */
const TWOHIRE_E2E_BASE_URL = "https://e2e.adapter.2hire.io";

/**
 * The one fixed profileId that MUST be used when registering a SIMULATED
 * device (createSimulatedDevice() below) with registerVehicle() — per
 * 2hire's own "Guide to test..." documentation: "In order to configure
 * simulators, the profile id 51ba5b28-28da-435a-b42e-a3931288470c need to
 * be used." This is unrelated to getTwoHireBoardProfiles()'s real
 * make/model profiles (Fiat 500, etc.) — those are for registering a REAL
 * physical device (VehicleCreatePage.tsx's flow) and picking one of them
 * for a simulated device instead causes 2hire to reject later generic
 * commands with MISSING_CONFIGURATION (confirmed live, migrating CN61538 —
 * the bulk-migration code originally, mistakenly, best-effort-matched
 * against the real board-profile list here).
 */
export const TWOHIRE_SIMULATOR_PROFILE_ID = "51ba5b28-28da-435a-b42e-a3931288470c";

/**
 * Creates a simulated 2hire-board device on the e2e host — POST /devices,
 * connectivityProvider "2HIRE_BOARD" (same variant registerVehicle() uses).
 * CONFIRMED real response shape (developer.2hire.io/reference/createvehicle's
 * own example, clicked directly on the docs page): { devices: [{identifier,
 * qrCode}] } — an array (presumably this endpoint can create more than one
 * device per call), not a bare object; only the first entry is used here
 * since exactly one device is requested. Returns the device `identifier`
 * (what simulateTrip/updateBattery/getDeviceState key on — this becomes
 * vehicle_profiles.iot_id) and `qrCode` (what registerVehicle() then needs
 * to actually register this simulated device against test.adapter.2hire.io
 * and get a real vehicleId). Test/simulation-only — a real physical device
 * already has both values printed/assigned, there's nothing to "create" for
 * one.
 *
 * Docs: https://developer.2hire.io/reference/createvehicle
 */
export async function createSimulatedDevice(): Promise<{ identifier: string; qrCode: string }> {
  const token = await getTwoHireAccessToken();
  const response = await fetch(`${TWOHIRE_E2E_BASE_URL}/devices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${token.tokenType} ${token.value}`,
    },
    body: JSON.stringify({ connectivityProvider: "2HIRE_BOARD" }),
  });

  if (!response.ok) {
    throw new Error(`2hire simuleret device-oprettelse fejlede (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as { devices?: { identifier: string; qrCode: string }[] };
  const device = body.devices?.[0];
  if (!device) {
    throw new Error("2hire simuleret device-oprettelse gav ikke noget device tilbage.");
  }
  return device;
}

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
 * instantly (visible via a direct `getDeviceState()` call) but never
 * actually broadcasts a signal, so it never reaches our own
 * vehicle_signals/2hire-webhook.mts at all. Confirmed by
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

/** The three generic commands every 2hire-compatible vehicle supports — see sendGenericCommand. */
export type TwoHireGenericCommand = "start" | "stop" | "locate";

/**
 * Sends a generic vehicle command — POST
 * /api/v1/vehicle/{vehicleId}/command/generic/{command} against the real
 * adapter host (getTwoHireBaseUrl, not the e2e simulation host — this is the
 * same call a real, in-service vehicle receives). Parameterized by
 * `command` rather than one function per command so "start"/"stop" (real
 * lock/unlock — currently deferred, see set-vehicle-lock.mts's doc comment)
 * can reuse this exact wrapper once wired up, instead of duplicating the
 * request/response handling for a third command later. `vehicleId` is
 * 2hire's own real vehicleId (registerVehicle's return value / this fleet's
 * vehicle_profiles.vehicle_id), not the e2e device identifier.
 *
 * Docs: https://developer.2hire.io/reference/commandgeneric
 */
export async function sendGenericCommand(vehicleId: string, command: TwoHireGenericCommand): Promise<void> {
  const token = await getTwoHireAccessToken();
  const response = await fetch(
    `${getTwoHireBaseUrl()}/api/v1/vehicle/${encodeURIComponent(vehicleId)}/command/generic/${command}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `${token.tokenType} ${token.value}`,
      },
      body: JSON.stringify({}),
    },
  );

  const result = (await response.json().catch(() => null)) as
    | { success?: boolean; code?: string; details?: { cause?: string } }
    | null;

  if (!response.ok || !result?.success) {
    const cause = result?.details?.cause ?? result?.code ?? response.status;
    throw new Error(`2hire "${command}"-kommando fejlede (${cause}).`);
  }
}

/**
 * A device's current state as reported by 2hire — see getDeviceState().
 * `status` is the field that matters for lock display: observed values are
 * "LOCKED", "UNLOCKED", and "MOVING" (set by simulateTrip's first waypoint —
 * see its own doc comment). The other fields are included since they're
 * already in 2hire's response and may be useful later (e.g. for
 * distance_covered/autonomy_percentage, which don't reach our webhook — see
 * updateBattery's doc comment) — nothing here reads them today.
 */
export type TwoHireDeviceState = {
  status: string;
  position?: { timestamp: number; data: { latitude: number; longitude: number } };
  online?: { timestamp: number; data: { online: boolean } };
  autonomy_percentage?: { timestamp: number; data: { percentage: number } };
  distance_covered?: { timestamp: number; data: { meters: number } };
};

/**
 * Reads a simulated 2hire-board device's current state — GET
 * /devices/{identifier}/state, e2e host (same reasoning as
 * simulateTrip/updateBattery: this is a simulation-only endpoint, no
 * equivalent for a real, in-service vehicle). Used to read back the real
 * `status` ("LOCKED"/"UNLOCKED") after a sendGenericCommand("start"/"stop")
 * call, rather than assuming the command did what it asked.
 *
 * Docs: https://developer.2hire.io/reference/getdevicestate
 */
export async function getDeviceState(identifier: string): Promise<TwoHireDeviceState> {
  const token = await getTwoHireAccessToken();
  const response = await fetch(`${TWOHIRE_E2E_BASE_URL}/devices/${encodeURIComponent(identifier)}/state`, {
    headers: { Authorization: `${token.tokenType} ${token.value}` },
  });

  if (!response.ok) {
    throw new Error(`Kunne ikke hente køretøjets 2hire-status (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as TwoHireDeviceState;
}
