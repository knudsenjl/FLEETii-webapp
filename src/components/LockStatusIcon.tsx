// Small read-only closed/open padlock indicator — used in table cells
// (VehiclesPage, AllBookingsPage) and the small "Køretøjet er låst" badge
// next to the vehicle label (VehicleDetailsPage, BookingDetailsPage,
// BookingNextPage, TwoHireTestPage). Wraps the shared PadlockGlyph shape
// with red/green coloring so it always renders something for both states
// (instead of the old inline svg, which rendered nothing at all for
// "unlocked" — read as missing data rather than an actual state).
//
// Tap-to-reveal rather than the old native SVG <title> (a pure hover
// tooltip — never reachable on iOS/touch at all, only via mouse hover).
// Tapping toggles a small InlinePopup with the same label text instead, so
// the state is actually readable on every platform, not just relying on
// red/green color (which color-blind users can't distinguish either).
import { useEffect, useRef, useState } from "react";
import { PadlockGlyph } from "./PadlockGlyph";
import { InlinePopup } from "./InlinePopup";

interface LockStatusIconProps {
  locked: boolean;
  /** Extra classes merged onto the wrapping element, e.g. `mx-auto` for table-cell centering (previously merged onto the svg itself — the svg's own size/color are now fixed, since the wrapper is what layout classes actually apply to). */
  className?: string;
}

export function LockStatusIcon({ locked, className = "" }: LockStatusIconProps) {
  const [showLabel, setShowLabel] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const label = locked ? "Køretøjet er låst" : "Køretøjet er låst op";

  // Dismiss on a tap/click anywhere outside this icon — a document-level
  // listener + ref check, rather than a full-screen "fixed inset-0" overlay
  // (the pattern used elsewhere in this app, e.g. PageHeader's dropdowns):
  // this component is used INSIDE table cells (VehiclesPage/AllBookingsPage,
  // both with a `sticky z-10` <thead>), and an overlay sharing that same
  // z-index there could lose the stacking fight and stop intercepting
  // clicks, leaving the popup stuck open. A document listener has no
  // z-index/stacking dependency at all, so it isn't affected by that.
  useEffect(() => {
    if (!showLabel) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setShowLabel(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showLabel]);

  return (
    <span ref={containerRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          // Every current usage sits inside a clickable table row (or, in
          // the inline-badge usage, a non-clickable label) — stopPropagation
          // keeps a tap on just this icon from also triggering the row's
          // own navigation.
          e.stopPropagation();
          setShowLabel((visible) => !visible);
        }}
        aria-label={label}
        className="flex h-4 w-4 items-center justify-center"
      >
        <PadlockGlyph locked={locked} className={`h-4 w-4 ${locked ? "text-red-600" : "text-green-600"}`} />
      </button>
      <InlinePopup visible={showLabel} message={label} />
    </span>
  );
}
