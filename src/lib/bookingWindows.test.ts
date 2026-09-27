import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every query built against the fake client: its filters and the range it asked for. */
const calls: { filters: [string, ...unknown[]][]; range: [number, number] | null }[] = [];
let totalRows = 0;

vi.mock("./supabase", () => ({
  supabase: {
    from: () => {
      const call = { filters: [] as [string, ...unknown[]][], range: null as [number, number] | null };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (...args: unknown[]) => (call.filters.push(["eq", ...args]), builder),
        or: (...args: unknown[]) => (call.filters.push(["or", ...args]), builder),
        order: () => builder,
        range: (from: number, to: number) => ((call.range = [from, to]), builder),
        // Serves rows [from, min(to, totalRows-1)] — a table of `totalRows` bookings.
        returns: () =>
          Promise.resolve({
            data: Array.from({ length: Math.max(0, Math.min(call.range![1], totalRows - 1) - call.range![0] + 1) }, (_, i) => ({
              booking_id: `b${call.range![0] + i}`,
              vehicle_id: "v1",
              start: "2026-10-01T10:00:00Z",
              end: null,
            })),
            error: null,
          }),
      };
      return builder;
    },
  },
}));

import { fetchAvailabilityWindows, fetchVehicleConflictWindows } from "./bookingWindows";

beforeEach(() => {
  calls.length = 0;
});

describe("booking window fetching", () => {
  it("reads past the 1000-row cap page by page until a short page", async () => {
    totalRows = 2500;
    const rows = await fetchVehicleConflictWindows("v1", "2026-10-01T10:00:00Z");
    expect(rows).toHaveLength(2500);
    expect(calls.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops after one request when everything fits", async () => {
    totalRows = 3;
    expect(await fetchVehicleConflictWindows("v1", "2026-10-01T10:00:00Z")).toHaveLength(3);
    expect(calls).toHaveLength(1);
  });

  it("narrows the confirm re-check to the one vehicle's possibly overlapping bookings", async () => {
    totalRows = 0;
    await fetchVehicleConflictWindows("v1", "2026-10-01T10:00:00Z");
    expect(calls[0].filters).toEqual([
      ["eq", "vehicle_id", "v1"],
      ["or", "end.gt.2026-10-01T10:00:00Z,end.is.null"],
    ]);
  });

  it("loads 90 days of history before the requested start for the free-period display", async () => {
    totalRows = 0;
    await fetchAvailabilityWindows("2026-10-01T10:00:00Z");
    expect(calls[0].filters).toEqual([["or", "end.gte.2026-07-03T10:00:00.000Z,end.is.null"]]);
  });
});
