// The one way the browser calls a Netlify Function (netlify/functions/*.mts).
// Every page used to hand-roll the same fetch: build "/.netlify/functions/…",
// copy the session's access token into an Authorization header, set
// Content-Type, then parse the JSON reply defensively — 31 copies (code
// review 2026-09-26). This does exactly that and nothing more: callers keep
// their own error messages and flow, so behaviour doesn't change.
//
// The access token is read fresh from the Supabase client at call time
// (getSession), not threaded through from AuthContext, so callers no longer
// need `session` just to call a Function — and a token Supabase has just
// refreshed is used instead of a possibly stale copy. A logged-out caller
// (the public /gaest page) simply sends no Authorization header.
import { supabase } from "./supabase";

/** What callFunction resolves to: the HTTP outcome plus the parsed JSON body ({} when the body wasn't JSON). */
export type FunctionResponse<T> = {
  ok: boolean;
  status: number;
  /** The parsed reply. On failure it's usually `{ error: "…" }` (every Function's error shape). */
  data: T & { error?: string };
};

export type CallFunctionOptions = {
  /** Defaults to "POST" when a body is given, else "GET". */
  method?: "GET" | "POST";
  /** JSON-serialized as the request body. */
  body?: unknown;
  /** Appended as a URL query string (values are encoded). */
  query?: Record<string, string>;
};

/**
 * Calls /.netlify/functions/`name` as the currently logged-in user. Resolves
 * for every HTTP status — check `ok` — and only rejects when the request
 * couldn't be made at all (network error), exactly like fetch() itself, so
 * existing try/catch blocks keep working unchanged.
 */
export async function callFunction<T = Record<string, unknown>>(
  name: string,
  { method, body, query }: CallFunctionOptions = {},
): Promise<FunctionResponse<T>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  const queryString = query ? `?${new URLSearchParams(query).toString()}` : "";
  const response = await fetch(`/.netlify/functions/${name}${queryString}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  return { ok: response.ok, status: response.status, data: data ?? ({} as T & { error?: string }) };
}
