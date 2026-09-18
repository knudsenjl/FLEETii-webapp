import type { ReactNode } from "react";

/** The standard two-button action row (Opdater/Fortryd, Bekræft/Annuller,
 * etc.) — same grid ConfirmDialog.tsx already uses internally, previously
 * hand-copied across 13 other call sites instead of being shared.
 * `className` is for the couple of sites that add a `mt-4` spacer. */
export function ButtonRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-2 gap-3 ${className}`.trim()}>{children}</div>;
}
