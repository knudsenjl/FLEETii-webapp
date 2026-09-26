// The MotorAPI registration-number lookup behind the magnifying-glass button
// on NewVehiclePage.tsx's Nummerplade row and VehicleCreatePage.tsx's Køretøj
// row (see netlify/functions/motorapi-vehicle-lookup.mts). Both pages used to
// carry identical copies of this state, fetch and click-outside handling
// (code review 2026-09-26). What differs stays in each page: WHEN a lookup is
// allowed, whether a result is reused (VehicleCreatePage caches, since
// MotorAPI has a daily quota and its plate is fixed) and which fields are
// autofilled — passed in as `onLoaded`.
import { useRef, useState } from "react";
import { callFunction } from "../lib/callFunction";
import { stripNumberSpacing } from "../lib/textNormalization";
import { useClickOutside } from "./useClickOutside";

export type MotorApiLookup = ReturnType<typeof useMotorApiLookup>;

export function useMotorApiLookup() {
  /** The combined { vehicle, environment, equipment } reply (each part { data } or { error }), or null before a successful lookup. */
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Whether the JSON popup under the button is showing. */
  const [open, setOpen] = useState(false);
  /** Wraps the button + popup; clicks outside it close the popup. */
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));

  /**
   * Looks `plate` up (all whitespace stripped — MotorAPI wants the bare
   * registration number) and, on success, stores the result and calls
   * `onLoaded` with it. Clears any previous result/error first.
   */
  const load = (plate: string, onLoaded: (result: unknown) => void) => {
    setLoading(true);
    setError(null);
    setResult(null);
    void callFunction("motorapi-vehicle-lookup", { query: { regNo: stripNumberSpacing(plate) } })
      .then((response) => {
        if (!response.ok) {
          setError(response.data.error ?? "Kunne ikke hente data fra MotorAPI.");
          setLoading(false);
          return;
        }
        setResult(response.data);
        onLoaded(response.data);
        setLoading(false);
      })
      .catch(() => {
        setError("Kunne ikke kontakte serveren. Prøv igen senere.");
        setLoading(false);
      });
  };

  return { result, loading, error, open, setOpen, ref, load };
}
