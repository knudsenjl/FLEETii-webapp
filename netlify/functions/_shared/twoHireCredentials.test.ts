import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { resolveTwoHireCredentials, TwoHireNotConfiguredError, twoHireErrorStatus } from "./twoHireCredentials.js";

/** A service-role client stand-in whose costumers lookup returns `row`. */
function fakeAdmin(row: Record<string, string | null> | null, error: { message: string } | null = null): SupabaseClient {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error }) };
  return { from: () => chain } as unknown as SupabaseClient;
}

describe("resolveTwoHireCredentials", () => {
  it("returns the costumer's own credentials when both are set", async () => {
    const admin = fakeAdmin({ name: "Alpha", twohire_client_id: "id", twohire_client_secret: "secret" });
    await expect(resolveTwoHireCredentials(admin, { costumerId: "alpha" })).resolves.toEqual({ clientId: "id", clientSecret: "secret" });
  });

  it("throws TwoHireNotConfiguredError (-> 409) when the costumer has no credentials", async () => {
    const admin = fakeAdmin({ name: "Alpha", twohire_client_id: null, twohire_client_secret: null });
    const error = await resolveTwoHireCredentials(admin, { costumerId: "alpha" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TwoHireNotConfiguredError);
    expect(twoHireErrorStatus(error)).toBe(409);
  });

  it("throws TwoHireNotConfiguredError (-> 409) when there's no costumer at all", async () => {
    const error = await resolveTwoHireCredentials(fakeAdmin(null), { costumerId: null }).catch((e: unknown) => e);
    expect(twoHireErrorStatus(error)).toBe(409);
  });

  it("treats a failed DB lookup as a plain error (-> 502), not a configuration problem", async () => {
    const error = await resolveTwoHireCredentials(fakeAdmin(null, { message: "boom" }), { costumerId: "alpha" }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(TwoHireNotConfiguredError);
    expect(twoHireErrorStatus(error)).toBe(502);
  });
});

describe("twoHireErrorStatus", () => {
  it("maps any other error (2hire itself failing) to 502", () => {
    expect(twoHireErrorStatus(new Error('2hire "stop"-kommando fejlede (500).'))).toBe(502);
  });
});
