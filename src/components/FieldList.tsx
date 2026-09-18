import type { ReactNode } from "react";

/** Wraps a set of FieldRow (or similar) rows in the app's standard bordered
 * "list card" look. `shrink-0` is load-bearing, not decorative: a flex item
 * with overflow-hidden gets an automatic min-height of 0 (CSS spec
 * behavior) — without it, vertical space pressure in the flex column can
 * squeeze this whole box to zero height, silently clipping every row even
 * though the DOM/data is correct (confirmed live in a real browser session
 * 2026-08-28 — the data was there the whole time, it was purely a layout
 * collapse). Previously hand-copied, comment and all, across 8 call sites. */
export function FieldList({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 overflow-hidden rounded-2xl border border-brand-100">
      <div className="divide-y divide-brand-100 bg-white">{children}</div>
    </div>
  );
}
