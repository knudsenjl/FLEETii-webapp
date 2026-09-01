// Flat eye outline, styled after PadlockGlyph.tsx (currentColor stroke, same
// viewBox convention) — used by CostumerDetailsPage.tsx's "2hire client ID"
// row as a reveal-on-click button, always inside an already-labeled control
// (aria-label on the surrounding <button>), so it's just decorative here.
interface EyeGlyphProps {
  className?: string;
}

export function EyeGlyph({ className = "h-4 w-4" }: EyeGlyphProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M2 12C2 12 5.5 5.5 12 5.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.75" fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}
