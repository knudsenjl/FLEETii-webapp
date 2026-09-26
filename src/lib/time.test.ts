import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatDanishLongDateTime,
  addDaysToDate,
  addMinutesUtc,
  ceilToDanishInterval,
  danishDayKey,
  danishLocalToUtcIso,
  formatDanishDateTime,
  toUtcMs,
  utcToDanishParts,
} from "./time";

// Every test runs with the process itself in UTC — exactly like a Netlify
// Function — so nothing can accidentally pass by relying on a Danish machine.
let originalTz: string | undefined;
beforeEach(() => {
  originalTz = process.env.TZ;
  process.env.TZ = "UTC";
});
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("danishLocalToUtcIso (typed Danish time -> stored UTC)", () => {
  it("summer time is UTC+2", () => {
    expect(danishLocalToUtcIso("2026-07-01", "12:00")).toBe("2026-07-01T10:00:00.000Z");
  });

  it("winter time is UTC+1", () => {
    expect(danishLocalToUtcIso("2026-01-15", "12:00")).toBe("2026-01-15T11:00:00.000Z");
  });

  it("a time just after Danish midnight belongs to the previous UTC day", () => {
    expect(danishLocalToUtcIso("2026-07-02", "00:30")).toBe("2026-07-01T22:30:00.000Z");
  });

  it("spring-forward day (29.03.2026): times either side of the switch", () => {
    expect(danishLocalToUtcIso("2026-03-29", "01:59")).toBe("2026-03-29T00:59:00.000Z");
    expect(danishLocalToUtcIso("2026-03-29", "03:00")).toBe("2026-03-29T01:00:00.000Z");
  });

  it("spring-forward day: the non-existent 02:30 lands an hour later (03:30 summer time)", () => {
    expect(danishLocalToUtcIso("2026-03-29", "02:30")).toBe("2026-03-29T01:30:00.000Z");
  });

  it("fall-back day (25.10.2026): times either side of the switch", () => {
    expect(danishLocalToUtcIso("2026-10-25", "01:59")).toBe("2026-10-24T23:59:00.000Z");
    expect(danishLocalToUtcIso("2026-10-25", "03:00")).toBe("2026-10-25T02:00:00.000Z");
  });

  it("fall-back day: the repeated 02:30 resolves to a real instant that still shows as 02:30", () => {
    const iso = danishLocalToUtcIso("2026-10-25", "02:30");
    expect(utcToDanishParts(iso)).toEqual({ date: "2026-10-25", time: "02:30" });
  });
});

describe("utcToDanishParts (stored UTC -> shown Danish time)", () => {
  it("round-trips with danishLocalToUtcIso across the year", () => {
    for (const [date, time] of [
      ["2026-01-15", "08:15"],
      ["2026-03-29", "03:00"],
      ["2026-07-01", "23:45"],
      ["2026-10-25", "03:00"],
      ["2026-12-31", "23:59"],
    ]) {
      expect(utcToDanishParts(danishLocalToUtcIso(date, time))).toEqual({ date, time });
    }
  });

  it("accepts Supabase's '+00:00' timestamptz format", () => {
    expect(utcToDanishParts("2026-09-13T10:00:00+00:00")).toEqual({ date: "2026-09-13", time: "12:00" });
  });

  it("rolls over to the next Danish day before UTC does", () => {
    expect(utcToDanishParts("2026-07-01T22:30:00Z")).toEqual({ date: "2026-07-02", time: "00:30" });
  });
});

describe("toUtcMs", () => {
  it("reads an offset-less timestamp as UTC, never as the runtime's local time", () => {
    expect(toUtcMs("2026-07-01T10:00:00")).toBe(Date.UTC(2026, 6, 1, 10));
  });

  it("honours an explicit offset", () => {
    expect(toUtcMs("2026-07-01T12:00:00+02:00")).toBe(Date.UTC(2026, 6, 1, 10));
  });
});

describe("danishDayKey", () => {
  it("uses the Danish calendar day, not the UTC one", () => {
    expect(danishDayKey("2026-07-01T22:30:00Z")).toBe("2026-07-02");
    expect(danishDayKey("2026-07-01T21:59:00Z")).toBe("2026-07-01");
  });
});

describe("formatDanishDateTime", () => {
  it("shows a UTC instant as Danish dd.mm.yyyy HH:mm", () => {
    expect(formatDanishDateTime("2026-07-01T10:05:00Z")).toBe("01.07.2026 12:05");
  });
});

describe("formatDanishLongDateTime", () => {
  it("writes weekday, day, month and time in Danish, on the Danish clock", () => {
    expect(formatDanishLongDateTime("2026-09-26T12:45:00+00:00")).toBe("lørdag 26. september 2026 kl. 14:45");
  });

  it("rolls over to the next Danish day and uses winter time", () => {
    expect(formatDanishLongDateTime("2026-12-31T23:30:00Z")).toBe("fredag 1. januar 2027 kl. 00:30");
  });
});

describe("addMinutesUtc", () => {
  it("adds real elapsed minutes, crossing a DST switch correctly", () => {
    // 01:30 Danish summer time + 60 min across the fall-back switch = 02:30 winter time.
    const start = danishLocalToUtcIso("2026-10-25", "01:30");
    expect(utcToDanishParts(addMinutesUtc(start, 60)).time).toBe("02:30");
  });
});

describe("addDaysToDate", () => {
  it("handles month and year rollover", () => {
    expect(addDaysToDate("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("ceilToDanishInterval", () => {
  const at = (date: string, time: string) => Date.parse(danishLocalToUtcIso(date, time));

  it("rounds up on the Danish clock", () => {
    expect(ceilToDanishInterval(at("2026-07-01", "12:07"), 15)).toEqual({ date: "2026-07-01", time: "12:15" });
  });

  it("a 45-minute grid follows Danish minutes-of-day (not UTC)", () => {
    expect(ceilToDanishInterval(at("2026-07-01", "12:07"), 45)).toEqual({ date: "2026-07-01", time: "12:45" });
  });

  it("keeps a time already on a boundary", () => {
    expect(ceilToDanishInterval(at("2026-07-01", "12:30"), 15)).toEqual({ date: "2026-07-01", time: "12:30" });
  });

  it("rolls over to the next Danish day", () => {
    expect(ceilToDanishInterval(at("2026-07-01", "23:50"), 15)).toEqual({ date: "2026-07-02", time: "00:00" });
  });

  it("interval 0 means no rounding", () => {
    expect(ceilToDanishInterval(at("2026-07-01", "12:07"), 0)).toEqual({ date: "2026-07-01", time: "12:07" });
  });
});
