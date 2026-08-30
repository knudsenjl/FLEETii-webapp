// Shared "remember this map's pan/zoom across a genuine browser refresh"
// hook. FleetManagementPage.tsx/BookingDetailsPage.tsx/BookingPage.tsx/
// VehicleDetailsPage.tsx each render a LeafletMap whose pan/zoom otherwise
// silently resets to its default view on an actual page reload — a fresh
// component instance starts from scratch, so neither React state nor
// LeafletMap's own internal view-preservation refs (which only survive a
// re-render, not a full unmount) have anything left to restore from. A
// plain in-app navigation never hits this at all (the component doesn't
// unmount long enough to lose anything) — this hook exists specifically for
// the reload case, via sessionStorage, which is the one thing that actually
// survives it.
import { useState } from "react";

export type MapView = { lat: number; lng: number; zoom: number };

/** Reads the sessionStorage snapshot at `storageKey` — null on any access/parse failure (private-browsing storage quirks, corrupted JSON, or simply nothing saved yet), never thrown. */
function readStoredView(storageKey: string): MapView | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as MapView) : null;
  } catch {
    return null;
  }
}

/** Best-effort write — silently does nothing if sessionStorage is unavailable/full. */
function writeStoredView(storageKey: string, view: MapView): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(view));
  } catch {
    // best-effort only
  }
}

/** True exactly when this page load is a genuine browser refresh (F5/reload button) rather than an in-app navigation — both otherwise look identical from inside a component (a fresh mount with nothing to go on), so the Navigation Timing API is what actually tells them apart. Deliberately narrow: a fresh, non-reload visit (a link, a browser-back landing on a brand-new component instance) must still use the caller's own live default view, not a stale memory from some earlier, unrelated visit. */
function isPageReload(): boolean {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type === "reload";
}

/**
 * Restores a LeafletMap's last pan/zoom across a browser refresh, scoped to
 * `storageKey` — callers should fold in whatever the map is actually
 * showing (a vehicle id, etc.) so two different maps sharing this hook
 * never cross-contaminate each other's remembered view (e.g. refreshing on
 * vehicle B's page must never show vehicle A's last-saved coordinates).
 *
 * `savedView` is computed once at mount and stays fixed for the component's
 * whole lifetime — feed it into LeafletMap's lat/lng/zoom props ahead of
 * the caller's own live default (`savedView?.lat ?? position?.lat ?? ...`),
 * same convention FleetManagementPage.tsx already established for its own
 * router-state snapshot. `onViewChange` wires straight into LeafletMap's
 * own prop of the same name.
 */
export function useMapViewSnapshot(storageKey: string): {
  savedView: MapView | null;
  onViewChange: (view: MapView) => void;
} {
  const [savedView] = useState<MapView | null>(() => (isPageReload() ? readStoredView(storageKey) : null));

  const onViewChange = (view: MapView) => {
    writeStoredView(storageKey, view);
  };

  return { savedView, onViewChange };
}
