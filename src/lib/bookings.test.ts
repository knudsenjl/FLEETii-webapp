import { describe, expect, it } from "vitest";
import {
  BOOKINGS_SELECT_COLUMNS,
  BOOKING_ID_COLUMN,
  DEPARTMENT_COLUMN,
  VEHICLE_ID_COLUMN,
  addMinutesToIso,
  computeFreePeriod,
  computeLockButtonState,
  findAdjacentBookings,
  formatBookingPeriod,
  formatFreePeriod,
  formatVehicleLabel,
  isMapVisible,
  isVehicleAvailable,
  mapBookingRow,
  nowIsoString,
  resolveVehicleGpsPosition,
  shortDanishDate,
  shortSignalTimestamp,
  splitIsoDateTime,
  type BookingNeighbor,
  type BookingRow,
  type BookingWindow,
  type GpsPosition,
  type VehicleLookup,
} from "./bookings";

describe("BOOKING_ID_COLUMN", () => {
  it("references the renamed booking_id column", () => {
    expect(BOOKING_ID_COLUMN).toBe("booking_id");
  });
});

describe("VEHICLE_ID_COLUMN", () => {
  it("references the renamed vehicle_id column", () => {
    expect(VEHICLE_ID_COLUMN).toBe("vehicle_id");
  });
});

describe("DEPARTMENT_COLUMN", () => {
  it("references the department_id column", () => {
    expect(DEPARTMENT_COLUMN).toBe("department_id");
  });
});

describe("BOOKINGS_SELECT_COLUMNS", () => {
  it("selects booking_id, vehicle_id, and department_id", () => {
    expect(BOOKINGS_SELECT_COLUMNS).toBe("booking_id, vehicle_id, start, end, usage, user, department_id");
  });
});

describe("splitIsoDateTime", () => {
  it("splits an ISO datetime into Danish date and time parts", () => {
    expect(splitIsoDateTime("2026-07-09T14:30:00")).toEqual({ date: "09.07.2026", time: "14:30" });
  });

  it("does not throw on a bare date with no time part, and returns an empty time", () => {
    expect(splitIsoDateTime("2026-07-09")).toEqual({ date: "09.07.2026", time: "" });
  });

  it("does not throw on an empty string, falling back to empty date and time", () => {
    expect(splitIsoDateTime("")).toEqual({ date: "", time: "" });
  });
});

describe("nowIsoString", () => {
  it("formats the current moment as a naive local-time string with no timezone suffix", () => {
    const before = new Date();
    const result = nowIsoString();
    const after = new Date();

    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

    const pad = (n: number) => String(n).padStart(2, "0");
    const expectedFromBefore = `${before.getFullYear()}-${pad(before.getMonth() + 1)}-${pad(before.getDate())}T${pad(before.getHours())}:${pad(before.getMinutes())}:${pad(before.getSeconds())}`;
    const expectedFromAfter = `${after.getFullYear()}-${pad(after.getMonth() + 1)}-${pad(after.getDate())}T${pad(after.getHours())}:${pad(after.getMinutes())}:${pad(after.getSeconds())}`;
    expect([expectedFromBefore, expectedFromAfter]).toContain(result);
  });
});

describe("mapBookingRow", () => {
  const row: BookingRow = {
    booking_id: "42",
    vehicle_id: "7c6a05e9-1c49-41ae-bbea-afe6b09ff74f",
    start: "2026-07-09T09:00:00",
    end: "2026-07-09T12:00:00",
    usage: "Kundebesøg",
    user: "user@example.com",
    department_id: "b1f2c3d4-5678-90ab-cdef-1234567890ab",
  };

  it("maps the booking_id column onto the local id field", () => {
    expect(mapBookingRow(row).id).toBe("42");
  });

  it("maps every other field correctly", () => {
    expect(mapBookingRow(row)).toEqual({
      id: "42",
      vehicle: "7c6a05e9-1c49-41ae-bbea-afe6b09ff74f",
      startDate: "09.07.2026",
      start: "09:00",
      endDate: "09.07.2026",
      end: "12:00",
      startIso: "2026-07-09T09:00:00",
      endIso: "2026-07-09T12:00:00",
      use: "Kundebesøg",
      user: "user@example.com",
      departmentId: "b1f2c3d4-5678-90ab-cdef-1234567890ab",
    });
  });

  it("passes through a null user unchanged", () => {
    expect(mapBookingRow({ ...row, user: null }).user).toBeNull();
  });

  it("passes through a null department_id unchanged", () => {
    expect(mapBookingRow({ ...row, department_id: null }).departmentId).toBeNull();
  });

  it("maps a null end (open-ended booking) to null endDate/end/endIso, without calling splitIsoDateTime on it", () => {
    expect(mapBookingRow({ ...row, end: null })).toEqual({
      id: "42",
      vehicle: "7c6a05e9-1c49-41ae-bbea-afe6b09ff74f",
      startDate: "09.07.2026",
      start: "09:00",
      endDate: null,
      end: null,
      startIso: "2026-07-09T09:00:00",
      endIso: null,
      use: "Kundebesøg",
      user: "user@example.com",
      departmentId: "b1f2c3d4-5678-90ab-cdef-1234567890ab",
    });
  });
});

describe("isVehicleAvailable", () => {
  const reservationStart = "2026-07-09T09:00:00";
  const reservationEnd = "2026-07-09T12:00:00";

  it("is available when the vehicle has no bookings at all", () => {
    expect(isVehicleAvailable("AB12345", [], reservationStart, reservationEnd)).toBe(true);
  });

  it("is available when no reservation period is given, regardless of bookings", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T09:00:00", end: "2026-07-09T12:00:00" },
    ];
    expect(isVehicleAvailable("AB12345", bookings, null, null)).toBe(true);
  });

  it("is unavailable when an existing booking fully overlaps the requested period", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T09:00:00", end: "2026-07-09T12:00:00" },
    ];
    expect(isVehicleAvailable("AB12345", bookings, reservationStart, reservationEnd)).toBe(false);
  });

  it("is unavailable when an existing booking partially overlaps the requested period", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T11:00:00", end: "2026-07-09T13:00:00" },
    ];
    expect(isVehicleAvailable("AB12345", bookings, reservationStart, reservationEnd)).toBe(false);
  });

  it("is available when the existing booking ends before the requested period starts", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T06:00:00", end: "2026-07-09T08:00:00" },
    ];
    expect(isVehicleAvailable("AB12345", bookings, reservationStart, reservationEnd)).toBe(true);
  });

  it("is available when the existing booking starts after the requested period ends", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T13:00:00", end: "2026-07-09T15:00:00" },
    ];
    expect(isVehicleAvailable("AB12345", bookings, reservationStart, reservationEnd)).toBe(true);
  });

  it("ignores bookings that belong to a different vehicle", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "OTHER99", start: "2026-07-09T09:00:00", end: "2026-07-09T12:00:00" },
    ];
    expect(isVehicleAvailable("AB12345", bookings, reservationStart, reservationEnd)).toBe(true);
  });

  it("is unavailable when any one of several bookings overlaps", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-08T06:00:00", end: "2026-07-08T08:00:00" },
      { vehicle_id: "AB12345", start: "2026-07-09T10:00:00", end: "2026-07-09T11:00:00" },
    ];
    expect(isVehicleAvailable("AB12345", bookings, reservationStart, reservationEnd)).toBe(false);
  });

  it("is unavailable when the requested period is fully contained within an existing booking", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T10:30:00", end: "2026-07-09T13:30:00" },
    ];
    expect(isVehicleAvailable("AB12345", bookings, "2026-07-09T11:00:00", "2026-07-09T12:00:00")).toBe(false);
  });

  it("is unavailable even when the existing booking's stored value has a timezone suffix (Supabase timestamptz round-trip)", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T10:30:00+00:00", end: "2026-07-09T13:30:00+00:00" },
    ];
    expect(isVehicleAvailable("AB12345", bookings, "2026-07-09T11:00:00", "2026-07-09T12:00:00")).toBe(false);
  });

  it("is available for a back-to-back booking that starts exactly when an existing booking ends", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T06:00:00", end: reservationStart },
    ];
    expect(isVehicleAvailable("AB12345", bookings, reservationStart, reservationEnd)).toBe(true);
  });

  it("is available for a back-to-back booking that ends exactly when an existing booking starts", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: reservationEnd, end: "2026-07-09T15:00:00" },
    ];
    expect(isVehicleAvailable("AB12345", bookings, reservationStart, reservationEnd)).toBe(true);
  });

  it("is unavailable for any period at or after an open-ended booking's start", () => {
    const bookings: BookingWindow[] = [{ vehicle_id: "AB12345", start: "2026-07-09T06:00:00", end: null }];
    expect(isVehicleAvailable("AB12345", bookings, reservationStart, reservationEnd)).toBe(false);
  });

  it("is available for a period that ends before an open-ended booking starts", () => {
    const bookings: BookingWindow[] = [{ vehicle_id: "AB12345", start: "2026-07-09T14:00:00", end: null }];
    expect(isVehicleAvailable("AB12345", bookings, reservationStart, reservationEnd)).toBe(true);
  });
});

describe("computeFreePeriod", () => {
  const referenceStart = "2026-07-09T10:00:00";
  const referenceEnd = "2026-07-09T12:00:00";

  it("returns null when the vehicle has no bookings at all", () => {
    expect(computeFreePeriod("AB12345", [], referenceStart, referenceEnd)).toBeNull();
  });

  it("is bounded on both sides by the nearest earlier and later bookings", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T06:00:00", end: "2026-07-09T08:00:00" },
      { vehicle_id: "AB12345", start: "2026-07-09T14:00:00", end: "2026-07-09T16:00:00" },
    ];
    expect(computeFreePeriod("AB12345", bookings, referenceStart, referenceEnd)).toEqual({
      start: "2026-07-09T08:00:00",
      end: "2026-07-09T14:00:00",
    });
  });

  it("picks the closest earlier and later bookings when there are several", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-08T06:00:00", end: "2026-07-08T08:00:00" },
      { vehicle_id: "AB12345", start: "2026-07-09T07:00:00", end: "2026-07-09T09:00:00" },
      { vehicle_id: "AB12345", start: "2026-07-09T14:00:00", end: "2026-07-09T16:00:00" },
      { vehicle_id: "AB12345", start: "2026-07-10T08:00:00", end: "2026-07-10T10:00:00" },
    ];
    expect(computeFreePeriod("AB12345", bookings, referenceStart, referenceEnd)).toEqual({
      start: "2026-07-09T09:00:00",
      end: "2026-07-09T14:00:00",
    });
  });

  it("is unbounded on the start side when there is no earlier booking", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T14:00:00", end: "2026-07-09T16:00:00" },
    ];
    expect(computeFreePeriod("AB12345", bookings, referenceStart, referenceEnd)).toEqual({
      start: null,
      end: "2026-07-09T14:00:00",
    });
  });

  it("is unbounded on the end side when there is no later booking", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T06:00:00", end: "2026-07-09T08:00:00" },
    ];
    expect(computeFreePeriod("AB12345", bookings, referenceStart, referenceEnd)).toEqual({
      start: "2026-07-09T08:00:00",
      end: null,
    });
  });

  it("ignores bookings that belong to a different vehicle", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "OTHER99", start: "2026-07-09T06:00:00", end: "2026-07-09T08:00:00" },
    ];
    expect(computeFreePeriod("AB12345", bookings, referenceStart, referenceEnd)).toBeNull();
  });

  it("bounds freeEnd via an open-ended booking's start, same as any other booking", () => {
    const bookings: BookingWindow[] = [{ vehicle_id: "AB12345", start: "2026-07-09T14:00:00", end: null }];
    expect(computeFreePeriod("AB12345", bookings, referenceStart, referenceEnd)).toEqual({
      start: null,
      end: "2026-07-09T14:00:00",
    });
  });

  it("never treats an open-ended booking as the nearest earlier ended booking", () => {
    const bookings: BookingWindow[] = [
      { vehicle_id: "AB12345", start: "2026-07-09T06:00:00", end: null },
      { vehicle_id: "AB12345", start: "2026-07-09T14:00:00", end: "2026-07-09T16:00:00" },
    ];
    // The open-ended booking above would actually make this reference period
    // unavailable in practice (see isVehicleAvailable) — this test only
    // checks computeFreePeriod's own null-end handling in isolation.
    expect(computeFreePeriod("AB12345", bookings, referenceStart, referenceEnd)).toEqual({
      start: null,
      end: "2026-07-09T14:00:00",
    });
  });
});

describe("formatFreePeriod", () => {
  it("omits the repeated end date when start and end fall on the same day", () => {
    expect(formatFreePeriod({ start: "2026-07-09T08:00:00", end: "2026-07-09T14:00:00" })).toBe(
      "09.07.2026 08:00 - 14:00",
    );
  });

  it("shows the full end date when start and end fall on different days", () => {
    expect(formatFreePeriod({ start: "2026-07-09T08:00:00", end: "2026-07-10T14:00:00" })).toBe(
      "09.07.2026 08:00 - 10.07.2026 14:00",
    );
  });

  it("prefixes a bounded start with 'Fra' when the end is unbounded", () => {
    expect(formatFreePeriod({ start: "2026-07-09T08:00:00", end: null })).toBe("Fra 09.07.2026 08:00");
  });

  it("prefixes a bounded end with 'Til' when the start is unbounded", () => {
    expect(formatFreePeriod({ start: null, end: "2026-07-09T14:00:00" })).toBe("Til 09.07.2026 14:00");
  });

  it("falls back to a dash when both bounds are missing", () => {
    expect(formatFreePeriod({ start: null, end: null })).toBe("—");
  });

  it("uses short 'dd/mm' dates when short is true", () => {
    expect(formatFreePeriod({ start: "2026-07-09T08:00:00", end: "2026-07-10T14:00:00" }, true)).toBe(
      "09/07 08:00 - 10/07 14:00",
    );
  });
});

describe("shortDanishDate", () => {
  it("drops the year and replaces '.' with '/'", () => {
    expect(shortDanishDate("09.07.2026")).toBe("09/07");
  });
});

describe("shortSignalTimestamp", () => {
  it("drops the year from a 2hire wire-format timestamp", () => {
    expect(shortSignalTimestamp("09/07/2026 14.05")).toBe("09/07 14.05");
  });
});

describe("formatBookingPeriod", () => {
  const sameDay = { startDate: "09.07.2026", start: "08:00", endDate: "09.07.2026", end: "14:00" };
  const crossDay = { startDate: "09.07.2026", start: "22:45", endDate: "10.07.2026", end: "03:00" };

  it("omits the repeated end date when start and end fall on the same day", () => {
    expect(formatBookingPeriod(sameDay)).toBe("09.07.2026 08:00 - 14:00");
  });

  it("shows the full end date when start and end fall on different days", () => {
    expect(formatBookingPeriod(crossDay)).toBe("09.07.2026 22:45 - 10.07.2026 03:00");
  });

  it("uses short 'dd/mm' dates when short is true, same-day case", () => {
    expect(formatBookingPeriod(sameDay, true)).toBe("09/07 08:00 - 14:00");
  });

  it("uses short 'dd/mm' dates when short is true, cross-day case", () => {
    expect(formatBookingPeriod(crossDay, true)).toBe("09/07 22:45 - 10/07 03:00");
  });

  it("renders an open-ended booking (null endDate/end) as 'Fra {start}', full date", () => {
    const openEnded = { startDate: "09.07.2026", start: "08:00", endDate: null, end: null };
    expect(formatBookingPeriod(openEnded)).toBe("Fra 09.07.2026 08:00");
  });

  it("renders an open-ended booking as 'Fra {start}' with a short date when short is true", () => {
    const openEnded = { startDate: "09.07.2026", start: "08:00", endDate: null, end: null };
    expect(formatBookingPeriod(openEnded, true)).toBe("Fra 09/07 08:00");
  });
});

describe("formatVehicleLabel", () => {
  const vehicles: VehicleLookup[] = [{ vehicleId: "veh-1", plate: "ET83472", brand: "VOLVO", model: "V60 (Breakout)" }];

  it("formats as 'plate: brand model' when the vehicleId matches a known vehicle", () => {
    expect(formatVehicleLabel("veh-1", vehicles)).toBe("ET83472: VOLVO V60 (Breakout)");
  });

  it("falls back to just the raw vehicleId when there is no matching vehicle", () => {
    expect(formatVehicleLabel("veh-unknown", vehicles)).toBe("veh-unknown");
  });
});

describe("resolveVehicleGpsPosition", () => {
  const positions: GpsPosition[] = [{ vehicleId: "veh-1", lat: 55.6761, lng: 12.5683 }];

  it("resolves the GPS position for a matching vehicleId", () => {
    expect(resolveVehicleGpsPosition("veh-1", positions)).toEqual({ lat: 55.6761, lng: 12.5683 });
  });

  it("returns null when there is no position for that vehicleId", () => {
    expect(resolveVehicleGpsPosition("veh-missing", positions)).toBeNull();
  });
});

describe("findAdjacentBookings", () => {
  const sequence: BookingNeighbor[] = [
    { booking_id: "1", start: "2026-07-09T06:00:00", end: "2026-07-09T08:00:00" },
    { booking_id: "2", start: "2026-07-09T09:00:00", end: "2026-07-09T12:00:00" },
    { booking_id: "3", start: "2026-07-09T14:00:00", end: "2026-07-09T16:00:00" },
  ];

  it("returns both neighbors for a booking in the middle of the sequence", () => {
    expect(findAdjacentBookings(sequence, "2")).toEqual({ previous: sequence[0], next: sequence[2] });
  });

  it("returns no previous for the first booking in the sequence", () => {
    expect(findAdjacentBookings(sequence, "1")).toEqual({ previous: null, next: sequence[1] });
  });

  it("returns no next for the last booking in the sequence", () => {
    expect(findAdjacentBookings(sequence, "3")).toEqual({ previous: sequence[1], next: null });
  });

  it("returns no neighbors when the vehicle has only one booking", () => {
    expect(findAdjacentBookings([sequence[1]], "2")).toEqual({ previous: null, next: null });
  });

  it("returns no neighbors when the current booking id isn't in the list", () => {
    expect(findAdjacentBookings(sequence, "999")).toEqual({ previous: null, next: null });
  });

  it("sorts out-of-order input before finding neighbors", () => {
    const shuffled = [sequence[2], sequence[0], sequence[1]];
    expect(findAdjacentBookings(shuffled, "2")).toEqual({ previous: sequence[0], next: sequence[2] });
  });
});

describe("computeLockButtonState", () => {
  const booking = { start: "2026-07-09T09:00:00", end: "2026-07-09T12:00:00" };

  it("disables both buttons before the reservation's start time", () => {
    expect(computeLockButtonState("2026-07-09T08:59:59", booking, null, null, true)).toEqual({
      lockEnabled: false,
      unlockEnabled: false,
    });
  });

  it("enables both buttons once started, with no previous booking and the vehicle locked", () => {
    expect(computeLockButtonState("2026-07-09T09:00:00", booking, null, null, true)).toEqual({
      lockEnabled: true,
      unlockEnabled: true,
    });
  });

  it("disables unlock when the previous booking hasn't expired yet", () => {
    const previous = { end: "2026-07-09T09:30:00" };
    expect(computeLockButtonState("2026-07-09T09:15:00", booking, previous, null, true)).toEqual({
      lockEnabled: true,
      unlockEnabled: false,
    });
  });

  it("enables unlock once the previous booking has expired", () => {
    const previous = { end: "2026-07-09T09:00:00" };
    expect(computeLockButtonState("2026-07-09T09:15:00", booking, previous, null, true)).toEqual({
      lockEnabled: true,
      unlockEnabled: true,
    });
  });

  it("disables unlock when the vehicle is already unlocked, even after the previous booking expired", () => {
    const previous = { end: "2026-07-09T09:00:00" };
    expect(computeLockButtonState("2026-07-09T09:15:00", booking, previous, null, false)).toEqual({
      lockEnabled: true,
      unlockEnabled: false,
    });
  });

  it("keeps lock enabled after this reservation expires when the next reservation hasn't begun", () => {
    const next = { start: "2026-07-09T14:00:00" };
    expect(computeLockButtonState("2026-07-09T13:00:00", booking, null, next, true)).toEqual({
      lockEnabled: true,
      unlockEnabled: true,
    });
  });

  it("disables lock once this reservation has expired and the next reservation has begun", () => {
    const next = { start: "2026-07-09T12:00:00" };
    expect(computeLockButtonState("2026-07-09T12:30:00", booking, null, next, true)).toEqual({
      lockEnabled: false,
      unlockEnabled: true,
    });
  });

  it("keeps lock enabled at the exact expiry moment if the next reservation hasn't started yet", () => {
    const next = { start: "2026-07-09T12:30:00" };
    expect(computeLockButtonState("2026-07-09T12:00:00", booking, null, next, true).lockEnabled).toBe(true);
  });

  it("never expires an open-ended booking, so lock stays enabled far past what would've been an expiry", () => {
    const openEnded = { start: "2026-07-09T09:00:00", end: null };
    expect(computeLockButtonState("2027-01-01T00:00:00", openEnded, null, null, true)).toEqual({
      lockEnabled: true,
      unlockEnabled: true,
    });
  });

  it("permanently blocks unlock if the previous booking was itself open-ended (defensive — shouldn't occur in practice)", () => {
    const previous = { end: null };
    expect(computeLockButtonState("2027-01-01T00:00:00", booking, previous, null, true).unlockEnabled).toBe(false);
  });
});

describe("addMinutesToIso", () => {
  it("adds positive minutes, rolling over the hour", () => {
    expect(addMinutesToIso("2026-07-09T09:50:00", 15)).toBe("2026-07-09T10:05:00");
  });

  it("subtracts minutes when given a negative value, rolling back the hour", () => {
    expect(addMinutesToIso("2026-07-09T09:05:00", -15)).toBe("2026-07-09T08:50:00");
  });

  it("rolls over the calendar day when the shift crosses midnight", () => {
    expect(addMinutesToIso("2026-07-09T23:55:00", 15)).toBe("2026-07-10T00:10:00");
  });

  it("ignores a timezone suffix entirely rather than converting it — regression test for a real bug where the map on BookingDetailsPage stayed hidden because a Supabase-round-tripped '+00:00' value got shifted by the local UTC offset before the 15-minute window was even applied", () => {
    expect(addMinutesToIso("2026-07-19T11:22:00+00:00", -15)).toBe("2026-07-19T11:07:00");
    expect(addMinutesToIso("2026-07-19T14:22:00+00:00", 15)).toBe("2026-07-19T14:37:00");
  });

  it("returns the input unchanged if it doesn't match the expected ISO shape", () => {
    expect(addMinutesToIso("not-a-date", 15)).toBe("not-a-date");
  });
});

describe("isMapVisible", () => {
  const booking = { start: "2026-07-09T09:00:00", end: "2026-07-09T12:00:00" };

  it("is not visible more than 15 minutes before the start", () => {
    expect(isMapVisible("2026-07-09T08:44:00", booking)).toBe(false);
  });

  it("becomes visible exactly 15 minutes before the start", () => {
    expect(isMapVisible("2026-07-09T08:45:00", booking)).toBe(true);
  });

  it("stays visible during the booking", () => {
    expect(isMapVisible("2026-07-09T10:00:00", booking)).toBe(true);
  });

  it("stays visible exactly 15 minutes after the end", () => {
    expect(isMapVisible("2026-07-09T12:15:00", booking)).toBe(true);
  });

  it("is not visible more than 15 minutes after the end", () => {
    expect(isMapVisible("2026-07-09T12:16:00", booking)).toBe(false);
  });

  it("stays visible indefinitely after starting for an open-ended booking", () => {
    const openEnded = { start: "2026-07-09T09:00:00", end: null };
    expect(isMapVisible("2027-01-01T00:00:00", openEnded)).toBe(true);
  });

  it("still respects the 15-minutes-before-start lower bound for an open-ended booking", () => {
    const openEnded = { start: "2026-07-09T09:00:00", end: null };
    expect(isMapVisible("2026-07-09T08:44:00", openEnded)).toBe(false);
  });

  it("is visible mid-booking even when start/end carry a timezone suffix (Supabase timestamptz round-trip) — regression test for the real bug where this returned false", () => {
    const suffixed = { start: "2026-07-19T11:22:00+00:00", end: "2026-07-19T14:22:00+00:00" };
    expect(isMapVisible("2026-07-19T11:43:00", suffixed)).toBe(true);
  });
});
