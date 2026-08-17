// A single "Låst"/"Låst op" pill button, replacing the old two-button
// (separate "Lås"/"Lås op" icon buttons) layout on VehicleDetailsPage,
// BookingDetailsPage, and TwoHireTestPage. The two buttons used
// near-identical padlock icons that were hard to tell apart at a glance;
// this collapses them into one control whose color, icon, and label all
// swap together based on state, so there's nothing to misread. No sliding
// animation — the whole button just re-renders in one of two looks.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { InlinePopup } from "./InlinePopup";
import { PadlockGlyph } from "./PadlockGlyph";

interface VehicleLockToggleProps {
  /** null while the current lock state is still loading. */
  locked: boolean | null;
  /** Whether clicking while unlocked (→ locks it) is currently allowed. */
  lockEnabled: boolean;
  /** Whether clicking while locked (→ unlocks it) is currently allowed. */
  unlockEnabled: boolean;
  /** Disables the whole control, e.g. while the initial state fetch is in flight. */
  loading: boolean;
  /** Called with the requested next state on click; return value matches useVehicleLockState's setLock (true = success). */
  onToggle: (nextLocked: boolean) => Promise<boolean> | boolean;
  /** Tap-to-reveal explanation shown when locked and unlockEnabled is false. Omit on pages with no directional gating (e.g. admin diagnostics). */
  cannotUnlockMessage?: string;
  /** Tap-to-reveal explanation shown when unlocked and lockEnabled is false. */
  cannotLockMessage?: string;
  /** Page-controlled success confirmation (e.g. from useTimedFlag) — "Køretøjet er nu låst op. God tur" / "Køretøjet er nu låst". Rendered below the button; null/false hides it. */
  confirmationMessage?: ReactNode | null;
  /** Extra classes on the root wrapper, e.g. `flex-1` to sit evenly alongside the "Blink"/"Horn" buttons in a shared row. */
  className?: string;
}

/**
 * Red pill + closed padlock + "Låst" while locked; green pill + open
 * padlock + "Låst op" while unlocked. Clicking requests the opposite state
 * via onToggle. Disabled state is direction-aware — only the transition the
 * current state would trigger is checked against lockEnabled/unlockEnabled,
 * matching the old two-button gating collapsed onto one control.
 *
 * When direction-blocked (a real reason exists — cannotLockMessage/
 * cannotUnlockMessage), the button stays natively enabled/tappable rather
 * than using the `disabled` attribute: a genuinely disabled button fires no
 * click/touch events at all, which would make the reason unreachable on
 * tap-only devices (there's no hover to reveal it, unlike the old CSS
 * group-hover tooltip this replaced). Only loading/locked===null — states
 * with nothing to explain — use the real `disabled` attribute.
 */
export function VehicleLockToggle({
  locked,
  lockEnabled,
  unlockEnabled,
  loading,
  onToggle,
  cannotUnlockMessage,
  cannotLockMessage,
  confirmationMessage,
  className = "",
}: VehicleLockToggleProps) {
  const [showBlockedReason, setShowBlockedReason] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const blockedReason =
    loading || locked === null
      ? undefined
      : locked
        ? (!unlockEnabled && cannotUnlockMessage) || undefined
        : (!lockEnabled && cannotLockMessage) || undefined;

  const isInert = loading || locked === null;
  const looksDisabled = isInert || Boolean(blockedReason);

  const handleClick = () => {
    if (isInert) return;
    if (blockedReason) {
      setShowBlockedReason((visible) => !visible);
      return;
    }
    void onToggle(!locked);
  };

  // Dismiss on a tap/click anywhere outside this control — a document-level
  // listener + ref check rather than a full-screen "fixed inset-0" overlay
  // (see LockStatusIcon.tsx's identical fix for why: no z-index/stacking
  // dependency to lose a fight against, unlike an overlay div).
  useEffect(() => {
    if (!showBlockedReason) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setShowBlockedReason(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showBlockedReason]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-pressed={locked === true}
        aria-label={locked ? "Låst — tryk for at låse op" : "Låst op — tryk for at låse"}
        disabled={isInert}
        onClick={handleClick}
        className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow transition-colors ${
          looksDisabled ? "cursor-not-allowed opacity-50" : ""
        } ${
          locked === null
            ? "bg-brand-300"
            : locked
              ? "bg-red-600 hover:bg-red-700"
              : "bg-green-600 hover:bg-green-700"
        }`}
      >
        <PadlockGlyph locked={locked ?? true} className="h-5 w-5" />
        {locked === false ? "Låst op" : "Låst"}
      </button>
      <InlinePopup
        visible={Boolean(showBlockedReason && blockedReason)}
        message={blockedReason}
        variant="warning"
        position="top"
      />
      <InlinePopup visible={Boolean(confirmationMessage)} message={confirmationMessage} />
    </div>
  );
}
