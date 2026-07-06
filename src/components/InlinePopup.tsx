import type { ReactNode } from "react";

interface InlinePopupProps {
  visible: boolean;
  message: ReactNode;
  align?: "left" | "right";
}

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
