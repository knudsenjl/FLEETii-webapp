import type { ReactNode } from "react";

interface TableMessageRowProps {
  /** Omit for a single-column table. */
  colSpan?: number;
  /** "loading" (default, brand-colored) or "error" (red) — the same
   * loading/error/empty-state row shape every admin list table uses. */
  variant?: "loading" | "error";
  children: ReactNode;
}

/** A full-width `<tr>`/`<td>` message row — "Indlæser…"/error/"Ingen X
 * fundet" states inside a `<tbody>` — previously hand-copied across ~27
 * call sites in 9 files. */
export function TableMessageRow({ colSpan, variant = "loading", children }: TableMessageRowProps) {
  return (
    <tr>
      <td colSpan={colSpan} className={`px-2 py-3 text-center ${variant === "error" ? "text-red-600" : "text-brand-500"}`}>
        {children}
      </td>
    </tr>
  );
}
