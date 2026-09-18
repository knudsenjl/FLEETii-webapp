import type { ReactNode } from "react";

/** A plain white rounded message card — used for stacked informational
 * text on the mobile "no bookings" empty states. Previously hand-copied
 * across 6 call sites in BookingPage.tsx/BookingsPage.tsx. */
export function InfoCard({ children }: { children: ReactNode }) {
  return (
    <div className="w-full rounded-2xl border border-brand-100 bg-white p-4 text-center text-sm text-brand-700 shadow-sm shadow-brand-900/5">
      {children}
    </div>
  );
}
