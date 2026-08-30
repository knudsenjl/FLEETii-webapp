// Shared `user_profiles.role` checks. Every page/component that needs to
// know "is this profile any kind of admin?" or "is this specifically the
// platform-wide FLEETii admin?" used to re-implement the same raw string
// comparison (`profile?.role === "FLEETii admin"`, etc.) at its own call
// site — over 20 of them across src/, each one a chance to typo the literal
// or miss updating it when a role's meaning changed (this already caused two
// separate bugfixes on VehicleDetailsPage.tsx alone: 2026-07-18 for the
// admin gap, 2026-07-30 for the FLEETii-admin one, because the second
// version of this exact check was missed the first time). Centralizing here
// means a future role-model change only needs to happen once.
export type UserRole = "user" | "admin" | "FLEETii admin";

/** True if `role` is exactly "FLEETii admin" — the platform-wide role, not scoped to any one department/costumer. */
export function isFleetiiAdmin(role?: string | null): boolean {
  return role === "FLEETii admin";
}

/** True if `role` is exactly "admin" — a department-scoped admin, distinct from "FLEETii admin" (see isFleetiiAdmin). */
export function isDepartmentAdmin(role?: string | null): boolean {
  return role === "admin";
}

/** True if `role` is either admin tier ("admin" or "FLEETii admin") — the common "may manage this department's users/vehicles" check. */
export function isAnyAdmin(role?: string | null): boolean {
  return role === "admin" || role === "FLEETii admin";
}
