/** Shared className for the app's checkbox inputs — previously hand-copied
 * across 8 call sites, some without the disabled: variant (safe to include
 * always; it's a no-op unless the `disabled` attribute is actually set). */
export const CHECKBOX_CLASSNAME =
  "h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500 disabled:cursor-not-allowed";

/** Shared className for the app's standard text/select input — the same
 * look RequiredFieldRow.tsx uses as its own default, previously hand-copied
 * across 22 more call sites that needed an input/select outside that
 * component's own label+asterisk+required shape. */
export const TEXT_INPUT_CLASSNAME =
  "rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20";
