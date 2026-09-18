import type { ReactNode } from "react";

/** The grey uppercase bar used as a settings table's own first "row"
 * (RettighederSettings, SettingsAdminPage, UserDetailsPage) instead of a
 * separate heading sitting above the table. */
export function SettingsSectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-t-2xl bg-brand-50/60 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-brand-600">
      {children}
    </div>
  );
}
