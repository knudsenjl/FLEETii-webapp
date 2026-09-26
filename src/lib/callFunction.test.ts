import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sessionToken: string | null = "tok";
vi.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: sessionToken ? { access_token: sessionToken } : null } }) },
  },
}));

import { callFunction } from "./callFunction";

const calls: { url: string; init: RequestInit }[] = [];
beforeEach(() => {
  calls.length = 0;
  sessionToken = "tok";
});
afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: string) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  });
}

describe("callFunction", () => {
  it("POSTs JSON with the current session's bearer token", async () => {
    stubFetch(200, '{"ok":true}');
    const result = await callFunction<{ ok: boolean }>("finish-booking", { body: { bookingId: "b1" } });
    expect(result).toEqual({ ok: true, status: 200, data: { ok: true } });
    expect(calls[0].url).toBe("/.netlify/functions/finish-booking");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe('{"bookingId":"b1"}');
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer tok" });
  });

  it("GETs with an encoded query string and no body when none is given", async () => {
    stubFetch(200, "{}");
    await callFunction("motorapi-vehicle-lookup", { query: { regNo: "AB 12&3" } });
    expect(calls[0].url).toBe("/.netlify/functions/motorapi-vehicle-lookup?regNo=AB+12%263");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("sends no Authorization header when logged out", async () => {
    sessionToken = null;
    stubFetch(200, "{}");
    await callFunction("guest-booking-status", { body: { token: "x" } });
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("resolves (not rejects) on an error status, with the Function's error message", async () => {
    stubFetch(403, '{"error":"Nej."}');
    expect(await callFunction("x", { body: {} })).toEqual({ ok: false, status: 403, data: { error: "Nej." } });
  });

  it("falls back to an empty object when the reply isn't JSON", async () => {
    stubFetch(502, "Bad Gateway");
    expect(await callFunction("x")).toEqual({ ok: false, status: 502, data: {} });
  });
});
