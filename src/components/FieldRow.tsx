import type { ReactNode } from "react";

/** The settings-table row's own grid template (14rem label column) —
 * exported so RequiredFieldRow call sites that need to match a settings
 * table's row shape (UserDetailsPage, SettingsAdminPage) can reference the
 * same string instead of re-typing it. */
export const SETTINGS_ROW_CLASSNAME = "grid grid-cols-[14rem_1fr] items-center gap-2 px-2 py-0.5";

interface FieldRowProps {
  label: ReactNode;
  children: ReactNode;
  /** "tight" (default): grid-cols-2 p-0.5 — the label|value shape used
   * across vehicle/customer/booking detail pages and forms. "settings":
   * grid-cols-[14rem_1fr] px-2 py-0.5 — the wider settings-table row shape
   * (previously its own SettingsRow component, merged in here since the
   * only real difference was the grid template and whether `label` needed
   * its own wrapping element). */
  variant?: "tight" | "settings";
  /** Only meaningful with variant="settings": "start" for rows whose value
   * column is taller than one line (e.g. a list box) instead of the default
   * single-line vertical centering. */
  align?: "center" | "start";
  /** Set when `label` already supplies its own <label> element (e.g. a
   * label+FieldInfoButton combo, as every settings-table row uses) — renders
   * it as-is instead of wrapping it in FieldRow's own <label>. Nesting two
   * <label> elements is invalid HTML and can double-fire a checkbox's native
   * click-to-toggle behavior, so this must stay explicit rather than
   * inferred from the content. */
  rawLabel?: boolean;
  /** Full override of the row's own grid classes, for the handful of
   * call sites with a genuinely different (roomier) row shape — e.g.
   * ReservationPage's form rows. */
  className?: string;
  /** Override of the auto-wrapped <label>'s own classes (ignored when
   * rawLabel is set). */
  labelClassName?: string;
}

/** The shared "label | value" grid row used across vehicle/customer/booking
 * detail pages, forms, and every settings table — previously hand-copied
 * across 51 call sites (plus another ~10 as the separate SettingsRow
 * component this absorbed). Row content varies too much (plain text,
 * badges, inputs, selects) to have a fixed value API, so only the shell +
 * label are owned here. */
export function FieldRow({
  label,
  children,
  variant = "tight",
  align = "center",
  rawLabel = false,
  className,
  labelClassName = "flex items-center text-sm font-medium text-brand-700",
}: FieldRowProps) {
  const gridClassName =
    className ?? (variant === "settings" ? `grid grid-cols-[14rem_1fr] gap-2 px-2 py-0.5 ${align === "start" ? "items-start" : "items-center"}` : "grid grid-cols-2 items-center gap-2 p-0.5");
  return (
    <div className={gridClassName}>
      {rawLabel ? label : <label className={labelClassName}>{label}</label>}
      {children}
    </div>
  );
}
