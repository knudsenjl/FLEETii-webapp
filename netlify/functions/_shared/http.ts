// The JSON response every Netlify Function returns. Each Function used to
// spell out `new Response(JSON.stringify(body), { status, headers })` by
// hand — 257 times across the Functions, a few of them with their own local
// json() copy (code review 2026-09-26). This is that one line, in one place.
// It always sets Content-Type: application/json, which the hand-written
// error responses mostly left out.

/** A JSON Response with `status` (default 200). */
export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
