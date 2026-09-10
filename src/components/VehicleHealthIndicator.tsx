// Red "!" button + popup for a vehicle with one or more unhealthy signals
// (see getVehicleHealthIssues in VehiclesPage.tsx). Renders nothing if
// `issues` is empty.
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

export type VehicleHealthIssue = { label: string; lastReceivedIso: string | null };

interface VehicleHealthIndicatorProps {
  issues: VehicleHealthIssue[];
  /** Formats a lastReceivedIso for display — injected rather than hardcoded here since the exact "DD/MM HH:MM" convention is owned by the calling page (VehiclesPage.tsx's formatIsoShort), not this component. */
  formatLastReceived: (iso: string) => string;
}

export function VehicleHealthIndicator({ issues, formatLastReceived }: VehicleHealthIndicatorProps) {
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

  if (issues.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-label={`Sundhedsproblem: mangler ${issues.map((issue) => issue.label).join(", ")}`}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-red-500 bg-red-50 text-[0.65rem] font-bold leading-none text-red-600 transition hover:bg-red-100"
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
            className="animate-fade-in z-50 w-max rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-black shadow-lg"
          >
            <ul className="space-y-1">
              {issues.map((issue) => (
                <li key={issue.label} className="whitespace-nowrap">
                  <span className="font-semibold">{issue.label}:</span>{" "}
                  {issue.lastReceivedIso ? `sidst modtaget ${formatLastReceived(issue.lastReceivedIso)}` : "aldrig modtaget"}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
