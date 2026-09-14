import { useMemo } from "react";
import { useAuth } from "../contexts/AuthContext";
import { isSysadm as isSysadmRole } from "../lib/roles";

/**
 * The global header's active department (afdelingId), applied only if it's
 * actually relevant to `targetCostumerId` — else null (no narrowing, whole-
 * costumer view). Shared by VehiclesPage.tsx/DepartmentPage.tsx/
 * FleetManagementPage.tsx, whose own copies of this exact formula used to
 * drift independently before being centralized here.
 *
 * afdelingScopedToAllGrants (non-sysadm's own local "Alle" — see
 * AuthContext.tsx's own doc comment) forces this to null regardless of
 * afdelingId: a regular admin's afdelingId is never null (switchDepartment
 * rejects departmentId=null for that role), so without this check they
 * could never reach a page's own whole-costumer view.
 *
 * The membership check (afdelingId must be one of availableDepartments,
 * and — for a sysadm — must belong to targetCostumerId) guards against a
 * page rendered for a DIFFERENT costumer than the header's currently-active
 * department: without it, that foreign department_id would incorrectly try
 * to narrow the list to nothing instead of correctly showing the whole
 * (unrelated) costumer.
 *
 * Memoized — availableDepartments can span every department platform-wide
 * for a sysadm, so this membership scan is worth skipping on renders where
 * none of its own inputs actually changed.
 */
export function useEffectiveAfdelingId(targetCostumerId: string | null): string | null {
  const { profile, afdelingId, availableDepartments, afdelingScopedToAllGrants } = useAuth();
  const isSysadm = isSysadmRole(profile?.role);

  return useMemo(() => {
    if (!isSysadm && afdelingScopedToAllGrants) return null;
    if (
      afdelingId &&
      availableDepartments.some((d) => d.department_id === afdelingId && (!isSysadm || d.costumerId === targetCostumerId))
    ) {
      return afdelingId;
    }
    return null;
  }, [isSysadm, afdelingScopedToAllGrants, afdelingId, availableDepartments, targetCostumerId]);
}
