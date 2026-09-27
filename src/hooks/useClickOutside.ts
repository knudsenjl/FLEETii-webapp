// "Close this popup when the user clicks/taps anywhere outside it" — the
// document-level listener + ref check every popup/dropdown in the app used,
// hand-written in 8 places (code review 2026-09-26). A document listener (vs.
// a full-screen overlay div) has no z-index/stacking dependency: an overlay
// can lose the stacking fight against a sticky table header or a map and then
// stop intercepting clicks, leaving the popup stuck open.
import { useEffect, useRef, type RefObject } from "react";

/**
 * While `active`, calls `onOutside` for every `event` whose target is outside
 * `ref`'s element. `event` defaults to "mousedown" (the original desktop
 * pattern); the tap-first controls use "pointerdown", which fires for touch
 * as well. The latest `onOutside` is always used, without re-subscribing.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void,
  event: "mousedown" | "pointerdown" = "mousedown",
): void {
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;

  useEffect(() => {
    if (!active) return;
    const handle = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutsideRef.current();
    };
    document.addEventListener(event, handle);
    return () => document.removeEventListener(event, handle);
  }, [active, ref, event]);
}
