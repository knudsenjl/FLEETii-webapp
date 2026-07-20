// The header block shown at the top of every page (logo, "Log ud", the "i"
// about-button, and the role/afdeling row). Reads auth state directly via
// useAuth() rather than taking props, so every page can just render
// <PageHeader /> with no wiring — this is the single source of truth for
// that layout; changing it here changes it everywhere.
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { FleetiiLogo } from "./FleetiiLogo";
import { InlinePopup } from "./InlinePopup";

/** The settings route for a given `user_profiles.role` — "FLEETii admin" gets its own page, everyone else gets "admin" or "user" (any non-"admin" role, including null/undefined, is treated as a regular user, matching formatRoleLabel's convention). */
function settingsPathForRole(role?: string | null): string {
  if (role === "FLEETii admin") return "/settings-superadmin";
  return role === "admin" ? "/settings-admin" : "/settings-user";
}

/** Standard page header: logo, sign-out button (only when logged in), a "change department" button (only when logged in — not implemented yet, shows a 3s InlinePopup), a role-specific settings link (only when logged in), an "About" link, and the current user's role/department. Used on every page — public pages (like AboutPage) get the logged-out variant automatically since isFullyAuthenticated is false there. */
export function PageHeader() {
  const { signOut, profile, afdeling, isFullyAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();

  return (
    <div className="mb-2 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <FleetiiLogo className="h-8 w-auto shrink-0" linkToHome />
        <div className="flex items-center justify-end gap-3">
          {isFullyAuthenticated && (
            <button
              onClick={() => void signOut()}
              className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
            >
              Log ud
            </button>
          )}
          {isFullyAuthenticated && (
            <div className="relative">
              <button
                type="button"
                onClick={() => triggerNotImplemented("change-department")}
                aria-label="Skift afdeling"
                title="Skift afdeling"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-white text-brand-700 transition hover:bg-brand-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
                  <path d="M8 3 4 7l4 4" />
                  <path d="M4 7h11a5 5 0 0 1 5 5v1" />
                  <path d="m16 21 4-4-4-4" />
                  <path d="M20 17H9a5 5 0 0 1-5-5v-1" />
                </svg>
              </button>
              <InlinePopup visible={notImplementedKey === "change-department"} message="Endnu ikke implementeret" align="right" />
            </div>
          )}
          {isFullyAuthenticated && (
            <button
              type="button"
              onClick={() => navigate(settingsPathForRole(profile?.role))}
              aria-label="Indstillinger"
              title="Indstillinger"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-white text-brand-700 transition hover:bg-brand-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate("/about")}
            aria-label="Om FLEETii"
            title="Om FLEETii"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-white font-serif text-base font-bold italic text-brand-700 transition hover:bg-brand-50"
          >
            i
          </button>
        </div>
      </div>
      {isFullyAuthenticated && (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[0.7rem] font-medium text-brand-600">{formatRoleLabel(profile?.role)}: {profile?.full_name ?? "—"} ({profile?.email ?? "—"})</p>
          <p className="shrink-0 truncate text-[0.7rem] font-medium text-brand-600">Afdeling: {afdeling ?? "—"}</p>
        </div>
      )}
    </div>
  );
}
