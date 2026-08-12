// Small read-only closed/open padlock indicator — used in table cells
// (VehiclesPage, AllBookingsPage) and the small "Køretøjet er låst" badge
// next to the vehicle label (VehicleDetailsPage, BookingDetailsPage,
// TwoHireTestPage). Wraps the shared PadlockGlyph shape with red/green
// coloring so it always renders something for both states (instead of the
// old inline svg, which rendered nothing at all for "unlocked" — read as
// missing data rather than an actual state).
import { PadlockGlyph } from "./PadlockGlyph";

interface LockStatusIconProps {
  locked: boolean;
  /** Extra classes merged onto the svg, e.g. `mx-auto` for table-cell centering. */
  className?: string;
}

export function LockStatusIcon({ locked, className = "" }: LockStatusIconProps) {
  return (
    <PadlockGlyph
      locked={locked}
      title={locked ? "Køretøjet er låst" : "Køretøjet er låst op"}
      className={`h-4 w-4 ${locked ? "text-red-600" : "text-green-600"} ${className}`}
    />
  );
}
