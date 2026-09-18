import type { ReactNode } from "react";

/** The scrollable inner content wrapper inside a PageSection — previously
 * hand-copied across 8 files. AboutPage.tsx uses gap-5 instead of gap-4 (a
 * real, deliberate difference) and stays hand-rolled. */
export function PageSectionBody({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">{children}</div>;
}
