// Shared "!" health-check logic for a 2hire vehicle — which tracked signals
// look wrong, and how badly. Split out 2026-09-11 when VehicleDetailsPage.tsx
// gained the same "!" button (previously VehiclesPage.tsx's fleet table
// only), so the two pages share one definition of "unhealthy".
//
// The rule (user-specified 2026-09-27, replacing "any signal older than 3
// days"): each signal is OK, WARNING or ERROR, and the marker shows the worst
// of them — red for an error, amber for warnings only, hidden when all is OK.
// An Online error replaces the red "!" with a red "offline" icon (user
// request 2026-09-30), since being offline also explains most other issues.
//   - Online: ERROR once it has been false for OFFLINE_ERROR_AFTER_MS. Online
//     flips to false for ~10 s many times a day on production, so the latest
//     value alone would flash red constantly.
//   - Turdetektion: always OK — it is the yardstick for the others.
//   - Position/Kilometerstand/Drivmiddelniveau only arrive while a car is
//     used, so an idle car's old readings are expected. They're OK if received
//     since the latest trip began (less PRE_TRIP_GRACE_MS: the unit often
//     sends them minutes before trip_detected turns true), or if younger than
//     IDLE_WARNING_AFTER_MS; otherwise WARNING. Never received: WARNING.
//   - 2hire "specific" signals other than trip_detected are always ERROR — none
//     are tracked yet (see the warning fields in vehicleDataSource/types.ts);
//     add them here as errors once they are.
// The trip window and "offline since" come from the vehicle_signals view
// (supabase/applied/vehicle_signals_trip_window.sql).
import { utcToDanishParts } from "./time";

/** How long Online must have been false before it counts as an error. */
const OFFLINE_ERROR_AFTER_MS = 15 * 60 * 1000;
/** A data signal received this long before the latest trip began still counts as "from the trip". */
const PRE_TRIP_GRACE_MS = 60 * 60 * 1000;
/** A data signal older than the latest trip may be this old before it's a warning. */
const IDLE_WARNING_AFTER_MS = 4 * 24 * 60 * 60 * 1000;

export type HealthSeverity = "warning" | "error";

/** The 2hire signals whose age the rule judges — the only ones useStaleSignalRefresh re-reads. */
export type RefreshableSignal = "position" | "distance_covered" | "autonomy_percentage";

/**
 * One signal the health check found wrong — `detail` is the ready-to-show
 * Danish explanation for the popup. `refreshSignal` is set only when the
 * warning is about a reading that is too old (not one never received): such
 * a reading is first re-read from 2hire (see useStaleSignalRefresh), in case
 * a webhook delivery was simply skipped. `offline` marks the Online error.
 */
export type HealthIssue = {
  label: string;
  severity: HealthSeverity;
  detail: string;
  refreshSignal?: RefreshableSignal;
  offline?: true;
};

/**
 * The marker's overall state: "offline" if the vehicle has been offline long
 * enough to be an error (shown as a red offline icon), else the worst
 * severity among `issues`, or "ok" (marker hidden) if there are none.
 */
export function healthLevel(issues: HealthIssue[]): "ok" | "offline" | HealthSeverity {
  if (issues.some((issue) => issue.offline)) return "offline";
  if (issues.some((issue) => issue.severity === "error")) return "error";
  return issues.length > 0 ? "warning" : "ok";
}

/** Danish "DD/MM HH:MM" formatting straight from a raw ISO timestamp — same output shape as shortSignalTimestamp (lib/bookings.ts), which instead takes 2hire's own pre-formatted "DD/MM/YYYY HH.MM" string; position has no such pre-formatted string of its own (see vehicleDataSource/types.ts's VehicleGPS2Hire.updatedAtIso doc comment), so this formats directly from ISO instead. */
export function formatIsoShort(iso: string): string {
  const { date, time } = utcToDanishParts(iso);
  const [, month, day] = date.split("-");
  return `${day}/${month} ${time}`;
}

/** The subset of a vehicle's fields getVehicleHealthIssues actually needs — deliberately structural (not DisplayVehicle itself) so both VehiclesPage.tsx's full DisplayVehicle and VehicleDetailsPage.tsx's narrower router-state Vehicle type satisfy it without extra casting. All optional/nullable since a narrower caller's shape may not always carry every one of them. */
export type VehicleHealthCheckInput = {
  /** "TRUE"/"FALSE". */
  online?: string;
  onlineUpdatedAtIso?: string | null;
  /** When Online last went false and stayed false; null while online (or without signal history). */
  onlineFalseSinceIso?: string | null;
  distanceCoveredUpdatedAtIso?: string | null;
  autonomyPercentageUpdatedAtIso?: string | null;
  /** When the latest trip began (trip_detected turned true); null if no trip is on record. */
  lastTripStartIso?: string | null;
};

/**
 * Classifies every signal this app tracks live (see the rule at the top of
 * this file) and returns one HealthIssue per signal that isn't OK — [] for a
 * healthy vehicle (marker hidden). Drives the "!" marker (admin/sysadm only,
 * gated by each caller) on VehiclesPage.tsx's fleet table and
 * VehicleDetailsPage.tsx's header. `now` is injectable for tests.
 */
export function getVehicleHealthIssues(
  vehicle: VehicleHealthCheckInput,
  positionUpdatedAtIso: string | null,
  now: number = Date.now(),
): HealthIssue[] {
  const issues: HealthIssue[] = [];

  if (!vehicle.onlineUpdatedAtIso) {
    issues.push({ label: "Online", severity: "warning", detail: "aldrig modtaget" });
  } else if (vehicle.online === "FALSE") {
    // Without signal history the offline start is unknown; the latest
    // (false) reading is then the conservative stand-in.
    const offlineSince = vehicle.onlineFalseSinceIso ?? vehicle.onlineUpdatedAtIso;
    if (now - Date.parse(offlineSince) >= OFFLINE_ERROR_AFTER_MS) {
      issues.push({
        label: "Online",
        severity: "error",
        detail: `offline siden ${formatIsoShort(offlineSince)}`,
        offline: true,
      });
    }
  }

  const tripStartMs = vehicle.lastTripStartIso ? Date.parse(vehicle.lastTripStartIso) : null;
  const dataSignals: { label: string; signal: RefreshableSignal; iso: string | null }[] = [
    { label: "Position", signal: "position", iso: positionUpdatedAtIso },
    { label: "Kilometerstand", signal: "distance_covered", iso: vehicle.distanceCoveredUpdatedAtIso ?? null },
    { label: "Drivmiddelniveau", signal: "autonomy_percentage", iso: vehicle.autonomyPercentageUpdatedAtIso ?? null },
  ];
  for (const { label, signal, iso } of dataSignals) {
    if (!iso) {
      issues.push({ label, severity: "warning", detail: "aldrig modtaget" });
      continue;
    }
    const receivedMs = Date.parse(iso);
    if (tripStartMs !== null && receivedMs >= tripStartMs - PRE_TRIP_GRACE_MS) continue;
    if (now - receivedMs < IDLE_WARNING_AFTER_MS) continue;
    issues.push({
      label,
      severity: "warning",
      refreshSignal: signal,
      detail:
        tripStartMs !== null
          ? `sidst modtaget ${formatIsoShort(iso)}, før seneste tur (${formatIsoShort(vehicle.lastTripStartIso!)})`
          : `sidst modtaget ${formatIsoShort(iso)}`,
    });
  }

  // Online (the only possible error) is checked first, so the popup already
  // leads with the error.
  return issues;
}
