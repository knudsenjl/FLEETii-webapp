import type { ReactNode } from "react";
import { usePageShellMinWidth0 } from "./PageShell";

interface PageSectionProps {
  children: ReactNode;
  /** Extra classes for the handful of pages that put their scrollable
   * content's own gap/overflow-y-auto directly on this section instead of a
   * separate inner div (both are legitimate — content-specific, not part of
   * the shared "white card" look this component owns). */
  className?: string;
}

/** The white bordered "card" section every page renders directly under its
 * PageHeader — previously hand-copied across 21 files. Reads minWidth0 from
 * the enclosing PageShell via context rather than taking its own prop: the
 * two were always passed the identical boolean at every call site, so a
 * second explicit prop here was pure duplication. */
export function PageSection({ children, className = "" }: PageSectionProps) {
  const minWidth0 = usePageShellMinWidth0();
  const minW0 = minWidth0 ? "min-w-0 " : "";
  return (
    <section
      className={`flex ${minW0}min-h-0 flex-1 flex-col rounded-2xl border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6 ${className}`.trim()}
    >
      {children}
    </section>
  );
}
