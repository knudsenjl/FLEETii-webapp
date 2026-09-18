import type { ReactNode } from "react";

/** The main <h2> heading inside a PageSection's white card — previously
 * hand-copied across 22 files. `className` is for the couple of sites that
 * add `shrink-0`/`pb-1`. */
export function SectionHeading({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-xl font-semibold text-brand-800 ${className}`.trim()}>{children}</h2>;
}
