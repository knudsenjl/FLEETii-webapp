import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  GUEST_INVALID_LINK_ERROR,
  GUEST_RATE_LIMIT,
  buildGuestEmailHtml,
  evaluateGuestAccess,
  generateGuestToken,
  guestAccessWindow,
  guestLinkUrl,
  hashGuestToken,
  isGuestRateLimited,
  isWellFormedGuestToken,
  resolveGuestRequest,
} from "./guestAccess.js";

const booking = { start: "2026-10-01T10:00:00Z", end: "2026-10-01T12:00:00Z" };
const live = { revoked_at: null, anonymized_at: null };
const at = (iso: string) => Date.parse(iso);

describe("guest token", () => {
  it("is 43 url-safe characters, unique per call, and passes the shape check", () => {
    const a = generateGuestToken();
    const b = generateGuestToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isWellFormedGuestToken(a)).toBe(true);
  });

  it("rejects malformed tokens without a lookup", () => {
    for (const bad of [undefined, null, 42, "", "short", `${generateGuestToken()}x`, "a".repeat(42) + "=", { t: 1 }]) {
      expect(isWellFormedGuestToken(bad)).toBe(false);
    }
  });

  it("hashes deterministically to hex SHA-256, never storing the token itself", () => {
    const token = generateGuestToken();
    expect(hashGuestToken(token)).toBe(hashGuestToken(token));
    expect(hashGuestToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGuestToken(token)).not.toContain(token);
    expect(hashGuestToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("puts the token in the URL fragment, not the path or query", () => {
    expect(guestLinkUrl("https://dev.fleetii.dk/", "TOKEN")).toBe("https://dev.fleetii.dk/gaest#TOKEN");
  });
});

describe("guest access window", () => {
  it("runs from start −15 min to end +30 min", () => {
    expect(guestAccessWindow(booking)).toEqual({ fromMs: at("2026-10-01T09:45:00Z"), untilMs: at("2026-10-01T12:30:00Z") });
  });

  it("is not_yet before, active inside (inclusive edges) and expired after", () => {
    expect(evaluateGuestAccess(live, booking, at("2026-10-01T09:44:59Z"))).toBe("not_yet");
    expect(evaluateGuestAccess(live, booking, at("2026-10-01T09:45:00Z"))).toBe("active");
    expect(evaluateGuestAccess(live, booking, at("2026-10-01T12:30:00Z"))).toBe("active");
    expect(evaluateGuestAccess(live, booking, at("2026-10-01T12:30:01Z"))).toBe("expired");
  });

  it("treats revoked and anonymised as revoked, even inside or before the window", () => {
    expect(evaluateGuestAccess({ revoked_at: "2026-10-01T10:30:00Z", anonymized_at: null }, booking, at("2026-10-01T11:00:00Z"))).toBe("revoked");
    expect(evaluateGuestAccess({ revoked_at: "2026-09-30T10:00:00Z", anonymized_at: null }, booking, at("2026-09-30T11:00:00Z"))).toBe("revoked");
    expect(evaluateGuestAccess({ revoked_at: null, anonymized_at: "2026-11-01T00:00:00Z" }, booking, at("2026-10-01T11:00:00Z"))).toBe("revoked");
  });

  it("never grants access to an open-ended booking", () => {
    expect(evaluateGuestAccess(live, { start: booking.start, end: null }, at("2026-10-01T11:00:00Z"))).toBe("expired");
  });
});

describe("buildGuestEmailHtml", () => {
  it("escapes every user-supplied field and links the button to the guest page", () => {
    const html = buildGuestEmailHtml({
      guestName: "<script>x</script>",
      companyLabel: "A&B",
      vehicleLabel: "AB 12 345: Tesla",
      anvendelse: "Prøvekørsel",
      start: "01.10.2026 12:00",
      end: "01.10.2026 14:00",
      linkUrl: "https://dev.fleetii.dk/gaest#abc",
      logoUrl: "https://dev.fleetii.dk/fleetii-logo.png",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A&amp;B");
    expect(html).toContain('href="https://dev.fleetii.dk/gaest#abc"');
    expect(html).toContain("Åbn køretøjet");
    expect(html).toContain('src="https://dev.fleetii.dk/fleetii-logo.png"');
    expect(html).toContain("v:roundrect"); // Outlook's oval button
  });
});

/** A minimal stand-in for the service-role client: canned results per table, recording the filters used. */
function fakeAdmin(tables: Record<string, { data?: unknown; count?: number; error?: unknown }>) {
  const calls: { table: string; filters: [string, string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      const call = { table, filters: [] as [string, string, unknown][] };
      calls.push(call);
      const result = tables[table] ?? {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: async () => ({ error: null }),
        eq: (col: string, v: unknown) => (call.filters.push(["eq", col, v]), builder),
        gte: (col: string, v: unknown) => (call.filters.push(["gte", col, v]), builder),
        maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }),
        then: (resolve: (r: unknown) => void) => resolve({ count: result.count ?? 0, error: result.error ?? null }),
      };
      return builder;
    },
  };
  return { admin: client as unknown as SupabaseClient, calls };
}

const req = new Request("https://x/.netlify/functions/guest-booking-status", {
  method: "POST",
  headers: { "x-nf-client-connection-ip": "203.0.113.7" },
});

describe("isGuestRateLimited", () => {
  it("limits at GUEST_RATE_LIMIT uses in the window, counted for this booking only", async () => {
    const under = fakeAdmin({ guest_access_log: { count: GUEST_RATE_LIMIT - 1 } });
    expect(await isGuestRateLimited(under.admin, "b1", at("2026-10-01T11:00:00Z"))).toBe(false);
    expect(under.calls[0].filters).toEqual([
      ["eq", "booking_id", "b1"],
      ["gte", "created_at", "2026-10-01T10:50:00.000Z"],
    ]);
    const over = fakeAdmin({ guest_access_log: { count: GUEST_RATE_LIMIT } });
    expect(await isGuestRateLimited(over.admin, "b1")).toBe(true);
  });
});

describe("resolveGuestRequest", () => {
  const guestRow = {
    booking_id: "b1",
    revoked_at: null,
    anonymized_at: null,
    bookings: { booking_id: "b1", vehicle_id: "v1", start: booking.start, end: booking.end, usage: "Prøvekørsel", is_guest: true, vehicle_profiles: null },
  };

  it("gives the same neutral 404 for a malformed and an unknown token", async () => {
    const { admin, calls } = fakeAdmin({});
    expect(await resolveGuestRequest(admin, req, "nope")).toEqual({ ok: false, status: 404, error: GUEST_INVALID_LINK_ERROR });
    expect(calls).toHaveLength(0);
    expect(await resolveGuestRequest(admin, req, generateGuestToken())).toEqual({ ok: false, status: 404, error: GUEST_INVALID_LINK_ERROR });
  });

  it("looks up by the token's hash, never the raw token", async () => {
    const token = generateGuestToken();
    const { admin, calls } = fakeAdmin({ booking_guests: { data: guestRow } });
    const result = await resolveGuestRequest(admin, req, token);
    expect(result.ok).toBe(true);
    expect(calls[0].filters).toEqual([["eq", "token_hash", hashGuestToken(token)]]);
    if (result.ok) expect(result.ip).toBe("203.0.113.7");
  });

  it("refuses a token whose booking isn't a drop-in", async () => {
    const { admin } = fakeAdmin({ booking_guests: { data: { ...guestRow, bookings: { ...guestRow.bookings, is_guest: false } } } });
    expect(await resolveGuestRequest(admin, req, generateGuestToken())).toMatchObject({ ok: false, status: 404 });
  });

  it("returns 429 once the booking is rate-limited", async () => {
    const { admin } = fakeAdmin({ booking_guests: { data: guestRow }, guest_access_log: { count: GUEST_RATE_LIMIT } });
    expect(await resolveGuestRequest(admin, req, generateGuestToken())).toMatchObject({ ok: false, status: 429 });
  });
});
