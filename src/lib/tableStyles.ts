/** Shared className for a sticky, uppercase table header — used by every
 * scrollable admin list table so the "this is what a table header looks
 * like" decision lives in one place instead of being retyped per page. */
export const STICKY_THEAD_CLASSNAME =
  "sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700";

/** Shared className for the <table> element itself, paired with
 * STICKY_THEAD_CLASSNAME above. The wrapper div around it (max-height,
 * flex-col, min-w-0) varies too much per page to centralize the same way —
 * that part stays page-owned. */
export const TABLE_CLASSNAME = "w-full border-collapse text-[0.7rem]";
