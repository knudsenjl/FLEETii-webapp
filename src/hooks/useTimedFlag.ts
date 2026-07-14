// Shared "show a transient popup/message, then auto-hide it" mechanism used
// throughout the app for "not implemented yet" popovers, inline info
// tooltips, and validation warnings — anywhere a page needs one or more
// self-dismissing flags without hand-rolling its own state+timeout+cleanup
// for each one.
import { useEffect, useRef, useState } from "react";

/**
 * Tracks a single "active key" that auto-clears after `durationMs`. Call
 * trigger(key) to show something keyed by that string; check
 * `activeKey === key` to render it. Supports multiple independent flags in
 * one component by using different keys — triggering a new key cancels
 * whichever one was previously showing (only one can be active at a time).
 * The pending timeout is cleared on unmount so it never fires after the
 * component using it is gone.
 */
export function useTimedFlag(durationMs = 3000) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  /** Makes `key` the active flag now, clearing automatically after `durationMs`. Re-triggering (even with the same key) restarts the timer. */
  const trigger = (key: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setActiveKey(key);
    timeoutRef.current = setTimeout(() => setActiveKey(null), durationMs);
  };

  return { activeKey, trigger };
}
