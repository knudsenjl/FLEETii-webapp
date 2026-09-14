import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

/**
 * Like useScopeSwitch, but shares ONE underlying in-flight switchDepartment
 * call across several buttons on the same page — pass each button its own
 * string `key` (e.g. "fleet", "koretojer", "brugere") when calling
 * switchAndNavigate. Returns a single isSwitching/error/activeKey triple:
 * `activeKey` names whichever button most recently triggered a switch, so
 * each button can still show its OWN "Vent…"/error state by comparing
 * against it (`activeKey === "fleet" && isSwitching`), not a page-wide one.
 *
 * Crucially, `isSwitching` itself is shared and should be used as EVERY
 * button's own `disabled` prop — since there's only one underlying
 * switchDepartment call site, a second button clicked while the first is
 * still resolving is ignored outright (see the guard in switchAndNavigate)
 * rather than firing a second, independent request that could resolve
 * before or after the first and let whichever one lands last win the final
 * navigate() call regardless of click order. Used by CostumerDetailsPage.tsx
 * (Flådestyring/AFDELINGER/KØRETØJER/BRUGERE, all targeting the whole
 * costumer) and DepartmentDetailsPage.tsx (Flådestyring/KØRETØJER/BRUGERE,
 * all targeting selectedDepartmentId) — pages with several scope-switching
 * buttons where only one can ever be meaningfully in flight at a time.
 * CostumerAdministrationPage.tsx's own single quick-jump still uses the
 * plain useScopeSwitch instead, since there's only ever one button there.
 */
export function useScopeSwitchGroup() {
  const { switchDepartment } = useAuth();
  const navigate = useNavigate();
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const switchAndNavigate = async (key: string, departmentId: string | null, costumerId: string | null | undefined, to: string) => {
    if (isSwitching) return;
    setActiveKey(key);
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

  return { isSwitching, error, activeKey, switchAndNavigate };
}
