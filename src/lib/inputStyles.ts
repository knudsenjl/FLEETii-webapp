/** Shared className for the app's checkbox inputs — previously hand-copied
 * across 8 call sites, some without the disabled: variant (safe to include
 * always; it's a no-op unless the `disabled` attribute is actually set). */
export const CHECKBOX_CLASSNAME =
  "h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500 disabled:cursor-not-allowed";
