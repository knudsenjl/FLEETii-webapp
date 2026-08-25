// Open-stroke "moving car" outline — side profile (facing right, low roof
// pulled toward the rear, sloped hood, ring-outline wheels) with three solid
// trailing bars behind it reading as motion left-to-right. Deliberately an
// outline rather than a filled silhouette (unlike PadlockGlyph.tsx): this
// matches the app's OTHER hand-drawn icon convention instead — the funnel
// filter icon in VehiclesPage.tsx/DepartmentPage.tsx
// (stroke="currentColor", strokeWidth 2, round caps/joins, fill="none") —
// and was reworked to match a reference outline-car icon the user liked.
// Used in BookingPage.tsx/BookingsPage.tsx's mobile-first hero/list cards.
interface CarGlyphProps {
  className?: string;
  /**
   * Accessible name. When set, renders role="img" + <title> for standalone
   * use (e.g. a table-cell status icon). Omit when the glyph sits inside an
   * already-labeled control, same convention as PadlockGlyph.
   */
  title?: string;
}

export function CarGlyph({ className = "h-4 w-6", title }: CarGlyphProps) {
  return (
    <svg
      viewBox="0 0 34 22"
      className={className}
      {...(title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true })}
    >
      {title && <title>{title}</title>}
      {/* Trailing motion bars — each one's near (right) edge follows the car's own rear contour a ~2.5-unit gap away (was too tight at ~1 unit), rather than sitting flush on one flat line: the bottom bar hugs the vertical rear-bumper edge (x=13), the middle bar hugs the sloped rear-window edge, and the top bar continues that same rake past the roof corner. The top bar is also vertically centered on y=9 — the roof's own height — so it reads as a continuation of the roofline rather than floating above it. Longest on top tapering to shortest on bottom, same "sort icon" taper as before. */}
      <rect x="2.5" y="7.8" width="10" height="2.4" rx="1.2" fill="currentColor" opacity={0.6} />
      <rect x="4" y="11.4" width="7" height="2.4" rx="1.2" fill="currentColor" opacity={0.6} />
      <rect x="6.5" y="15" width="4" height="2.4" rx="1.2" fill="currentColor" opacity={0.6} />
      {/* Body/roof/hood outline: short vertical rear, roof pillar up to a flat roof, windshield/hood slope down to a short flat hood, then down to the front bumper — closed back along the bottom sill. */}
      <path
        d="M13 17 V14 L15 9 H22 L25 13 H28 L29 17 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Wheels — open rings (fill="none"), straddling the bottom sill same as the outline body. Front wheel sits at cx=25 (not 26) so its own stroke gets the same ~1.7-unit clearance from the front bumper (x=29) that the rear wheel already has from the rear bumper (x=13) — at cx=26 the two strokes crowded together closely enough that the hood visually vanished into the wheel. */}
      <circle cx="17" cy="17" r="2.3" fill="none" stroke="currentColor" strokeWidth={2.2} />
      <circle cx="25" cy="17" r="2.3" fill="none" stroke="currentColor" strokeWidth={2.2} />
    </svg>
  );
}
