// "!" button + popup for a vehicle with one or more unhealthy signals (see
// lib/vehicleHealth.ts's getVehicleHealthIssues). Red when any issue is an
// error, amber for warnings only — not green, which already means "driving"
// (the car icon next to it). Renders nothing if `issues` is empty.
//
// Deliberately NOT built on InlinePopup (components/InlinePopup.tsx), unlike
// most of this app's other small popovers: this button lives inside a
// scrollable table (VehiclesPage.tsx's "overflow-auto" wrapper), and
// InlinePopup's usual parent-relative `position: absolute` gets clipped by
// that ancestor for any row near the bottom of the visible scroll area —
// the popup would render, just invisible/cut off, which looked like it was
// appearing "behind" other page elements. This instead portals the popup
// straight into document.body and positions it with `position: fixed` from
// the button's own real viewport coordinates (recomputed on scroll/resize
// while open), which escapes that clipping entirely regardless of where the
// row sits in the table.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { healthLevel, type HealthIssue } from "../lib/vehicleHealth";

interface VehicleHealthIndicatorProps {
  issues: HealthIssue[];
}

export function VehicleHealthIndicator({ issues }: VehicleHealthIndicatorProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [popupPosition, setPopupPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopupPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    updatePosition();

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if ((event.target as HTMLElement).closest("[data-vehicle-health-popup]")) return;
      setOpen(false);
    }

    // capture: true on scroll — the table's own overflow-auto div scrolling
    // doesn't bubble a "scroll" event to window otherwise, since scroll
    // events don't bubble at all (only capture works for a non-window
    // scrollable ancestor).
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const level = healthLevel(issues);
  if (level === "ok") return null;
  const isError = level === "error";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-label={`${isError ? "Fejl" : "Advarsel"}: ${issues.map((issue) => issue.label).join(", ")}`}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[0.65rem] font-bold leading-none transition ${
          isError
            ? "border-red-500 bg-red-50 text-red-600 hover:bg-red-100"
            : "border-amber-500 bg-amber-50 text-amber-600 hover:bg-amber-100"
        }`}
      >
        !
      </button>
      {open &&
        popupPosition &&
        createPortal(
          <div
            data-vehicle-health-popup
            // stopPropagation: React portals still bubble synthetic events
            // through the REACT tree (this component's own row/table
            // ancestors), not just the DOM tree they're actually rendered
            // into — without this, a click inside the popup would still
            // reach the table row's own onClick and navigate away to
            // VehicleDetailsPage. setOpen(false): a click anywhere inside
            // the popup (not just outside it) also closes it, same as
            // clicking the "!" button again would.
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            style={{ position: "fixed", top: popupPosition.top, right: popupPosition.right }}
            className={`animate-fade-in z-50 w-max max-w-sm rounded-lg border bg-white px-3 py-2 text-sm text-black shadow-lg ${
              isError ? "border-red-300" : "border-amber-300"
            }`}
          >
            {/* Errors come first (see getVehicleHealthIssues); each label is colored by its own severity. The closing line explains warnings, which usually just mean an idle vehicle (see the rule in lib/vehicleHealth.ts). */}
            <p className="mb-1">FLEETii har registreret flg. for køretøjet:</p>
            <ul className="mb-1 space-y-1 pl-4">
              {issues.map((issue) => (
                <li key={issue.label}>
                  <span className={`font-semibold ${issue.severity === "error" ? "text-red-600" : "text-amber-600"}`}>
                    {issue.label}:
                  </span>{" "}
                  {issue.detail}
                </li>
              ))}
            </ul>
            {issues.some((issue) => issue.severity === "warning") && (
              <p>Advarsler kan skyldes, at køretøjet ikke har været anvendt i en periode.</p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
