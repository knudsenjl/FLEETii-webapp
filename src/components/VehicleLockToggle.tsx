// A single "Låst"/"Låst op" pill button, replacing the old two-button
// (separate "Lås"/"Lås op" icon buttons) layout on VehicleDetailsPage,
// BookingDetailsPage, and TwoHireTestPage. The two buttons used
// near-identical padlock icons that were hard to tell apart at a glance;
// this collapses them into one control whose color, icon, and label all
// swap together based on state, so there's nothing to misread. No sliding
// animation — the whole button just re-renders in one of two looks.
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
  /** Hover tooltip shown when locked and unlockEnabled is false. Omit on pages with no directional gating (e.g. admin diagnostics). */
  cannotUnlockMessage?: string;
  /** Hover tooltip shown when unlocked and lockEnabled is false. */
  cannotLockMessage?: string;
  /** Page-controlled success confirmation (e.g. from useTimedFlag) — "Køretøjet er nu låst op. God tur" / "Køretøjet er nu låst". Rendered below the button; null/false hides it. */
  confirmationMessage?: ReactNode | null;
  /** Extra classes on the root wrapper, e.g. `flex-1` to sit evenly alongside the "Blink lygterne"/"Horn" buttons in a shared row. */
  className?: string;
}

/**
 * Red pill + closed padlock + "Låst" while locked; green pill + open
 * padlock + "Låst op" while unlocked. Clicking requests the opposite state
 * via onToggle. Disabled state is direction-aware — only the transition the
 * current state would trigger is checked against lockEnabled/unlockEnabled,
 * matching the old two-button gating collapsed onto one control.
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
  const blockedReason =
    loading || locked === null
      ? undefined
      : locked
        ? (!unlockEnabled && cannotUnlockMessage) || undefined
        : (!lockEnabled && cannotLockMessage) || undefined;

  const isDisabled = loading || locked === null || Boolean(blockedReason);

  const handleClick = () => {
    if (isDisabled || locked === null) return;
    void onToggle(!locked);
  };

  return (
    <div className={`group relative ${className}`}>
      <button
        type="button"
        aria-pressed={locked === true}
        aria-label={locked ? "Låst — tryk for at låse op" : "Låst op — tryk for at låse"}
        disabled={isDisabled}
        onClick={handleClick}
        className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
      {blockedReason && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-lg border border-brand-200 bg-white px-3 py-2 text-center text-xs text-brand-700 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          {blockedReason}
        </div>
      )}
      <InlinePopup visible={Boolean(confirmationMessage)} message={confirmationMessage} />
    </div>
  );
}
