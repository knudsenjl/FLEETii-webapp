// A small absolutely-positioned tooltip/popover anchored below its parent
// (parent needs `relative` positioning). Typically paired with useTimedFlag
// so `visible` auto-clears after a few seconds — used for "not implemented
// yet" notices and inline info tooltips.
import type { ReactNode } from "react";

interface InlinePopupProps {
  visible: boolean;
  message: ReactNode;
  /** Which side of the anchor the popup hugs. Defaults to left. */
  align?: "left" | "right";
}

/** Renders nothing when `visible` is false; otherwise a small white card positioned just below the parent element. */
export function InlinePopup({ visible, message, align = "left" }: InlinePopupProps) {
  if (!visible) return null;

  return (
    <div
      className={`animate-fade-in absolute top-full z-10 mt-2 w-56 rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs text-brand-700 shadow-lg ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {message}
    </div>
  );
}
