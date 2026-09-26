// fetch() with a deadline, for every call a Netlify Function makes to an
// outside service (2hire, MotorAPI, cvrapi.dk, Geoapify). Plain fetch() has
// no timeout at all, so one hung upstream used to hold the Function until
// Netlify killed it at its own limit (10 s by default) — the caller then got
// a bare platform error instead of a Danish message (code review 2026-09-26).
// Callers keep their own error handling; a timeout just arrives as a normal
// Error with a readable message.

/** Default deadline for one outside request. Below Netlify's 10 s Function limit so there's time left to answer the browser. */
export const EXTERNAL_FETCH_TIMEOUT_MS = 8000;

/**
 * fetch(), aborted after `timeoutMs`. `label` names the service in the
 * timeout error ("2hire svarede ikke inden for 8 sekunder."). Any other
 * failure (network error, a caller-supplied signal) is rethrown unchanged.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit & { label: string; timeoutMs?: number },
): Promise<Response> {
  const { label, timeoutMs = EXTERNAL_FETCH_TIMEOUT_MS, ...requestInit } = init;
  try {
    return await fetch(input, { ...requestInit, signal: requestInit.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`${label} svarede ikke inden for ${Math.round(timeoutMs / 1000)} sekunder.`);
    }
    throw error;
  }
}
