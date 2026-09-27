import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./twoHireClient.js", () => ({ sendGenericCommand: vi.fn() }));
vi.mock("./twoHireCredentials.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./twoHireCredentials.js")>()),
  resolveTwoHireCredentials: vi.fn(async () => ({ clientId: "id", clientSecret: "secret" })),
}));

import { sendGenericCommand } from "./twoHireClient.js";
import { TwoHireNotConfiguredError, resolveTwoHireCredentials } from "./twoHireCredentials.js";
import {
  anyOwnBookingAllows,
  loadLockContext,
  lockStateForBooking,
  sendAndRecordLock,
  type LockContext,
  type VehicleBooking,
} from "./vehicleLock.js";

const mine: VehicleBooking = { booking_id: "b2", start: "2026-07-09T09:00:00Z", end: "2026-07-09T12:00:00Z", user_id: "me" };
const before: VehicleBooking = { booking_id: "b1", start: "2026-07-09T07:00:00Z", end: "2026-07-09T09:30:00Z", user_id: "other" };
const context: LockContext = { bookings: [mine, before], currentLocked: true };
const isMine = (b: VehicleBooking) => b.user_id === "me";

describe("lockStateForBooking", () => {
  it("uses the context's own neighbours: unlock blocked while the previous booking is still running", () => {
    expect(lockStateForBooking(context, mine, "2026-07-09T09:15:00Z")).toEqual({ lockEnabled: true, unlockEnabled: false });
  });

  it("enables unlock once the previous booking has ended", () => {
    expect(lockStateForBooking(context, mine, "2026-07-09T10:00:00Z")).toEqual({ lockEnabled: true, unlockEnabled: true });
  });
});

describe("anyOwnBookingAllows", () => {
  it("allows only inside the caller's own booking window", () => {
    const unlock = (s: { unlockEnabled: boolean }) => s.unlockEnabled;
    expect(anyOwnBookingAllows(context, isMine, unlock, "2026-07-09T10:00:00Z")).toBe(true);
    expect(anyOwnBookingAllows(context, isMine, unlock, "2026-07-09T08:00:00Z")).toBe(false);
    expect(anyOwnBookingAllows(context, isMine, unlock, "2026-07-09T12:00:00Z")).toBe(false);
  });

  it("never authorizes on someone else's booking", () => {
    expect(anyOwnBookingAllows(context, (b) => b.user_id === "nobody", () => true)).toBe(false);
  });
});

/** A service-role client stand-in: every select resolves to `selectResult`, and insert/rpc resolve with the given errors. */
function fakeAdmin(opts: {
  selectResult?: { data: unknown; error: { message: string } | null };
  insertError?: { message: string } | null;
  rpcError?: { message: string } | null;
} = {}) {
  const selectResult = opts.selectResult ?? { data: null, error: null };
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => selectResult,
    returns: async () => selectResult,
  };
  const insert = vi.fn(async () => ({ error: opts.insertError ?? null }));
  const rpc = vi.fn(async () => ({ error: opts.rpcError ?? null }));
  const admin = { from: () => ({ ...chain, insert }), rpc } as unknown as SupabaseClient;
  return { admin, insert, rpc };
}

describe("loadLockContext", () => {
  it("defaults a vehicle with no persisted signal to locked and no bookings", async () => {
    const { admin } = fakeAdmin();
    await expect(loadLockContext(admin, "v1")).resolves.toEqual({ bookings: [], currentLocked: true });
  });

  it("throws a Danish error when a lookup fails", async () => {
    const { admin } = fakeAdmin({ selectResult: { data: null, error: { message: "boom" } } });
    await expect(loadLockContext(admin, "v1")).rejects.toThrow("Kunne ikke slå lås-status op: boom");
  });
});

describe("sendAndRecordLock", () => {
  const base = { vehicleId: "v1", costumerId: "c1", locked: false, actor: { user_id: "me" }, logTag: "test" } as const;

  beforeEach(() => {
    vi.mocked(sendGenericCommand).mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("sends the command, then records history (keyed off the physical command) and the locked flag", async () => {
    const { admin, insert, rpc } = fakeAdmin();
    await expect(sendAndRecordLock(admin, { ...base, command: "start" })).resolves.toEqual({ ok: true });
    expect(sendGenericCommand).toHaveBeenCalledWith("v1", "start", { clientId: "id", clientSecret: "secret" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle_id: "v1", signal_type: "unlock", signal_value: { user_id: "me" } }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "upsert_vehicle_signal_if_newer",
      expect.objectContaining({ p_vehicle_id: "v1", p_signal: "locked", p_data: { locked: false } }),
    );
  });

  it("writes nothing when 2hire fails, and reports it as 502", async () => {
    vi.mocked(sendGenericCommand).mockRejectedValueOnce(new Error("2hire nede"));
    const { admin, insert, rpc } = fakeAdmin();
    await expect(sendAndRecordLock(admin, { ...base, command: "stop" })).resolves.toEqual({ ok: false, status: 502, error: "2hire nede" });
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports missing 2hire configuration as 409", async () => {
    vi.mocked(resolveTwoHireCredentials).mockRejectedValueOnce(new TwoHireNotConfiguredError("ingen adgang"));
    const { admin } = fakeAdmin();
    await expect(sendAndRecordLock(admin, { ...base, command: "stop" })).resolves.toMatchObject({ ok: false, status: 409 });
  });

  it("does not persist the locked flag if the history insert fails", async () => {
    const { admin, rpc } = fakeAdmin({ insertError: { message: "nope" } });
    await expect(sendAndRecordLock(admin, { ...base, command: "stop" })).resolves.toMatchObject({ ok: false, status: 500 });
    expect(rpc).not.toHaveBeenCalled();
  });
});
