// The round magnifying-glass MotorAPI lookup button (spinner while in flight)
// with its raw-JSON result popup, driven by useMotorApiLookup. Was
// copy-pasted three times across NewVehiclePage.tsx and VehicleCreatePage.tsx
// (code review 2026-09-26). Same look as CostumerNewPage.tsx's CVR lookup, so
// every external-lookup button in the app reads the same way.
import type { ReactNode } from "react";
import { InlinePopup } from "./InlinePopup";
import type { MotorApiLookup } from "../hooks/useMotorApiLookup";

interface MotorApiLookupButtonProps {
  lookup: MotorApiLookup;
  onClick: () => void;
  /** Screen-reader label naming which fields a lookup fills. */
  ariaLabel: string;
  disabled?: boolean;
  /** Extra popups anchored to the same spot (e.g. VehicleCreatePage's "Kun mulig hvis redigering er aktiv" notice). */
  children?: ReactNode;
}

export function MotorApiLookupButton({ lookup, onClick, ariaLabel, disabled = false, children }: MotorApiLookupButtonProps) {
  return (
    <div className="relative shrink-0" ref={lookup.ref}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        title="Slå op i MotorAPI"
        className="flex h-5 w-5 items-center justify-center rounded-full border border-brand-300 text-brand-600 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {lookup.loading ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3 w-3 animate-spin">
            <path d="M21 12a9 9 0 1 1-9-9" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        )}
      </button>
      <InlinePopup
        visible={lookup.open}
        align="right"
        message={
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[0.65rem]">
            {lookup.loading ? "Henter fra MotorAPI…" : lookup.error ? lookup.error : JSON.stringify(lookup.result, null, 2)}
          </pre>
        }
      />
      {children}
    </div>
  );
}
