// Flat horn-with-sound-waves glyph for the "Horn" button (VehicleDetailsPage,
// BookingDetailsPage, TwoHireTestPage) — decorative only, so it's always
// aria-hidden; the button itself carries the label.
interface HornIconProps {
  className?: string;
}

export function HornIcon({ className = "h-5 w-5" }: HornIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="5" cy="12" r="3.2" fill="currentColor" />
      <path d="M7 9.5 12 8v8l-5-1.5z" fill="currentColor" />
      <path d="M14 8a6 6 0 0 1 0 8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" fill="none" />
      <path d="M17 5.5a10 10 0 0 1 0 13" stroke="currentColor" strokeWidth={2} strokeLinecap="round" fill="none" />
    </svg>
  );
}
