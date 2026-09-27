import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isConfirmedSeedRequest, testDataDatabaseBlocked, testDataEnvironmentBlocked } from "./testDataGuard.js";

const STAGING_URL = "https://owbbihnbocuczbdogzxv.supabase.co";
const PRODUCTION_URL = "https://adjnqjziyblusrruqigt.supabase.co";
const PRODUCTION_SITE_ID = "ae77d3e5-f334-44f1-aa47-d33cd231681b";
const STAGING_SITE_ID = "e9355e98-12a5-4002-b027-eb34014f7885";

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SITE_ID;
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("testDataEnvironmentBlocked", () => {
  it("allows the staging site on the staging database", () => {
    process.env.SITE_ID = STAGING_SITE_ID;
    process.env.SUPABASE_URL = STAGING_URL;
    expect(testDataEnvironmentBlocked()).toBeNull();
  });

  it("refuses the production site, even if it pointed at the staging database", () => {
    process.env.SITE_ID = PRODUCTION_SITE_ID;
    process.env.SUPABASE_URL = STAGING_URL;
    expect(testDataEnvironmentBlocked()?.status).toBe(403);
  });

  it("refuses the production database, on any site", () => {
    process.env.SITE_ID = STAGING_SITE_ID;
    process.env.SUPABASE_URL = PRODUCTION_URL;
    expect(testDataEnvironmentBlocked()?.status).toBe(403);
  });

  it("refuses when the database URL is missing or unparsable", () => {
    expect(testDataEnvironmentBlocked()?.status).toBe(403);
    process.env.SUPABASE_URL = "not a url";
    expect(testDataEnvironmentBlocked()?.status).toBe(403);
  });

  it("refuses a look-alike host", () => {
    process.env.SUPABASE_URL = "https://owbbihnbocuczbdogzxv.supabase.co.evil.example";
    expect(testDataEnvironmentBlocked()?.status).toBe(403);
  });

  it("uses VITE_SUPABASE_URL only when SUPABASE_URL is unset, like the admin client", () => {
    process.env.VITE_SUPABASE_URL = STAGING_URL;
    expect(testDataEnvironmentBlocked()).toBeNull();
    process.env.SUPABASE_URL = PRODUCTION_URL;
    expect(testDataEnvironmentBlocked()?.status).toBe(403);
  });
});

describe("testDataDatabaseBlocked", () => {
  const clientReturning = (result: { data: unknown; error: unknown }) =>
    ({ rpc: vi.fn().mockResolvedValue(result) }) as unknown as SupabaseClient;

  it("allows a database that confirms it is staging", async () => {
    expect(await testDataDatabaseBlocked(clientReturning({ data: true, error: null }))).toBeNull();
  });

  it("refuses when the marker function is missing (production)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const blocked = await testDataDatabaseBlocked(
      clientReturning({ data: null, error: { message: "function fleetii_is_staging_database() does not exist" } }),
    );
    expect(blocked?.status).toBe(403);
  });

  it("refuses anything but a literal true", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await testDataDatabaseBlocked(clientReturning({ data: "true", error: null })))?.status).toBe(403);
    expect((await testDataDatabaseBlocked(clientReturning({ data: false, error: null })))?.status).toBe(403);
  });
});

describe("isConfirmedSeedRequest", () => {
  it("accepts only { confirmed: true }", () => {
    expect(isConfirmedSeedRequest({ confirmed: true })).toBe(true);
    expect(isConfirmedSeedRequest({ confirmed: "true" })).toBe(false);
    expect(isConfirmedSeedRequest({})).toBe(false);
    expect(isConfirmedSeedRequest(null)).toBe(false);
  });
});
