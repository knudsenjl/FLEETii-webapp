// Shared "!" health-check logic for a 2hire vehicle — which tracked signals
// have gone stale or never arrived. Split out 2026-09-11 when
// VehicleDetailsPage.tsx gained the same red "!" button (previously
// VehiclesPage.tsx's fleet table only), so the two pages share one
// definition of "unhealthy" instead of drifting apart.

/** How long a tracked signal can go without a fresh reading before the "!" health button flags it — see the 2026-09-10 webhook-delivery investigation that prompted this feature. */
export const SIGNAL_STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

/** One signal the health check found missing or stale for a vehicle — lastReceivedIso is null if that signal has NEVER been received at all (as opposed to merely being older than SIGNAL_STALE_THRESHOLD_MS). */
export type HealthIssue = { label: string; lastReceivedIso: string | null };

/** Danish "DD/MM HH:MM" formatting straight from a raw ISO timestamp — same output shape as shortSignalTimestamp (lib/bookings.ts), which instead takes 2hire's own pre-formatted "DD/MM/YYYY HH.MM" string; position has no such pre-formatted string of its own (see vehicleDataSource/types.ts's VehicleGPS2Hire.updatedAtIso doc comment), so this formats directly from ISO instead. */
export function formatIsoShort(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The subset of a vehicle's fields getVehicleHealthIssues actually needs — deliberately structural (not DisplayVehicle itself) so both VehiclesPage.tsx's full DisplayVehicle and VehicleDetailsPage.tsx's narrower router-state Vehicle type satisfy it without extra casting. All optional/nullable since a narrower caller's shape may not always carry every one of them. */
export type VehicleHealthCheckInput = {
  onlineUpdatedAtIso?: string | null;
  distanceCoveredUpdatedAtIso?: string | null;
  autonomyPercentageUpdatedAtIso?: string | null;
  tripDetectedUpdatedAtIso?: string | null;
};

/**
 * Every 2hire signal this app actually tracks live, checked against
 * SIGNAL_STALE_THRESHOLD_MS — drives the red "!" health button (admin/
 * sysadm only, gated by each caller) on both VehiclesPage.tsx's fleet table
 * and VehicleDetailsPage.tsx's own "Køretøj:" header row. Returns [] for a
 * fully healthy vehicle (button hidden), or one HealthIssue per signal
 * that's either never arrived or has gone stale otherwise. Deliberately
 * just the five signals with a real "current state" column today (see
 * 2hire-webhook.mts's own header comment) — NOT the 2hire warning fields
 * (engineOilWarning, serviceWarning, etc. — see vehicleDataSource/types.ts),
 * which aren't wired to any real data yet; add those here (not in the
 * rendering) once they are.
 */
export function getVehicleHealthIssues(vehicle: VehicleHealthCheckInput, positionUpdatedAtIso: string | null): HealthIssue[] {
  const now = Date.now();
  const isStale = (iso: string | null) => !iso || now - new Date(iso).getTime() > SIGNAL_STALE_THRESHOLD_MS;

  const checks: { label: string; iso: string | null }[] = [
    { label: "Online", iso: vehicle.onlineUpdatedAtIso ?? null },
    { label: "Position", iso: positionUpdatedAtIso },
    { label: "Kilometerstand", iso: vehicle.distanceCoveredUpdatedAtIso ?? null },
    { label: "Drivmiddelniveau", iso: vehicle.autonomyPercentageUpdatedAtIso ?? null },
    { label: "Turdetektion", iso: vehicle.tripDetectedUpdatedAtIso ?? null },
  ];

  return checks.filter((check) => isStale(check.iso)).map((check) => ({ label: check.label, lastReceivedIso: check.iso }));
}
