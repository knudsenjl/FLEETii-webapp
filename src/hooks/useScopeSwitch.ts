import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

/**
 * Wraps switchDepartment + navigate for a single drill-down button whose
 * destination page reads Kunde/Afdeling scope purely from the global header
 * (useAuth()) rather than router state. Call once per BUTTON, not once per
 * page, so a spinner/error on one button never leaks onto a sibling button
 * using the same pattern. Mirrors PageHeader.tsx's own handleSwitch/switchError.
 */
export function useScopeSwitch() {
  const { switchDepartment } = useAuth();
  const navigate = useNavigate();
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchAndNavigate = async (departmentId: string | null, costumerId: string | null | undefined, to: string) => {
    setIsSwitching(true);
    setError(null);
    const switchErr = await switchDepartment(departmentId, costumerId);
    if (switchErr) {
      setError(switchErr);
      setIsSwitching(false);
      return;
    }
    setIsSwitching(false);
    navigate(to);
  };

  return { isSwitching, error, switchAndNavigate };
}
