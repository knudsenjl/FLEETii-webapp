// Shared modal chrome: a dimmed full-screen overlay plus a centered white
// card. This owns no content or behavior of its own — it's the single place
// that defines what a modal *looks like* in this app, so every dialog
// (ConfirmDialog, ProtectedRoute's forbidden notice, etc.) stays visually
// consistent by rendering through this instead of hand-rolling the same
// overlay/card markup.
import type { ReactNode } from "react";

/** Centered white-card modal over a dimmed backdrop. Purely presentational — no close button, no ARIA/focus handling, no dismiss-on-backdrop-click; callers own all behavior via their own content. */
export function Modal({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">{children}</div>
    </div>
  );
}
