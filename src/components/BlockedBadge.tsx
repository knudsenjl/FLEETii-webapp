import type { ReactNode } from "react";

/** The small red "Blokeret"/"Adgang blokeret" pill shown next to a blocked
 * vehicle/user/customer wherever it's listed — previously hand-copied
 * across 8 call sites. `className` is for caller-specific spacing
 * (ml-2, mt-0.5 w-fit, etc.) since that varies by where the badge sits. */
export function BlockedBadge({ children = "Blokeret", className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <span className={`rounded bg-red-100 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-red-700 ${className}`.trim()}>
      {children}
    </span>
  );
}
