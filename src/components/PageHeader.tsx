// The header block shown at the top of every page (logo, "Log ud", the "i"
// about-button, and the role/afdeling row). Reads auth state directly via
// useAuth() rather than taking props, so every page can just render
// <PageHeader /> with no wiring — this is the single source of truth for
// that layout; changing it here changes it everywhere.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { FleetiiLogo } from "./FleetiiLogo";
import { InlinePopup } from "./InlinePopup";

/** The settings route for a given `user_profiles.role` — "FLEETii admin" gets its own page, everyone else gets "admin" or "user" (any non-"admin" role, including null/undefined, is treated as a regular user, matching formatRoleLabel's convention). */
function settingsPathForRole(role?: string | null): string {
  if (role === "FLEETii admin") return "/settings-superadmin";
  return role === "admin" ? "/settings-department" : "/settings-user";
}

/** True unless VITE_DATA_SOURCE is explicitly the real production adaptor — same "anything else is the safe/test default" convention as twoHireClient.ts's own reading of this var server-side. Gates the round test icon below (and the seed-test-bookings.mts function it calls, which re-checks this same var server-side rather than trusting the client). */
const isTestMode = import.meta.env.VITE_DATA_SOURCE !== "2hire-production-adaptor";

/** Standard page header: logo, sign-out button (only when logged in), a "change department" button (only when logged in — opens a dropdown of the user's other user_departments grants, or a 3s "no other departments" InlinePopup if they have none; see AuthContext's switchDepartment), a role-specific settings link (only when logged in), an "About" link, and the current user's role/department. Used on every page — public pages (like AboutPage) get the logged-out variant automatically since isFullyAuthenticated is false there. */
export function PageHeader() {
  const {
    signOut,
    profile,
    afdeling,
    afdelingId,
    costumerName,
    availableDepartments,
    switchDepartment,
    isFullyAuthenticated,
    session,
  } = useAuth();
  const navigate = useNavigate();
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [seedingBookings, setSeedingBookings] = useState(false);
  const [seedResultMessage, setSeedResultMessage] = useState<string | null>(null);

  const otherDepartments = availableDepartments.filter((d) => d.department_id !== afdelingId);

  const handleSwitch = async (departmentId: string) => {
    setSwitcherOpen(false);
    const error = await switchDepartment(departmentId);
    if (error) {
      setSwitchError(error);
      triggerNotImplemented("switch-department-error");
    }
  };

  /** Calls seed-test-bookings.mts (test-mode only — see isTestMode above) to populate every department with a handful of realistic bookings, then shows a short result summary via the same InlinePopup pattern as switchError. */
  const handleSeedTestBookings = async () => {
    setSeedingBookings(true);
    try {
      const response = await fetch("/.netlify/functions/seed-test-bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const result = (await response.json()) as {
        error?: string;
        created?: { department: string; count: number }[];
        skipped?: { department: string; reason: string }[];
      };
      if (!response.ok) {
        setSeedResultMessage(result.error ?? "Kunne ikke oprette testreservationer.");
      } else {
        const total = (result.created ?? []).reduce((sum, d) => sum + d.count, 0);
        const skippedCount = result.skipped?.length ?? 0;
        setSeedResultMessage(
          `${total} testreservationer oprettet i ${result.created?.length ?? 0} afdelinger` +
            (skippedCount > 0 ? ` (${skippedCount} afdeling(er) sprunget over).` : "."),
        );
      }
    } catch {
      setSeedResultMessage("Kunne ikke kontakte serveren.");
    } finally {
      setSeedingBookings(false);
      triggerNotImplemented("seed-test-bookings-result");
    }
  };

  return (
    <div className="mb-2 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <FleetiiLogo className="h-8 w-auto shrink-0" linkToHome />
        <div className="flex items-center justify-end gap-3">
          {isFullyAuthenticated && isTestMode && (
            <div className="relative">
              <button
                type="button"
                onClick={() => void handleSeedTestBookings()}
                disabled={seedingBookings}
                aria-label="Opret testreservationer"
                title="Opret testreservationer (kun testmiljø)"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
                  <path d="M9 3h6" />
                  <path d="M10 3v6.5L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9.5V3" />
                </svg>
              </button>
              <InlinePopup visible={notImplementedKey === "seed-test-bookings-result"} message={seedResultMessage ?? ""} align="right" />
            </div>
          )}
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
                onClick={() =>
                  otherDepartments.length === 0
                    ? triggerNotImplemented("no-other-departments")
                    : setSwitcherOpen((open) => !open)
                }
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
              <InlinePopup visible={notImplementedKey === "no-other-departments"} message="Ingen andre afdelinger tilgængelige" align="right" />
              <InlinePopup visible={notImplementedKey === "switch-department-error"} message={switchError ?? "Kunne ikke skifte afdeling."} align="right" />
              {switcherOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSwitcherOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-lg border border-brand-200 bg-white py-1 text-sm shadow-lg">
                    {otherDepartments.map((department) => (
                      <button
                        key={department.department_id}
                        type="button"
                        onClick={() => void handleSwitch(department.department_id)}
                        className="block w-full truncate px-3 py-2 text-left text-brand-700 transition hover:bg-brand-50"
                      >
                        {department.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
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
          <p className="shrink-0 truncate text-[0.7rem] font-medium text-brand-600">
            Afdeling: {costumerName ? `${costumerName}/` : ""}
            {afdeling ?? "—"}
          </p>
        </div>
      )}
    </div>
  );
}
