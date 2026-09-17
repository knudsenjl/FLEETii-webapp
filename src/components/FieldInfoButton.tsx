import type { ReactNode } from "react";
import { InlinePopup } from "./InlinePopup";

interface FieldInfoButtonProps {
  open: boolean;
  /** Toggles `open`. Reused for the click-outside overlay too (not a
   * separate "close" callback) — the overlay only renders while `open` is
   * already true, so toggling it there always closes it, same effect as a
   * dedicated close handler would have. */
  onToggle: () => void;
  message: ReactNode;
  align?: "left" | "right";
}

/** The small circular "?" button used next to a field/setting label to open
 * an info tooltip — always paired with a click-outside overlay and an
 * InlinePopup, previously hand-copied as this same 3-element combo across
 * 7 call sites. */
export function FieldInfoButton({ open, onToggle, message, align }: FieldInfoButtonProps) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-label="Mere information"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand-300 text-[0.65rem] font-bold leading-none text-brand-600 transition hover:bg-brand-50"
      >
        ?
      </button>
      {open && <div className="fixed inset-0 z-10" onClick={onToggle} />}
      <InlinePopup visible={open} message={message} align={align} />
    </>
  );
}
