// Flat, filled padlock silhouette shared by LockStatusIcon (a standalone
// red/green status glyph in tables) and VehicleLockToggle (a white icon on a
// colored pill button) — one shape, colored via currentColor, so both places
// stay visually identical. Locked: shackle closes fully into the body.
// Unlocked: the shackle stays hinged on the left post but swings up and to
// the right, clearly detached from the body — the standard "open padlock"
// convention, replacing the old inline svgs whose locked/unlocked paths
// differed by a single, barely-noticeable coordinate.
interface PadlockGlyphProps {
  locked: boolean;
  className?: string;
  /**
   * Accessible name. When set, renders role="img" + <title> for standalone
   * use (e.g. a table-cell status icon). Omit when the glyph sits inside an
   * already-labeled control (e.g. a button with its own aria-label) — it's
   * then marked aria-hidden instead, so screen readers don't announce it
   * twice.
   */
  title?: string;
}

export function PadlockGlyph({ locked, className = "h-4 w-4", title }: PadlockGlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      {...(title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true })}
    >
      {title && <title>{title}</title>}
      <rect x="4" y="10" width="16" height="11" rx="3" fill="currentColor" />
      <path
        d={locked ? "M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" : "M7.5 10V7.5a4.5 4.5 0 0 1 9.5 -4"}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </svg>
  );
}
