// Shared "remember this on/off toggle across a genuine browser refresh"
// hook — same reload-only sessionStorage pattern as useMapViewSnapshot.ts,
// but for a plain boolean. Used by VehicleDetailsPage.tsx/
// BookingDetailsPage.tsx's single-vehicle-map "Live" toggle, which
// previously reset to off (and visually to its "black"/inactive state) on
// every reload — FleetManagementPage.tsx's own liveEnabled already
// persisted this way as part of its bespoke FleetMapSnapshot, this hook
// gives the single-vehicle pages the same
// behavior without each duplicating the sessionStorage/isPageReload
// plumbing.
import { useEffect, useState } from "react";

/** True exactly when this page load is a genuine browser refresh (F5/reload button) rather than an in-app navigation — see useMapViewSnapshot.ts's own copy of this check for why it's needed at all. */
function isPageReload(): boolean {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type === "reload";
}

/** Reads the sessionStorage snapshot at `storageKey` — null on any access/parse failure or if nothing's been saved yet, never thrown. */
function readStoredValue(storageKey: string): boolean | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as boolean) : null;
  } catch {
    return null;
  }
}

/** Best-effort write — silently does nothing if sessionStorage is unavailable/full. */
function writeStoredValue(storageKey: string, value: boolean): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // best-effort only
  }
}

/**
 * A `useState<boolean>` that additionally survives a genuine browser
 * refresh, scoped to `storageKey` (fold in whatever the toggle applies to,
 * e.g. a vehicle id, so two pages sharing this hook never cross-
 * contaminate each other's remembered state). Persisted on every change
 * (on AND off), same as FleetManagementPage.tsx's own liveEnabled write.
 */
export function useReloadPersistedBoolean(storageKey: string, defaultValue: boolean): [boolean, (value: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => (isPageReload() ? (readStoredValue(storageKey) ?? defaultValue) : defaultValue));

  useEffect(() => {
    writeStoredValue(storageKey, value);
  }, [storageKey, value]);

  return [value, setValue];
}
