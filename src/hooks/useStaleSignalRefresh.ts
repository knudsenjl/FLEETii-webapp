// Before the "!" health marker settles on "this reading is too old", ask
// 2hire directly for the current value (user request 2026-09-27): a webhook
// delivery 2hire skipped would otherwise look like a sensor problem. Every
// warning getVehicleHealthIssues tags with `refreshSignal` is sent to
// refresh-vehicle-signals.mts in one batch; if anything new was stored, the
// fleet is reloaded (useRefreshVehicles) and the marker re-evaluates with the
// fresh reading — which may clear the warning or, if 2hire has nothing newer
// either, keep it.
//
// Each vehicle+signal is re-read at most once per REFRESH_COOLDOWN_MS per
// browser session (module-level, so moving between the fleet table and
// /vehicle-details doesn't re-ask): a reading that is genuinely old stays
// old, and asking again on every render would just hammer 2hire.
import { useEffect } from "react";
import { useRefreshVehicles } from "../contexts/VehicleContext";
import { callFunction } from "../lib/callFunction";
import type { HealthIssue, RefreshableSignal } from "../lib/vehicleHealth";

const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;
/** refresh-vehicle-signals.mts's own per-call vehicle limit. */
const MAX_VEHICLES_PER_CALL = 100;

/** When each "vehicleId:signal" was last sent for a refresh. */
const lastAttemptMs = new Map<string, number>();

export type VehicleHealthEntry = { vehicleId: string; issues: HealthIssue[] };

export function useStaleSignalRefresh(entries: VehicleHealthEntry[]): void {
  const refreshVehicles = useRefreshVehicles();

  const stale = entries.flatMap(({ vehicleId, issues }) =>
    issues.flatMap((issue) => (issue.refreshSignal ? [{ vehicleId, signal: issue.refreshSignal }] : [])),
  );
  // A stable string, so the effect only runs when the set of stale readings changes.
  const staleKey = stale
    .map(({ vehicleId, signal }) => `${vehicleId}:${signal}`)
    .sort()
    .join(",");

  useEffect(() => {
    if (!staleKey) return;
    const now = Date.now();
    const due = staleKey.split(",").filter((key) => now - (lastAttemptMs.get(key) ?? 0) >= REFRESH_COOLDOWN_MS);
    if (due.length === 0) return;
    due.forEach((key) => lastAttemptMs.set(key, now));

    const signalsByVehicle = new Map<string, RefreshableSignal[]>();
    for (const key of due) {
      const [vehicleId, signal] = key.split(":") as [string, RefreshableSignal];
      signalsByVehicle.set(vehicleId, [...(signalsByVehicle.get(vehicleId) ?? []), signal]);
    }
    const requests = [...signalsByVehicle].map(([vehicleId, signals]) => ({ vehicleId, signals }));

    void (async () => {
      let stored = 0;
      for (let i = 0; i < requests.length; i += MAX_VEHICLES_PER_CALL) {
        try {
          const response = await callFunction<{ stored: number }>("refresh-vehicle-signals", {
            body: { requests: requests.slice(i, i + MAX_VEHICLES_PER_CALL) },
          });
          if (response.ok) stored += response.data.stored;
        } catch {
          // Best effort: without a refresh the marker simply keeps its warning.
        }
      }
      if (stored > 0) await refreshVehicles();
    })();
  }, [staleKey, refreshVehicles]);
}
