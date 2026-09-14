import { useEffect, useRef } from "react";

/**
 * Resets page-local filter state whenever `deps` change AFTER mount — skips
 * the very first run so a legitimately session-restored value (e.g.
 * FleetManagementPage's own sessionStorage snapshot) isn't immediately
 * wiped out again on initial mount. Shared by every admin list page
 * (AllBookingsPage/DepartmentPage/VehiclesPage/FleetManagementPage) whose
 * own page-local Bruger/Køretøj/Rolle/Navn filter almost certainly doesn't
 * belong to a NEWLY switched Kunde/Afdeling scope — a previously-picked
 * value would otherwise either silently show nothing or, worse, keep
 * matching something that's no longer actually in view.
 *
 * `onReset` is read via a ref rather than a dep, so passing a fresh inline
 * closure each render (the common case) doesn't affect when this fires —
 * only `deps` does, exactly like a plain useEffect's own deps array.
 */
export function useResetOnScopeChange(deps: readonly unknown[], onReset: () => void): void {
  const skipFirstRef = useRef(true);
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  useEffect(() => {
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    onResetRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
