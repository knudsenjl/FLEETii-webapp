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
