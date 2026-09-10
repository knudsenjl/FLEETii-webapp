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
// sub-account vs. the global/sysadm credential vs. test mode).
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

/** The single global/sysadm credential, read from TWOHIRE_CLIENT_ID/SECRET — used directly in test mode (everyone shares it) and, in production, only for a sysadm-initiated operation (see resolveTwoHireCredentials). This is the ONLY remaining place in the codebase that reads these two env vars. */
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
 * Subscribes or unsubscribes `callbackUrl` for one of 2hire's wildcard
 * webhook topics (e.g. "vehicle:*:generic:*" or "vehicle:*:specific:*") for
 * every vehicle in one call. On subscribe, 2hire will first GET
 * `callbackUrl` with a `hub.challenge` to confirm it (see 2hire-webhook.mts),
 * then POST signed signal updates to it going forward. Shared by every
 * subscribeTo.../unsubscribeFrom... function below — same request shape,
 * only hub.mode/topic differ.
 *
 * unsubscribe exists because of a 2026-09-10 production investigation: a
 * significant fraction of live deliveries were failing signature validation
 * while the SAME underlying reading (identical signal_timestamp) landed
 * successfully seconds later — consistent with more than one webhook
 * registration existing for the same topic+callback (e.g. from calling
 * subscribe more than once over this app's life without ever
 * unsubscribing first), each still signing with whatever secret was current
 * when IT was created. 2hire-subscribe.mts now unsubscribes before every
 * subscribe to collapse any such accumulated duplicates back down to one.
 */
async function setWebhookSubscription(
  mode: "subscribe" | "unsubscribe",
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
      "hub.mode": mode,
      "hub.topic": topic,
      "hub.callback": callbackUrl,
      "hub.secret": secret,
    }),
  });

  if (!response.ok) {
    const action = mode === "subscribe" ? "abonnement" : "afmelding";
    throw new Error(`2hire webhook-${action} fejlede (${response.status}): ${await response.text()}`);
  }
}

/** Subscribes to every generic signal (online, position, distance_covered, autonomy_percentage, ...) for every vehicle — see setWebhookSubscription. */
export async function subscribeToGenericSignals(callbackUrl: string, credentials: TwoHireCredentials): Promise<void> {
  return setWebhookSubscription("subscribe", "vehicle:*:generic:*", callbackUrl, credentials);
}

/**
 * Subscribes to the "trip_detected" model/OEM-specific signal for every
 * vehicle. NOT a blanket "every specific signal" subscription — confirmed
 * 2026-09-10 that 2hire's own hub.topic validation has no wildcard for the
 * "specific:" branch (unlike "generic:", which explicitly allows "*"): a
 * "vehicle:*:specific:*" subscription always 400s with BAD_FORMAT, for
 * every costumer, every time. 2hire's own docs confirm trip_detected
 * specifically IS a genuine "specific" (not generic) signal, despite
 * vehicle_signals_add_trip_detected.sql's now-outdated assumption that it
 * was generic — so it has to be named explicitly here rather than covered
 * by subscribeToGenericSignals. If more specific signals are ever needed,
 * each has to be subscribed by its own exact name the same way; there is no
 * way to subscribe to "every specific signal" in one call.
 */
export async function subscribeToSpecificSignals(callbackUrl: string, credentials: TwoHireCredentials): Promise<void> {
  return setWebhookSubscription("subscribe", "vehicle:*:specific:trip_detected", callbackUrl, credentials);
}

/** Unsubscribes the generic-signals topic — see setWebhookSubscription's own doc comment for why this now runs before every (re-)subscribe. */
export async function unsubscribeFromGenericSignals(callbackUrl: string, credentials: TwoHireCredentials): Promise<void> {
  return setWebhookSubscription("unsubscribe", "vehicle:*:generic:*", callbackUrl, credentials);
}

/** Unsubscribes the "trip_detected" specific-signal topic — see subscribeToSpecificSignals and setWebhookSubscription's own doc comments. */
export async function unsubscribeFromSpecificSignals(callbackUrl: string, credentials: TwoHireCredentials): Promise<void> {
  return setWebhookSubscription("unsubscribe", "vehicle:*:specific:trip_detected", callbackUrl, credentials);
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

/** One point-in-time signal reading as 2hire's signal-read endpoints return it — same {data, timestamp} shape a webhook delivery's payload has (see 2hire-webhook.mts). */
export type TwoHireSignalReading = { data: Record<string, unknown>; timestampMs: number };

/**
 * Reads one signal's current value directly (as opposed to waiting for a
 * webhook delivery) — GET /api/v1/vehicle/{vehicleId}/signal/{generic|
 * specific}/{signal}. Used right after 2hire-register-vehicle.mts registers
 * a brand-new vehicle, to seed vehicle_signals_latest/vehicle_signal_history
 * immediately instead of waiting for 2hire's first webhook delivery (which
 * may not arrive until the vehicle actually moves/reports again). Returns
 * null on a 404 — 2hire has no reading for this vehicle+signal yet, which is
 * expected right after registration for signals like distance_covered that
 * only get a value once the vehicle has actually driven.
 */
async function fetchVehicleSignal(
  vehicleId: string,
  kind: "generic" | "specific",
  signal: string,
  credentials: TwoHireCredentials,
): Promise<TwoHireSignalReading | null> {
  const token = await getTwoHireAccessToken(credentials);
  const response = await fetch(
    `${getTwoHireBaseUrl()}/api/v1/vehicle/${encodeURIComponent(vehicleId)}/signal/${kind}/${encodeURIComponent(signal)}`,
    { headers: { Authorization: `${token.tokenType} ${token.value}` } },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`2hire signal-opslag (${kind}/${signal}) fejlede (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as { data?: Record<string, unknown>; timestamp?: number };
  if (!body.data || typeof body.timestamp !== "number") {
    throw new Error(`Uventet svarformat fra 2hire for ${kind}/${signal}: ${JSON.stringify(body)}`);
  }
  return { data: body.data, timestampMs: body.timestamp };
}

/** Reads one GENERIC signal's current value directly — see fetchVehicleSignal. */
export async function fetchGenericVehicleSignal(
  vehicleId: string,
  signal: string,
  credentials: TwoHireCredentials,
): Promise<TwoHireSignalReading | null> {
  return fetchVehicleSignal(vehicleId, "generic", signal, credentials);
}

/** Reads one SPECIFIC (model/OEM-specific) signal's current value directly — see fetchVehicleSignal. */
export async function fetchSpecificVehicleSignal(
  vehicleId: string,
  signal: string,
  credentials: TwoHireCredentials,
): Promise<TwoHireSignalReading | null> {
  return fetchVehicleSignal(vehicleId, "specific", signal, credentials);
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
