import type { ReactNode } from "react";

interface DashboardTileProps {
  onClick: () => void;
  disabled?: boolean;
  /** The permanently-dimmed "not implemented yet" look (RAPPORTER) —
   * distinct from `disabled`, which uses the interactive disabled:
   * pseudo-class variant instead of a static opacity. */
  dimmed?: boolean;
  label: ReactNode;
  /** CountBadge / click-outside overlay / InlinePopup, rendered as siblings
   * after the button — kept generic rather than named slots since which of
   * these a given tile needs varies per call site. */
  children?: ReactNode;
}

/** The big square navigation tile used on the admin/sysadm dashboard
 * (AFDELINGER/KØRETØJER/BRUGERE/RAPPORTER) — previously hand-copied across
 * 10 call sites in 3 files. */
export function DashboardTile({ onClick, disabled = false, dimmed = false, label, children }: DashboardTileProps) {
  return (
    <div className="relative aspect-square w-28">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50 ${dimmed ? "opacity-50" : ""}`.trim()}
      >
        {label}
      </button>
      {children}
    </div>
  );
}
