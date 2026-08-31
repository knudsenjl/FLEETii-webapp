// Shared client for 2hire's Adapter API (https://developer.2hire.io). Used by
// netlify/functions/2hire-subscribe.mts to authenticate and register our
// webhook subscription, plus every other 2hire-calling Function. All
// endpoints are identical between environments — only the host differs — so
// this reads the same VITE_DATA_SOURCE value the client build uses to pick
// mock vs. live (Netlify injects the same env vars into both the client
// build and Functions), rather than a second, separate server-only switch.
// Credentials themselves never reach the client bundle: this file only runs
// inside Netlify Functions.
//
// Per-costumer credentials (production sub-accounts — see the "Per-costumer
// 2hire credentials" plan): this file no longer assumes ONE fixed
// TWOHIRE_CLIENT_ID/SECRET for the whole process. Every function that
// authenticates now takes a TwoHireCredentials parameter instead of reading
// process.env directly — WHICH credential to pass is decided one layer up,
// by _shared/twoHireCredentials.ts's resolveTwoHireCredentials() (costumer
// sub-account vs. the global/FLEETii-admin credential vs. test mode).
// getDeviceState() at the bottom of this file is the one exception — it has
// no per-costumer concept at all (test tooling only) and always uses
// getGlobalCredentials() itself.

/** Picks the 2hire host based on VITE_DATA_SOURCE: "2hire-production-adaptor" -> the real fleet; anything else (e.g. "2hire-test-adaptor") -> the test/simulated environment, the safe default. */
export function getTwoHireBaseUrl(): string {
  return process.env.VITE_DATA_SOURCE === "2hire-production-adaptor"
    ? "https://adapter.2hire.io"
    : "https://test.adapter.2hire.io";
}

/** One 2hire sub-account's (or the global FLEETii account's) client_id/client_secret — see resolveTwoHireCredentials() in _shared/twoHireCredentials.ts for how the right one gets picked for a given operation. */
export type TwoHireCredentials = { clientId: string; clientSecret: string };

/** The single global/FLEETii-admin credential, read from TWOHIRE_CLIENT_ID/SECRET — used directly in test mode (everyone shares it) and, in production, only for a FLEETii-admin-initiated operation (see resolveTwoHireCredentials). This is the ONLY remaining place in the codebase that reads these two env vars. */
export function getGlobalCredentials(): TwoHireCredentials {
  const clientId = process.env.TWOHIRE_CLIENT_ID;
  const clientSecret = process.env.TWOHIRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Serveren mangler TWOHIRE_CLIENT_ID/TWOHIRE_CLIENT_SECRET.");
  }
  return { clientId, clientSecret };
}

type CachedToken = {
  value: string;
  tokenType: string;
  expiresAt: number; // ms since epoch
};

/** One cached token per credential set, keyed by clientId — a single bare variable would either leak one costumer's token into another costumer's calls, or thrash on every request once more than one credential set is in play. */
const tokenCache = new Map<string, CachedToken>();

function isExpired(token: CachedToken): boolean {
  // Refresh a bit early so a request doesn't race the real expiry.
  return Date.now() >= token.expiresAt - 30_000;
}

async function requestNewToken(credentials: TwoHireCredentials): Promise<CachedToken> {
  const response = await fetch(`${getTwoHireBaseUrl()}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: credentials.clientId, clientSecret: credentials.clientSecret }),
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

/** Returns a cached 2hire access token for the given credential set, fetching a new one if missing or expired. */
export async function getTwoHireAccessToken(credentials: TwoHireCredentials): Promise<CachedToken> {
  const cached = tokenCache.get(credentials.clientId);
  if (!cached || isExpired(cached)) {
    const fresh = await requestNewToken(credentials);
    tokenCache.set(credentials.clientId, fresh);
    return fresh;
  }
  return cached;
}

/**
 * Subscribes `callbackUrl` to one of 2hire's wildcard webhook topics (e.g.
 * "vehicle:*:generic:*" or "vehicle:*:specific:*") for every vehicle in one
 * call. 2hire will first GET `callbackUrl` with a `hub.challenge` to confirm
 * it (see 2hire-webhook.mts), then POST signed signal updates to it going
 * forward. Shared by subscribeToGenericSignals/subscribeToSpecificSignals
 * below — same request shape, only the topic differs.
 */
async function subscribeToWebhookTopic(
  topic: string,
  callbackUrl: string,
  credentials: TwoHireCredentials,
): Promise<void> {
  const secret = process.env.TWOHIRE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Serveren mangler TWOHIRE_WEBHOOK_SECRET.");
  }

  const token = await getTwoHireAccessToken(credentials);
  const response = await fetch(`${getTwoHireBaseUrl()}/api/v1/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${token.tokenType} ${token.value}`,
    },
    body: JSON.stringify({
      "hub.mode": "subscribe",
      "hub.topic": topic,
      "hub.callback": callbackUrl,
      "hub.secret": secret,
    }),
  });

  if (!response.ok) {
    throw new Error(`2hire webhook-abonnement fejlede (${response.status}): ${await response.text()}`);
  }
}

/** Subscribes to every generic signal (online, position, distance_covered, autonomy_percentage, ...) for every vehicle — see subscribeToWebhookTopic. */
export async function subscribeToGenericSignals(callbackUrl: string, credentials: TwoHireCredentials): Promise<void> {
  return subscribeToWebhookTopic("vehicle:*:generic:*", callbackUrl, credentials);
}

/** Subscribes to every model/OEM-specific signal for every vehicle (2hire's "vehicle:*:specific:*" topic — signal names and payload shapes vary by vehicle profile, unlike the fixed generic vocabulary) — see subscribeToWebhookTopic and 2hire-webhook.mts's handling of the "specific" topic kind. */
export async function subscribeToSpecificSignals(callbackUrl: string, credentials: TwoHireCredentials): Promise<void> {
  return subscribeToWebhookTopic("vehicle:*:specific:*", callbackUrl, credentials);
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
export async function getTwoHireBoardProfiles(credentials: TwoHireCredentials): Promise<TwoHireBoardProfile[]> {
  const token = await getTwoHireAccessToken(credentials);
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
export async function registerVehicle(
  params: {
    /** The QR code printed on the physical 2hire-board device being onboarded (see createvehicle/POST /devices for how a *simulated* device's QR code is generated in the e2e test environment — a real physical unit already has one). */
    qrCode: string;
    /** One of 2hire's own vehicle-configuration profile ids — see getTwoHireBoardProfiles(). */
    profileId: string;
  },
  credentials: TwoHireCredentials,
): Promise<{ vehicleId: string }> {
  const token = await getTwoHireAccessToken(credentials);
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
export async function deregisterVehicle(vehicleId: string, credentials: TwoHireCredentials): Promise<void> {
  const token = await getTwoHireAccessToken(credentials);
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
 * getDeviceState — distinct from getTwoHireBaseUrl()'s test/production
 * switch, since simulating a device is never something a real, physical
 * vehicle needs (see starttrip's/createvehicle's own "Full Path" docs, both
 * fixed to this host regardless of VITE_DATA_SOURCE).
 */
const TWOHIRE_E2E_BASE_URL = "https://e2e.adapter.2hire.io";

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
export async function sendGenericCommand(
  vehicleId: string,
  command: TwoHireGenericCommand,
  credentials: TwoHireCredentials,
): Promise<void> {
  const token = await getTwoHireAccessToken(credentials);
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
 * "LOCKED", "UNLOCKED", and "MOVING". The other fields are included since
 * they're already in 2hire's response and may be useful later (e.g. for
 * distance_covered/autonomy_percentage, which don't reach our webhook) —
 * nothing here reads them today.
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
 * /devices/{identifier}/state, e2e host: this is a simulation-only
 * endpoint, no equivalent for a real, in-service vehicle. Used to read back
 * the real `status` ("LOCKED"/"UNLOCKED") after a
 * sendGenericCommand("start"/"stop") call, rather than assuming the command
 * did what it asked.
 *
 * Docs: https://developer.2hire.io/reference/getdevicestate
 */
export async function getDeviceState(identifier: string): Promise<TwoHireDeviceState> {
  const token = await getTwoHireAccessToken(getGlobalCredentials());
  const response = await fetch(`${TWOHIRE_E2E_BASE_URL}/devices/${encodeURIComponent(identifier)}/state`, {
    headers: { Authorization: `${token.tokenType} ${token.value}` },
  });

  if (!response.ok) {
    throw new Error(`Kunne ikke hente køretøjets 2hire-status (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as TwoHireDeviceState;
}
