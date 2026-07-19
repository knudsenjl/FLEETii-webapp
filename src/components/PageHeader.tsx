// The header block shown at the top of every page (logo, "Log ud", the "i"
// about-button, and the role/afdeling row). Reads auth state directly via
// useAuth() rather than taking props, so every page can just render
// <PageHeader /> with no wiring — this is the single source of truth for
// that layout; changing it here changes it everywhere.
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "./FleetiiLogo";

/** Standard page header: logo, sign-out button (only when logged in), an "About" link, and the current user's role/department. Used on every page — public pages (like AboutPage) get the logged-out variant automatically since isFullyAuthenticated is false there. */
export function PageHeader() {
  const { signOut, profile, afdeling, isFullyAuthenticated } = useAuth();
  const navigate = useNavigate();

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
          <button
            type="button"
            onClick={() => navigate("/about")}
            aria-label="Om FLEETii"
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
