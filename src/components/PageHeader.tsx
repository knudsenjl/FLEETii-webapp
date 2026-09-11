// The header block shown at the top of every page (logo, "Log ud", the "i"
// about-button, and the role/afdeling row). Reads auth state directly via
// useAuth() rather than taking props, so every page can just render
// <PageHeader /> with no wiring — this is the single source of truth for
// that layout; changing it here changes it everywhere.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { isAnyAdmin, isDepartmentAdmin, isSysadm } from "../lib/roles";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { FleetiiLogo } from "./FleetiiLogo";
import { InlinePopup } from "./InlinePopup";

/** One entry in the settings button's dropdown menu (admin/sysadm only — see settingsMenuItemsForRole). */
type SettingsMenuItem = { label: string; path: string };

/**
 * One page-owned, non-persisted filter field surfaced inside the "Data
 * Filter" popup alongside Kunde/Afdeling — Bruger (AllBookingsPage.tsx/
 * DepartmentPage.tsx) and Køretøj (VehiclesPage.tsx/FleetManagementPage.tsx/
 * AllBookingsPage.tsx). The page itself still owns the state/option list/
 * scoping logic entirely; this is purely "render my own filter's <select>
 * inside your popup instead of a separate funnel popup of my own." Unlike
 * Kunde/Afdeling, nothing here is persisted (see the filter-redesign work's
 * own decision on this) — value/onChange are just this page's own useState,
 * passed straight through.
 */
export interface PageHeaderFilterField {
  /** Field label, e.g. "Bruger" or "Bruger-ID" (AllBookingsPage.tsx toggles this based on useUserIdent). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

/**
 * The settings destination(s) for a given `user_profiles.role`. A plain
 * "user" (any non-"admin"/"sysadm" role, including null/undefined,
 * matching formatRoleLabel's convention) has only one settings page
 * (personal), so the settings button navigates straight there — no menu.
 * "admin"/"sysadm" have TWO: their own personal settings (previously
 * unreachable at all — "/settings-user" required role==="user" exactly,
 * see App.tsx) alongside their department/FLEETii-wide settings page —
 * hence a small menu instead of a single destination.
 */
function settingsMenuItemsForRole(role?: string | null): SettingsMenuItem[] {
  if (isSysadm(role)) {
    return [
      { label: "Brugerindstillinger", path: "/settings-user" },
      { label: "FLEETii-indstillinger", path: "/settings-superadmin" },
    ];
  }
  if (isDepartmentAdmin(role)) {
    return [
      { label: "Brugerindstillinger", path: "/settings-user" },
      { label: "Afdelingsindstillinger", path: "/settings-department" },
    ];
  }
  return [];
}

/** True unless VITE_DATA_SOURCE is explicitly the real production adaptor — same "anything else is the safe/test default" convention as twoHireClient.ts's own reading of this var server-side. Gates the round test icon below (and the seed-test-bookings.mts function it calls, which re-checks this same var server-side rather than trusting the client). */
const isTestMode = import.meta.env.VITE_DATA_SOURCE !== "2hire-production-adaptor";

/** Standard page header: logo, sign-out button (only when logged in), a reload button (always shown, logged in or not — a real window.location.reload(), since the app's fixed-position body means iOS's native pull-to-refresh doesn't work here), a "Data Filter" button (only when logged in — funnel icon, same as every page's own former "Filtrer" button; opens a popup with a Kunde+Afdeling <select> pair, or a 3s "no departments" InlinePopup in the edge case a non-sysadm has none at all; see AuthContext's switchDepartment), a settings button (only when logged in — role "user" navigates straight to their personal settings, the only one they have; "admin"/"sysadm" instead open a dropdown offering BOTH their personal settings and their department/FLEETii-wide one, since they have two — see settingsMenuItemsForRole), an "About" link, and the current user's role/department. For a sysadm, the popup's Afdeling <select> lists every department under the currently-picked Kunde (or every department platform-wide once the Kunde <select> is "Alle" — see AuthContext's loadAvailableDepartments), and picking "Alle" in the Afdeling <select> alone (Kunde left as-is) persists that Kunde's own "every department" scope rather than fully unscoping — see handleSwitch's own doc comment. A regular admin never sees the Kunde <select> at all — only Afdeling, listing their own grant list, always scoped to their own single costumer. Deliberately styled as labeled <select> fields (same classes as every page's own "Filtrer" funnel popup, e.g. VehiclesPage.tsx) rather than a custom menu — this is the single, persisted source of truth for the app-wide Kunde/Afdeling scope those per-page popups themselves read (see the filter-redesign work), so sharing their visual language keeps the two families of popup legible as the same kind of control. Used on every page — public pages (like AboutPage) get the logged-out variant automatically since isFullyAuthenticated is false there.
 *
 * `compact` (BookingPage.tsx/BookingsPage.tsx's mobile-first layout only —
 * every other page stays the full header): shrinks the logo and drops the
 * role/afdeling text row below it, since that context is either obvious
 * (role "user", the only role reaching a compact page) or already shown
 * elsewhere on those pages. Every icon button and its dropdown/menu logic is
 * untouched — same state, same handlers — only the two things named above
 * change, so there's nothing to duplicate on the compact pages.
 *
 * `rolleFilter`/`brugerFilter`/`navnFilter`/`koretoejFilter` (optional,
 * page-supplied — see PageHeaderFilterField): when given, render as extra
 * labeled <select> fields in the "Data Filter" popup below Kunde/
 * Afdeling, in that fixed order (Rolle > Bruger/Navn hierarchy first, then
 * Køretøj, a separate axis) — letting that one popup double as the page's
 * whole "narrow what I'm looking at" control instead of a separate funnel
 * popup. Absent on pages with no such concept (e.g. VehiclesPage.tsx has
 * no Bruger/Rolle/Navn). */
export function PageHeader({
  compact = false,
  rolleFilter,
  brugerFilter,
  navnFilter,
  koretoejFilter,
}: {
  compact?: boolean;
  rolleFilter?: PageHeaderFilterField;
  brugerFilter?: PageHeaderFilterField;
  navnFilter?: PageHeaderFilterField;
  koretoejFilter?: PageHeaderFilterField;
} = {}) {
  const {
    signOut,
    profile,
    afdeling,
    afdelingId,
    costumerName,
    costumerId,
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

  /** Whether the Kunde <select> and the Afdeling <select>'s own "Alle" option should be offered — only for a sysadm (afdelingId === null IS "Alle" — see AuthContext's switchDepartment/loadAvailableDepartments). Regular admins never see either: their afdelingId is always a real department within their own fixed costumer, and "Alle" isn't a valid state for them at all. */
  const canSwitchToAll = isSysadm(profile?.role);

  /** Sysadm-only: every distinct Kunde availableDepartments spans, for the Kunde <select> below — deduped by costumerId (the grouping key, not costumerName, which can collide across costumers), sorted by name. */
  const kundeOptions = canSwitchToAll
    ? Array.from(
        new Map(
          availableDepartments
            .filter((d): d is typeof d & { costumerId: string } => Boolean(d.costumerId))
            .map((d) => [d.costumerId, d.costumerName ?? "Kunde"] as const),
        ).entries(),
      ).sort((a, b) => a[1].localeCompare(b[1]))
    : [];
  /** Options for the Afdeling <select> below — sysadm: every department under the currently-active Kunde (global costumerId), or every department platform-wide once Kunde is "Alle" (costumerId null); non-sysadm: their own grant list, unfiltered (they have no Kunde field to narrow by, and every entry is already within their one fixed costumer). */
  const afdelingOptions = canSwitchToAll ? availableDepartments.filter((d) => !costumerId || d.costumerId === costumerId) : availableDepartments;

  /**
   * departmentId null means "Alle" (no costumerId) or "just this Kunde"
   * (costumerId given) — see canSwitchToAll/AuthContext's switchDepartment.
   * costumerId is only ever meaningful (and only ever passed) alongside a
   * null departmentId.
   *
   * Deliberately does NOT close the popup (unlike a plain menu click would)
   * — same "stays open until the outside-click overlay closes it" behavior
   * as every page's own funnel-filter popup, and functionally required
   * here: picking a Kunde must leave the Afdeling <select> reachable for a
   * second pick, not close the popup out from under it.
   */
  const handleSwitch = async (departmentId: string | null, costumerId?: string | null) => {
    const error = await switchDepartment(departmentId, costumerId);
    if (error) {
      setSwitchError(error);
      triggerNotImplemented("switch-department-error");
    }
  };

  /** Calls seed-test-bookings.mts (test-mode only — see isTestMode above — and admin/sysadm only, both re-checked server-side) to populate departments with a handful of realistic bookings, then shows a short result summary via the same InlinePopup pattern as switchError. A regular admin only seeds departments under their own costumer; a sysadm seeds every costumer's departments — see seed-test-bookings.mts. */
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
          {isFullyAuthenticated && isTestMode && isAnyAdmin(profile?.role) && (
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
              onClick={() => {
                // Every OTHER page redirects to "/" on its own the instant
                // isFullyAuthenticated flips false (ProtectedRoute's own
                // guard) — but AboutPage.tsx is the one deliberately public
                // route with no such guard, so signing out from there left
                // the admin stranded on /about, still logged out, with
                // nothing moving them back to the login screen. Navigating
                // explicitly here fixes that case without depending on
                // whichever page happened to render this button. Awaited
                // (not fire-and-forget) so isFullyAuthenticated has already
                // flipped false by the time we land on "/" — otherwise
                // RootRoute would see a still-authenticated profile there
                // for one render and bounce straight back to /admin or
                // /booking before the sign-out actually finished.
                void (async () => {
                  await signOut();
                  navigate("/", { replace: true });
                })();
              }}
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
          {/* Explicit reload — body is position:fixed (see index.css), so the
              actual page/document never scrolls and iOS's native
              pull-to-refresh has no scroll surface to hook onto here;
              confirmed this app-shell layout is genuinely incompatible with
              that gesture, not just an overscroll-behavior setting (see
              f1abec8's own commit message). A real window.location.reload(),
              one tap, works regardless of platform. Always shown (logged in
              or not), same as when this was first added — removed for a
              stretch, reinstated here right after Log ud. */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            aria-label="Genindlæs siden"
            title="Genindlæs siden"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-brand-700 transition hover:bg-brand-100"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
              <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
          {isFullyAuthenticated && (
            // z-[1001] (not just the dropdown's own z-20 below) — Leaflet's
            // own controls/panes reach z-index 1000 on map pages
            // (FleetManagementPage.tsx/VehicleDetailsPage.tsx/
            // BookingDetailsPage.tsx), and this div otherwise has no
            // z-index of its own, so its dropdown would be compared
            // directly against Leaflet's much higher values in the shared
            // ambient stacking context and lose, rendering underneath the
            // map — same fix FleetManagementPage.tsx's own funnel-filter
            // button already needed for the same reason. Only became
            // reachable once Kunde/Afdeling scoping moved into this
            // "Data Filter" control (see the filter-redesign work) —
            // before that, a sysadm on the map page used that page's own
            // local Kunde/Afdeling filter instead, which already had this
            // z-index.
            <div className="relative z-[1001]">
              <button
                type="button"
                onClick={() =>
                  availableDepartments.length === 0 &&
                  !canSwitchToAll &&
                  !rolleFilter &&
                  !brugerFilter &&
                  !navnFilter &&
                  !koretoejFilter
                    ? triggerNotImplemented("no-other-departments")
                    : setSwitcherOpen((open) => !open)
                }
                aria-label="Data Filter"
                title="Data Filter"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-brand-700 transition hover:bg-brand-100"
              >
                {/* Same funnel icon every page's own "Filtrer" popup uses (e.g. VehiclesPage.tsx) — this control is now that same family of filter, just app-wide/persisted for Kunde/Afdeling. */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
                  <polygon points="4 4 20 4 14 12.5 14 19 10 21 10 12.5 4 4" />
                </svg>
              </button>
              <InlinePopup visible={notImplementedKey === "no-other-departments"} message="Ingen afdelinger tilgængelige" align="right" />
              <InlinePopup visible={notImplementedKey === "switch-department-error"} message={switchError ?? "Kunne ikke skifte afdeling."} align="right" />
              {switcherOpen && <div className="fixed inset-0 z-10" onClick={() => setSwitcherOpen(false)} />}
              {/* Same InlinePopup shell + labeled <select> fields every "Filtrer" funnel popup uses (VehiclesPage.tsx/FleetManagementPage.tsx/AllBookingsPage.tsx/DepartmentPage.tsx) — card/border/shadow/text size/fade-in AND the select's own bg-brand-50/60 box styling, for visual consistency now that this control and those popups are the same "narrow what I'm looking at" family, just persisted here instead of page-local. */}
              <InlinePopup
                visible={switcherOpen}
                align="right"
                message={
                  <>
                    {canSwitchToAll && (
                      <label className="mb-2 block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-800">
                        Kunde
                        <select
                          value={costumerId ?? ""}
                          onChange={(e) => void handleSwitch(null, e.target.value || null)}
                          className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                        >
                          <option value="">Alle</option>
                          {kundeOptions.map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="mb-2 block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-800">
                      Afdeling
                      <select
                        value={afdelingId ?? ""}
                        onChange={(e) => {
                          const departmentId = e.target.value || null;
                          // Picking a real department always wins outright
                          // (costumerId omitted — switch-department.mts
                          // derives it from the department itself). Picking
                          // "Alle" here instead preserves whichever Kunde is
                          // currently active (the Kunde <select> above, or
                          // "Alle" already if that's what it is) rather than
                          // always fully unscoping — same "just this Kunde,
                          // every department" state the Kunde <select>'s own
                          // onChange sets, just reached from this field too.
                          void handleSwitch(departmentId, departmentId ? undefined : costumerId);
                        }}
                        className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                      >
                        {canSwitchToAll && <option value="">Alle</option>}
                        {afdelingOptions.map((department) => (
                          <option key={department.department_id} value={department.department_id}>
                            {department.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {/* Rolle/Bruger/Navn/Køretøj — a page's own extra filter fields (see PageHeaderFilterField), always in this fixed order regardless of which ones a given page actually supplies. mb-2 on every one but Køretøj, always the last of the four when present. */}
                    {rolleFilter && (
                      <label className="mb-2 block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-800">
                        {rolleFilter.label}
                        <select
                          value={rolleFilter.value}
                          onChange={(e) => rolleFilter.onChange(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                        >
                          <option value="">Alle</option>
                          {rolleFilter.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {brugerFilter && (
                      <label className="mb-2 block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-800">
                        {brugerFilter.label}
                        <select
                          value={brugerFilter.value}
                          onChange={(e) => brugerFilter.onChange(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                        >
                          <option value="">Alle</option>
                          {brugerFilter.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {navnFilter && (
                      <label className="mb-2 block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-800">
                        {navnFilter.label}
                        <select
                          value={navnFilter.value}
                          onChange={(e) => navnFilter.onChange(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                        >
                          <option value="">Alle</option>
                          {navnFilter.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {koretoejFilter && (
                      <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-800">
                        {koretoejFilter.label}
                        <select
                          value={koretoejFilter.value}
                          onChange={(e) => koretoejFilter.onChange(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                        >
                          <option value="">Alle</option>
                          {koretoejFilter.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {(rolleFilter?.value || brugerFilter?.value || navnFilter?.value || koretoejFilter?.value) && (
                      <button
                        type="button"
                        onClick={() => {
                          rolleFilter?.onChange("");
                          brugerFilter?.onChange("");
                          navnFilter?.onChange("");
                          koretoejFilter?.onChange("");
                        }}
                        className="mt-2 text-[0.7rem] font-medium text-accent-600 hover:underline"
                      >
                        Nulstil filter
                      </button>
                    )}
                  </>
                }
              />
            </div>
          )}
          {isFullyAuthenticated && (
            // Same Leaflet-beating z-[1001] as the "Data Filter" wrapper above.
            <div className="relative z-[1001]">
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
            {/* afdeling is only ever null for a sysadm sitting on "Alle" (fully unscoped) or the newer "Kunde only" state (costumerId set, no specific department — see the Kunde-header row above); every other role always has a real department, so "—" (missing data) never actually applies to them. Distinguished by costumerId, since both states share a null afdeling. */}
            {afdeling ?? (isSysadm(profile?.role) ? (costumerId ? "Alle afdelinger" : "Alle") : "—")}
          </p>
        </div>
      )}
    </div>
  );
}
