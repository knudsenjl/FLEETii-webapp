import { describe, expect, it } from "vitest";
import {
  BOOKINGS_SELECT_COLUMNS,
  BOOKING_ID_COLUMN,
  DEPARTMENT_COLUMN,
  VEHICLE_ID_COLUMN,
  computeFreePeriod,
  formatFreePeriod,
  formatVehicleLabel,
  isVehicleAvailable,
  mapBookingRow,
  resolveVehicleGpsPosition,
  splitIsoDateTime,
  type BookingRow,
  type BookingWindow,
  type GpsPosition,
  type VehicleIdLookup,
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
  it("references the department column", () => {
    expect(DEPARTMENT_COLUMN).toBe("department");
  });
});

describe("BOOKINGS_SELECT_COLUMNS", () => {
  it("selects booking_id, vehicle_id, and department", () => {
    expect(BOOKINGS_SELECT_COLUMNS).toBe("booking_id, vehicle_id, start, end, usage, user, department");
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

describe("mapBookingRow", () => {
  const row: BookingRow = {
    booking_id: 42,
    vehicle_id: "AB12345",
    start: "2026-07-09T09:00:00",
    end: "2026-07-09T12:00:00",
    usage: "Kundebesøg",
    user: "user@example.com",
    department: "FLEETii",
  };

  it("maps the booking_id column onto the local id field", () => {
    expect(mapBookingRow(row).id).toBe(42);
  });

  it("maps every other field correctly", () => {
    expect(mapBookingRow(row)).toEqual({
      id: 42,
      vehicle: "AB12345",
      startDate: "09.07.2026",
      start: "09:00",
      endDate: "09.07.2026",
      end: "12:00",
      use: "Kundebesøg",
      user: "user@example.com",
      department: "FLEETii",
    });
  });

  it("passes through a null user unchanged", () => {
    expect(mapBookingRow({ ...row, user: null }).user).toBeNull();
  });

  it("passes through a null department unchanged", () => {
    expect(mapBookingRow({ ...row, department: null }).department).toBeNull();
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
});

describe("formatVehicleLabel", () => {
  const vehicles: VehicleLookup[] = [{ alias: "ET83472", brand: "VOLVO", model: "V60 (Breakout)" }];

  it("formats as 'plate: brand model' when the plate matches a known vehicle", () => {
    expect(formatVehicleLabel("ET83472", vehicles)).toBe("ET83472: VOLVO V60 (Breakout)");
  });

  it("falls back to just the plate when there is no matching vehicle", () => {
    expect(formatVehicleLabel("UNKNOWN1", vehicles)).toBe("UNKNOWN1");
  });
});

describe("resolveVehicleGpsPosition", () => {
  const vehicles: VehicleIdLookup[] = [{ alias: "ET83472", vehicleId: "veh-1" }];
  const positions: GpsPosition[] = [{ vehicleId: "veh-1", lat: 55.6761, lng: 12.5683 }];

  it("resolves the GPS position via the vehicle's alias -> vehicleId -> position chain", () => {
    expect(resolveVehicleGpsPosition("ET83472", vehicles, positions)).toEqual({ lat: 55.6761, lng: 12.5683 });
  });

  it("returns null when the plate has no matching vehicle", () => {
    expect(resolveVehicleGpsPosition("UNKNOWN1", vehicles, positions)).toBeNull();
  });

  it("returns null when the matched vehicle has no GPS position", () => {
    const otherVehicles: VehicleIdLookup[] = [{ alias: "ET83472", vehicleId: "veh-missing" }];
    expect(resolveVehicleGpsPosition("ET83472", otherVehicles, positions)).toBeNull();
  });
});
