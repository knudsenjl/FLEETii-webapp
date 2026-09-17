import type { ReactNode } from "react";

interface FieldRowProps {
  label: ReactNode;
  children: ReactNode;
}

/** The shared "label | value" tight grid row used across vehicle/customer/
 * booking detail pages and forms (distinct from SettingsRow's wider
 * 14rem-label settings-table row, and from ReservationPage's own roomier
 * grid-cols-2 form rows) — previously hand-copied across 51 call sites.
 * Row content varies too much (plain text, badges, inputs, selects) to have
 * a fixed value API, so only the shell + label are owned here. */
export function FieldRow({ label, children }: FieldRowProps) {
  return (
    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
      <label className="flex items-center text-sm font-medium text-brand-700">{label}</label>
      {children}
    </div>
  );
}
