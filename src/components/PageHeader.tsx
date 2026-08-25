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

/** One entry in the settings button's dropdown menu (admin/FLEETii admin only — see settingsMenuItemsForRole). */
type SettingsMenuItem = { label: string; path: string };

/**
 * The settings destination(s) for a given `user_profiles.role`. A plain
 * "user" (any non-"admin"/"FLEETii admin" role, including null/undefined,
 * matching formatRoleLabel's convention) has only one settings page
 * (personal), so the settings button navigates straight there — no menu.
 * "admin"/"FLEETii admin" have TWO: their own personal settings (previously
 * unreachable at all — "/settings-user" required role==="user" exactly,
 * see App.tsx) alongside their department/FLEETii-wide settings page —
 * hence a small menu instead of a single destination.
 */
function settingsMenuItemsForRole(role?: string | null): SettingsMenuItem[] {
  if (role === "FLEETii admin") {
    return [
      { label: "Brugerindstillinger", path: "/settings-user" },
      { label: "FLEETii-indstillinger", path: "/settings-superadmin" },
    ];
  }
  if (role === "admin") {
    return [
      { label: "Brugerindstillinger", path: "/settings-user" },
      { label: "Afdelingsindstillinger", path: "/settings-department" },
    ];
  }
  return [];
}

/** True unless VITE_DATA_SOURCE is explicitly the real production adaptor — same "anything else is the safe/test default" convention as twoHireClient.ts's own reading of this var server-side. Gates the round test icon below (and the seed-test-bookings.mts function it calls, which re-checks this same var server-side rather than trusting the client). */
const isTestMode = import.meta.env.VITE_DATA_SOURCE !== "2hire-production-adaptor";

/** Standard page header: logo, sign-out button (only when logged in), a "change department" button (only when logged in — opens a dropdown of the user's other user_departments grants, or a 3s "no other departments" InlinePopup if they have none; see AuthContext's switchDepartment), a settings button (only when logged in — role "user" navigates straight to their personal settings, the only one they have; "admin"/"FLEETii admin" instead open a dropdown offering BOTH their personal settings and their department/FLEETii-wide one, since they have two — see settingsMenuItemsForRole), an "About" link, and the current user's role/department. For a FLEETii admin, the "change department" dropdown lists EVERY department platform-wide (not a personal grant list — see AuthContext's loadAvailableDepartments), each shown as "Kunde / Afdeling" (department.costumerName) rather than just the department name, since the same department name can recur across different costumers — plus a leading "Alle" entry (only when NOT already on it, i.e. afdelingId !== null) that clears back to their default, fully unscoped state. Used on every page — public pages (like AboutPage) get the logged-out variant automatically since isFullyAuthenticated is false there.
 *
 * `compact` (BookingPage.tsx/BookingsPage.tsx's mobile-first layout only —
 * every other page stays the full header): shrinks the logo and drops the
 * role/afdeling text row below it, since that context is either obvious
 * (role "user", the only role reaching a compact page) or already shown
 * elsewhere on those pages. Every icon button and its dropdown/menu logic is
 * untouched — same state, same handlers — only the two things named above
 * change, so there's nothing to duplicate on the compact pages. */
export function PageHeader({ compact = false }: { compact?: boolean } = {}) {
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
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsMenuItems = settingsMenuItemsForRole(profile?.role);

  const otherDepartments = availableDepartments.filter((d) => d.department_id !== afdelingId);
  /** Whether the "Alle" pseudo-entry (below) should be offered — only for a FLEETii admin, and only when they're NOT already on it (afdelingId === null IS "Alle" — see AuthContext's switchDepartment/loadAvailableDepartments). Regular admins never see this: their afdelingId is always a real department, and "Alle" isn't a valid state for them at all. */
  const canSwitchToAll = profile?.role === "FLEETii admin" && afdelingId !== null;

  /** departmentId null means "Alle" (see canSwitchToAll/AuthContext's switchDepartment) — the FLEETii admin's own default, unscoped state. */
  const handleSwitch = async (departmentId: string | null) => {
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
        <FleetiiLogo className={compact ? "h-6 w-auto shrink-0" : "h-8 w-auto shrink-0"} linkToHome />
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
              type="button"
              onClick={() => void signOut()}
              aria-label="Log ud"
              title="Log ud"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-brand-700 transition hover:bg-brand-100"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          )}
          {isFullyAuthenticated && (
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  otherDepartments.length === 0 && !canSwitchToAll
                    ? triggerNotImplemented("no-other-departments")
                    : setSwitcherOpen((open) => !open)
                }
                aria-label="Skift afdeling"
                title="Skift afdeling"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-brand-700 transition hover:bg-brand-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
                  {/* Hierarchy/org-chart icon (root -> two child departments) —
                      replaced the earlier swap-arrows icon, which looked too
                      similar to the new reload button right next to it. */}
                  <path d="M9 7h6" />
                  <path d="M9 7v10h6" />
                  <rect x="3" y="4" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
                  <rect x="15" y="4" width="6" height="6" rx="1" />
                  <rect x="15" y="14" width="6" height="6" rx="1" />
                </svg>
              </button>
              <InlinePopup visible={notImplementedKey === "no-other-departments"} message="Ingen andre afdelinger tilgængelige" align="right" />
              <InlinePopup visible={notImplementedKey === "switch-department-error"} message={switchError ?? "Kunne ikke skifte afdeling."} align="right" />
              {switcherOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSwitcherOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-lg border border-brand-200 bg-white py-1 text-sm shadow-lg">
                    {canSwitchToAll && (
                      <button
                        type="button"
                        onClick={() => void handleSwitch(null)}
                        className="block w-full truncate px-3 py-2 text-left font-medium text-brand-700 transition hover:bg-brand-50"
                      >
                        Alle
                      </button>
                    )}
                    {otherDepartments.map((department) => (
                      <button
                        key={department.department_id}
                        type="button"
                        onClick={() => void handleSwitch(department.department_id)}
                        className="block w-full truncate px-3 py-2 text-left text-brand-700 transition hover:bg-brand-50"
                      >
                        {department.costumerName ? `${department.costumerName} / ${department.name}` : department.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {isFullyAuthenticated && (
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  settingsMenuItems.length === 0
                    ? navigate("/settings-user")
                    : setSettingsMenuOpen((open) => !open)
                }
                aria-label="Indstillinger"
                title="Indstillinger"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-brand-700 transition hover:bg-brand-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
              </button>
              {settingsMenuOpen && settingsMenuItems.length > 0 && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSettingsMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-lg border border-brand-200 bg-white py-1 text-sm shadow-lg">
                    {settingsMenuItems.map((item) => (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => {
                          setSettingsMenuOpen(false);
                          navigate(item.path);
                        }}
                        className="block w-full truncate px-3 py-2 text-left text-brand-700 transition hover:bg-brand-50"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate("/about")}
            aria-label="Om FLEETii"
            title="Om FLEETii"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50 font-serif text-base font-bold italic text-brand-700 transition hover:bg-brand-100"
          >
            i
          </button>
        </div>
      </div>
      {!compact && isFullyAuthenticated && (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[0.7rem] font-medium text-brand-600">{formatRoleLabel(profile?.role)}: {profile?.full_name ?? "—"} ({profile?.email ?? "—"})</p>
          <p className="shrink-0 truncate text-[0.7rem] font-medium text-brand-600">
            Afdeling: {costumerName ? `${costumerName}/` : ""}
            {/* afdeling is only ever null for a FLEETii admin sitting on "Alle" (see PageHeader's own "Skift afdeling" pseudo-entry) — every other role always has a real department, so "—" (missing data) never actually applies to them. */}
            {afdeling ?? (profile?.role === "FLEETii admin" ? "Alle" : "—")}
          </p>
        </div>
      )}
    </div>
  );
}
