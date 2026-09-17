import type { ReactNode } from "react";

interface SettingsRowProps {
  /** "start" for rows whose value column is taller than one line (e.g. a
   * list box) instead of the default single-line vertical centering. */
  align?: "center" | "start";
  children: ReactNode;
}

/** The shared "label | value" grid row shape used across every settings
 * table (StandardSettings, RettighederSettings, AnvendelseSettings,
 * SettingsAdminPage, UserDetailsPage) — centralizes the 14rem label-column
 * width so it only has to change in one place instead of five. */
export function SettingsRow({ align = "center", children }: SettingsRowProps) {
  return (
    <div className={`grid grid-cols-[14rem_1fr] gap-2 px-2 py-0.5 ${align === "start" ? "items-start" : "items-center"}`}>
      {children}
    </div>
  );
}
