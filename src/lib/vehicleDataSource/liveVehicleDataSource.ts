import { supabase } from "../supabase";
import type { Vehicle2Hire, VehicleDataSource, VehicleGPS2Hire } from "./types";

// getVehicles() reads vehicle_profiles (+ vehicle_signals for the live
// fields, + vehicle_departments for department scoping — see
// vehicle_departments_table.sql), kept up to date by admin-driven seed/
// maintenance SQL today (see supabase/applied/seed_vehicle_profiles.sql) and,
// for signals, by netlify/functions/2hire-webhook.mts. Vehicle2Hire mirrors
// 2hire's raw wire format (every field a string) so every existing page/
// helper (bookings.ts, VehiclesPage, VehicleDetailsPage, ...) keeps working
// unchanged regardless of which VehicleDataSource is active — this file just
// reformats the DB's typed columns (boolean/numeric/timestamptz) back into
// that string shape. departmentIds is the one exception (a uuid[], not part
// of 2hire's real format) — see types.ts.
//
// getGpsPositions() reads the `vehicle_signals` table directly (see
// supabase/vehicle_signals_table.sql for the RLS policy that allows this
// direct, authenticated browser read).

/** Raw shape of a row selected from vehicle_profiles. */
type VehicleProfileRow = {
  vehicle_id: string;
  number_plate: string | null;
  iot_id: string | null;
  brand: string | null;
  model: string | null;
  model_year: string | null;
};

/** Raw shape of a row selected from vehicle_departments. */
type VehicleDepartmentRow = {
  vehicle_id: string;
  department_id: string;
};

/** Raw shape of the vehicle_signals columns needed to fill out Vehicle2Hire. */
type VehicleSignalRow = {
  vehicle_id: string;
  online: boolean | null;
  online_updated_at: string | null;
  autonomy_percentage: number | null;
  autonomy_percentage_updated_at: string | null;
  distance_covered_meters: number | null;
  distance_covered_updated_at: string | null;
};

/** Formats a timestamptz value as "DD/MM/YYYY HH.MM" (2hire's wire format), or "" if null. */
function formatSignalTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

/** Formats a raw meter count as "N,NNN km" (2hire's wire format), or "" if null. */
function formatDistanceMeters(meters: number | null): string {
  if (meters === null) return "";
  return `${Math.round(meters / 1000).toLocaleString("en-US")} km`;
}

/** Formats a raw percentage as "NN%" (2hire's wire format), or "" if null. */
function formatPercentage(percentage: number | null): string {
  return percentage === null ? "" : `${percentage}%`;
}

/**
 * Maps one vehicle_profiles row (plus its matching vehicle_signals row, if
 * any, and its vehicle_departments department_ids) onto the Vehicle2Hire
 * wire shape. tags is always "" now (this DB-backed adapter has no real
 * 2hire tag data — see types.ts's departmentIds comment for the local
 * department relation that used to be repurposed onto this field). The
 * warning fields aren't tracked by any table today, so they're always
 * empty — no page currently reads
 * them (confirmed before writing this).
 */
function toVehicle2Hire(
  profile: VehicleProfileRow,
  signal: VehicleSignalRow | undefined,
  departmentIds: string[],
): Vehicle2Hire {
  return {
    plate: profile.number_plate ?? "",
    vehicleId: profile.vehicle_id,
    connectivityProvider: "",
    iotIdentifier: profile.iot_id ?? "",
    tags: "",
    departmentIds,
    brand: profile.brand ?? "",
    model: profile.model ?? "",
    version: profile.model_year ?? "",
    autonomyPercentage: formatPercentage(signal?.autonomy_percentage ?? null),
    autonomyPercentageUpdatedAt: formatSignalTimestamp(signal?.autonomy_percentage_updated_at ?? null),
    distanceCovered: formatDistanceMeters(signal?.distance_covered_meters ?? null),
    distanceCoveredUpdatedAt: formatSignalTimestamp(signal?.distance_covered_updated_at ?? null),
    online: signal?.online === true ? "TRUE" : "FALSE",
    onlineUpdatedAt: formatSignalTimestamp(signal?.online_updated_at ?? null),
    brakingSystemWarning: "",
    brakingSystemWarningUpdatedAt: "",
    drivingRelatedFailureWarning: "",
    drivingRelatedFailureWarningUpdatedAt: "",
    emissionWarning: "",
    emissionWarningUpdatedAt: "",
    engineCoolantWarning: "",
    engineCoolantWarningUpdatedAt: "",
    engineOilWarning: "",
    engineOilWarningUpdatedAt: "",
    engineWarning: "",
    engineWarningUpdatedAt: "",
    evWarning: "",
    evWarningUpdatedAt: "",
    serviceWarning: "",
    serviceWarningUpdatedAt: "",
    tirePressureWarning: "",
    tirePressureWarningUpdatedAt: "",
    washerFluidLevelWarning: "",
    washerFluidLevelWarningUpdatedAt: "",
  };
}

/** VehicleDataSource backed by the real vehicle_profiles/vehicle_signals Supabase tables. */
export const liveVehicleDataSource: VehicleDataSource = {
  async getVehicles(): Promise<Vehicle2Hire[]> {
    const [profilesResult, signalsResult, departmentsResult] = await Promise.all([
      supabase
        .from("vehicle_profiles")
        .select("vehicle_id, number_plate, iot_id, brand, model, model_year")
        .returns<VehicleProfileRow[]>(),
      supabase
        .from("vehicle_signals")
        .select(
          "vehicle_id, online, online_updated_at, autonomy_percentage, autonomy_percentage_updated_at, distance_covered_meters, distance_covered_updated_at",
        )
        .returns<VehicleSignalRow[]>(),
      supabase.from("vehicle_departments").select("vehicle_id, department_id").returns<VehicleDepartmentRow[]>(),
    ]);

    if (profilesResult.error) {
      throw new Error(`Kunne ikke hente køretøjsprofiler: ${profilesResult.error.message}`);
    }
    if (signalsResult.error) {
      throw new Error(`Kunne ikke hente køretøjssignaler: ${signalsResult.error.message}`);
    }
    if (departmentsResult.error) {
      throw new Error(`Kunne ikke hente køretøjsafdelinger: ${departmentsResult.error.message}`);
    }

    const signalsByVehicleId = new Map((signalsResult.data ?? []).map((s) => [s.vehicle_id, s]));
    const departmentIdsByVehicleId = new Map<string, string[]>();
    for (const row of departmentsResult.data ?? []) {
      const existing = departmentIdsByVehicleId.get(row.vehicle_id);
      if (existing) existing.push(row.department_id);
      else departmentIdsByVehicleId.set(row.vehicle_id, [row.department_id]);
    }

    return (profilesResult.data ?? []).map((profile) =>
      toVehicle2Hire(profile, signalsByVehicleId.get(profile.vehicle_id), departmentIdsByVehicleId.get(profile.vehicle_id) ?? []),
    );
  },
  async getGpsPositions(): Promise<VehicleGPS2Hire[]> {
    const { data, error } = await supabase
      .from("vehicle_signals")
      .select("vehicle_id, lat, lng")
      .not("lat", "is", null)
      .not("lng", "is", null);

    if (error) {
      throw new Error(`Kunne ikke hente 2hire GPS-positioner: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      vehicleId: row.vehicle_id as string,
      lat: row.lat as number,
      lng: row.lng as number,
    }));
  },
};
