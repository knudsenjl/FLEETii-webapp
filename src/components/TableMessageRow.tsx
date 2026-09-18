import type { ReactNode } from "react";

interface TableMessageRowProps {
  /** Omit for a single-column table. Ignored when as="div". */
  colSpan?: number;
  /** "loading" (default, brand-colored) or "error" (red) — the same
   * loading/error/empty-state row shape every admin list table uses. */
  variant?: "loading" | "error";
  /** "tr" (default): a `<tr>`/`<td>` row inside a `<tbody>`. "div": a plain
   * `<div>` for the grid-based non-table lists (StandardSettings.tsx/
   * SettingsAdminPage.tsx, unified off `<table>` onto CSS grid rows) — same
   * look, with an explicit text-sm since there's no table ancestor
   * supplying a font-size utility the way TABLE_CLASSNAME does. */
  as?: "tr" | "div";
  children: ReactNode;
}

/** A full-width message row — "Indlæser…"/error/"Ingen X fundet" states,
 * either a `<tr>`/`<td>` inside a `<tbody>` (previously hand-copied across
 * ~27 call sites in 9 files) or a plain `<div>` for the settings pages'
 * grid-row lists. */
export function TableMessageRow({ colSpan, variant = "loading", as = "tr", children }: TableMessageRowProps) {
  const color = variant === "error" ? "text-red-600" : "text-brand-500";
  if (as === "div") {
    return <div className={`px-2 py-3 text-center text-sm ${color}`}>{children}</div>;
  }
  return (
    <tr>
      <td colSpan={colSpan} className={`px-2 py-3 text-center ${color}`}>
        {children}
      </td>
    </tr>
  );
}
