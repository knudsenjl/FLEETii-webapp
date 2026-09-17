import type { ReactNode } from "react";

/** A centered message box overlaid on top of a LeafletMap (parent needs
 * `relative`) — used for "no GPS position"/"no vehicles to show" states.
 * pointer-events-none on the outer layer so the map underneath stays
 * pannable/zoomable everywhere except the message box itself. Previously
 * hand-copied across 4 call sites. */
export function MapOverlayMessage({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="rounded-lg border border-red-500 bg-gray-500/50 px-4 py-2 text-center text-sm font-medium text-brand-900 shadow-lg">
        {children}
      </div>
    </div>
  );
}
