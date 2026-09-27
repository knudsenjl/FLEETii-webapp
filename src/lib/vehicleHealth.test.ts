import { describe, expect, it } from "vitest";
import { getVehicleHealthIssues, healthLevel, type VehicleHealthCheckInput } from "./vehicleHealth";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** ISO timestamp `ms` before NOW. */
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** A healthy vehicle: online, and every data signal fresh. */
const healthy: VehicleHealthCheckInput = {
  online: "TRUE",
  onlineUpdatedAtIso: ago(MIN),
  distanceCoveredUpdatedAtIso: ago(HOUR),
  autonomyPercentageUpdatedAtIso: ago(HOUR),
  lastTripStartIso: ago(2 * HOUR),
};

function check(overrides: Partial<VehicleHealthCheckInput>, positionIso: string | null = ago(MIN)) {
  return getVehicleHealthIssues({ ...healthy, ...overrides }, positionIso, NOW);
}

describe("getVehicleHealthIssues", () => {
  it("reports nothing for a healthy vehicle", () => {
    expect(check({})).toEqual([]);
    expect(healthLevel(check({}))).toBe("ok");
  });

  describe("Online", () => {
    it("ignores a short offline blip", () => {
      expect(check({ online: "FALSE", onlineUpdatedAtIso: ago(MIN), onlineFalseSinceIso: ago(14 * MIN) })).toEqual([]);
    });

    it("is an error once offline for 15 minutes", () => {
      const issues = check({ online: "FALSE", onlineUpdatedAtIso: ago(MIN), onlineFalseSinceIso: ago(15 * MIN) });
      expect(issues).toEqual([{ label: "Online", severity: "error", detail: expect.stringMatching(/^offline siden /) }]);
      expect(healthLevel(issues)).toBe("error");
    });

    it("falls back to the latest reading when the offline start is unknown", () => {
      expect(check({ online: "FALSE", onlineUpdatedAtIso: ago(20 * MIN), onlineFalseSinceIso: null })).toHaveLength(1);
      expect(check({ online: "FALSE", onlineUpdatedAtIso: ago(5 * MIN), onlineFalseSinceIso: null })).toEqual([]);
    });

    it("warns when never received", () => {
      expect(check({ online: undefined, onlineUpdatedAtIso: null })).toEqual([
        { label: "Online", severity: "warning", detail: "aldrig modtaget" },
      ]);
    });
  });

  describe("data signals vs. the latest trip", () => {
    it("accepts an old reading from the latest trip of an idle car", () => {
      expect(
        check({ lastTripStartIso: ago(20 * DAY), distanceCoveredUpdatedAtIso: ago(20 * DAY - HOUR) }),
      ).toEqual([]);
    });

    it("accepts a reading from within an hour before the trip began", () => {
      expect(check({ lastTripStartIso: ago(10 * DAY), distanceCoveredUpdatedAtIso: ago(10 * DAY + 59 * MIN) })).toEqual([]);
    });

    it("accepts a reading older than the trip while it is less than 4 days old", () => {
      expect(check({ lastTripStartIso: ago(HOUR), distanceCoveredUpdatedAtIso: ago(4 * DAY - MIN) })).toEqual([]);
    });

    it("warns about a reading older than both the trip and 4 days", () => {
      const issues = check({ lastTripStartIso: ago(HOUR), autonomyPercentageUpdatedAtIso: ago(22 * DAY) });
      expect(issues).toEqual([
        {
          label: "Drivmiddelniveau",
          severity: "warning",
          refreshSignal: "autonomy_percentage",
          detail: expect.stringMatching(/^sidst modtaget .+, før seneste tur/),
        },
      ]);
      expect(healthLevel(issues)).toBe("warning");
    });

    it("uses the 4-day age test alone when no trip is on record", () => {
      expect(check({ lastTripStartIso: null, distanceCoveredUpdatedAtIso: ago(3 * DAY) })).toEqual([]);
      expect(check({ lastTripStartIso: null, distanceCoveredUpdatedAtIso: ago(5 * DAY) })).toEqual([
        { label: "Kilometerstand", severity: "warning", refreshSignal: "distance_covered", detail: expect.stringMatching(/^sidst modtaget /) },
      ]);
    });

    it("tags only too-old readings for a refresh from 2hire, not missing ones", () => {
      const issues = check({ lastTripStartIso: null, distanceCoveredUpdatedAtIso: ago(5 * DAY), autonomyPercentageUpdatedAtIso: null });
      expect(issues.map((issue) => [issue.label, issue.refreshSignal])).toEqual([
        ["Kilometerstand", "distance_covered"],
        ["Drivmiddelniveau", undefined],
      ]);
    });

    it("warns about a signal never received, including Position", () => {
      expect(check({ autonomyPercentageUpdatedAtIso: null }, null)).toEqual([
        { label: "Position", severity: "warning", detail: "aldrig modtaget" },
        { label: "Drivmiddelniveau", severity: "warning", detail: "aldrig modtaget" },
      ]);
    });
  });

  it("lists the Online error before warnings and rates the whole as an error", () => {
    const issues = check({
      online: "FALSE",
      onlineFalseSinceIso: ago(HOUR),
      lastTripStartIso: null,
      distanceCoveredUpdatedAtIso: ago(10 * DAY),
    });
    expect(issues.map((issue) => [issue.label, issue.severity])).toEqual([
      ["Online", "error"],
      ["Kilometerstand", "warning"],
    ]);
    expect(healthLevel(issues)).toBe("error");
  });
});
