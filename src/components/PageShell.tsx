import { createContext, useContext } from "react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { fadeInUp } from "../lib/motionVariants";

/** Whether the enclosing PageShell was given minWidth0 — read by PageSection
 * so the two don't need the same boolean passed to both independently (they
 * were always passed together at every call site anyway). */
const MinWidth0Context = createContext(false);
export function usePageShellMinWidth0() {
  return useContext(MinWidth0Context);
}

interface PageShellProps {
  children: ReactNode;
  /** Adds min-w-0 throughout (here and in any nested PageSection) — needed
   * by pages whose content (e.g. a wide scrollable table) would otherwise
   * force the flex column wider than the viewport instead of scrolling
   * internally. */
  minWidth0?: boolean;
}

/** The outer chrome shared by every top-level page: full-height brand
 * background, a decorative radial-gradient glow in the top-left corner, and
 * a centered max-w-7xl column that fades/slides in on mount. Only owns the
 * shell — each page still renders its own PageHeader/section/etc as
 * children. Previously hand-copied verbatim across ~25 page files. */
export function PageShell({ children, minWidth0 = false }: PageShellProps) {
  const minW0 = minWidth0 ? "min-w-0 " : "";
  return (
    <MinWidth0Context.Provider value={minWidth0}>
      <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
        <div
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
          aria-hidden="true"
        />
        <div className={`mx-auto flex ${minW0}min-h-0 w-full max-w-7xl flex-1 flex-col gap-6`}>
          <motion.main {...fadeInUp} className={`flex ${minW0}min-h-0 flex-1 flex-col`}>
            {children}
          </motion.main>
        </div>
      </div>
    </MinWidth0Context.Provider>
  );
}
