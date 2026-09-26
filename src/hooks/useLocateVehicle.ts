// Shared "Blink" action for BookingDetailsPage.tsx and VehicleDetailsPage.tsx
// — posts 2hire's real "locate" generic command via 2hire-vehicle-command.mts
// (requireUser-gated for this specific command, same audience as Lås/Lås
// op — see that function's own doc comment), so it isn't duplicated across
// pages.
import { useCallback, useState } from "react";
import { callFunction } from "../lib/callFunction";

export type UseLocateVehicleResult = {
  isLocating: boolean;
  locateError: string | null;
  /** Sends the "locate" command for vehicleId. Resolves true on success, false on failure (locateError is also set on failure) — callers use this to know whether to show a "Lygterne blinker" confirmation. */
  locate: (vehicleId: string) => Promise<boolean>;
};

/** Wraps the "locate" (blink headlights) 2hire command — see 2hire-vehicle-command.mts. */
export function useLocateVehicle(): UseLocateVehicleResult {
  const [isLocating, setIsLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const locate = useCallback(
    async (vehicleId: string): Promise<boolean> => {
      setIsLocating(true);
      setLocateError(null);

      try {
        const response = await callFunction("2hire-vehicle-command", { body: { vehicleId, command: "locate" } });

        const result = response.data as { error?: string };
        if (!response.ok) {
          setLocateError(result.error ?? "Kunne ikke lokalisere køretøjet.");
          return false;
        }
      } catch {
        setLocateError("Kunne ikke kontakte serveren. Prøv igen senere.");
        return false;
      } finally {
        setIsLocating(false);
      }

      return true;
    },
    [],
  );

  return { isLocating, locateError, locate };
}
