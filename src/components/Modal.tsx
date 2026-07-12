import type { ReactNode } from "react";

export function Modal({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">{children}</div>
    </div>
  );
}
