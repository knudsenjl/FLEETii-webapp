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
  /** "info" (default): neutral brand-colored border/text, for tooltips and "not implemented" notices. "warning": red border/text, for guard/blocked-action messages (e.g. "can't delete the last admin"). */
  variant?: "info" | "warning";
}

/** Renders nothing when `visible` is false; otherwise a small white card positioned just below the parent element. */
export function InlinePopup({ visible, message, align = "left", variant = "info" }: InlinePopupProps) {
  if (!visible) return null;

  return (
    <div
      className={`animate-fade-in absolute top-full z-20 mt-2 w-56 rounded-lg border px-3 py-2 text-xs shadow-lg ${
        variant === "warning" ? "border-red-300 bg-white text-red-600" : "border-brand-200 bg-white text-brand-700"
      } ${align === "right" ? "right-0" : "left-0"}`}
    >
      {message}
    </div>
  );
}
