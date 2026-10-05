// The "FLEETii" costumer: FLEETii's own internal costumer row, as opposed to
// a real paying costumer. Sysadms have no costumer of their own (their
// costumer_id is only a Data Filter pointer — see CLAUDE.md), so this is the
// costumer the app treats as their "home" for display purposes, e.g.
// DepartmentPage.tsx's own "Systemadministratorer" table.
//
// Matched by costumer_id rather than by name (user decision 2026-10-05), so
// renaming the costumer can't silently switch the behaviour off. The id is
// production's own row; staging only shows the same behaviour if it has a
// costumer row with this exact costumer_id.
export const FLEETII_COSTUMER_ID = "a332c561-c686-4b9f-a2d4-67cb37ddf64c";

/** True if `costumerId` is the internal FLEETii costumer (see FLEETII_COSTUMER_ID). */
export function isFleetiiCostumer(costumerId?: string | null): boolean {
  return costumerId === FLEETII_COSTUMER_ID;
}
