// Flat, filled headlight-with-beams glyph for the "Blink" button
// (VehicleDetailsPage, BookingDetailsPage, TwoHireTestPage) — decorative
// only, so it's always aria-hidden; the button itself carries the label.
interface HeadlightIconProps {
  className?: string;
}

export function HeadlightIcon({ className = "h-5 w-5" }: HeadlightIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M3 12C3 6.5 8 3.5 12.5 3.5V20.5C8 20.5 3 17.5 3 12Z" fill="currentColor" />
      <line x1="16" y1="8" x2="21" y2="5.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <line x1="16" y1="10.7" x2="21.5" y2="9.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <line x1="16" y1="13.3" x2="21.5" y2="14.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <line x1="16" y1="16" x2="21" y2="18.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}
