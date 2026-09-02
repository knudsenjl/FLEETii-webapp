// Shared `user_profiles.role` checks. Every page/component that needs to
// know "is this profile any kind of admin?" or "is this specifically the
// platform-wide sysadm?" used to re-implement the same raw string
// comparison (`profile?.role === "sysadm"`, etc.) at its own call
// site — over 20 of them across src/, each one a chance to typo the literal
// or miss updating it when a role's meaning changed (this already caused two
// separate bugfixes on VehicleDetailsPage.tsx alone: 2026-07-18 for the
// admin gap, 2026-07-30 for the sysadm one, because the second
// version of this exact check was missed the first time). Centralizing here
// means a future role-model change only needs to happen once. (Renamed from
// "FLEETii admin" to "sysadm" 2026-09-02 — same role, same three-tier
// model, just a shorter name.)
export type UserRole = "user" | "admin" | "sysadm";

/** True if `role` is exactly "sysadm" — the platform-wide role, not scoped to any one department/costumer. */
export function isSysadm(role?: string | null): boolean {
  return role === "sysadm";
}

/** True if `role` is exactly "admin" — a department-scoped admin, distinct from "sysadm" (see isSysadm). */
export function isDepartmentAdmin(role?: string | null): boolean {
  return role === "admin";
}

/** True if `role` is either admin tier ("admin" or "sysadm") — the common "may manage this department's users/vehicles" check. */
export function isAnyAdmin(role?: string | null): boolean {
  return role === "admin" || role === "sysadm";
}
