// The header block shown at the top of every page (logo, "Log ud", the "i"
// about-button, and the role/afdeling row). Reads auth state directly via
// useAuth() rather than taking props, so every page can just render
// <PageHeader /> with no wiring — this is the single source of truth for
// that layout; changing it here changes it everywhere.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth, type DepartmentOption } from "../contexts/AuthContext";
import { isAnyAdmin, isDepartmentAdmin, isSysadm } from "../lib/roles";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { FleetiiLogo } from "./FleetiiLogo";
import { InlinePopup } from "./InlinePopup";
import { ClickOutsideOverlay } from "./ClickOutsideOverlay";

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
 * One page-owned "quick jump" field surfaced inside the "Data Filter"
 * popup — Køretøjer/Brugere on AdminFrontpage.tsx, which (unlike
 * VehiclesPage.tsx/DepartmentPage.tsx) shows no vehicle/user LIST of its
 * own to narrow with PageHeaderFilterField; picking one instead navigates
 * straight to that specific vehicle's/user's own detail page. Genuinely
 * different semantics from PageHeaderFilterField, not just a rename:
 * there's no persisted "current selection" to hold (the page navigates
 * away the instant one is picked) and thus no value/reset participation —
 * the <select> stays permanently on its own blank placeholder option.
 */
export interface PageHeaderNavigateField {
  /** Field label, e.g. "Køretøjer" or "Brugere". */
  label: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
}

/**
 * TwoHireCommandPage.tsx-only variant of the same "quick jump" idea as
 * PageHeaderNavigateField above, but for the Kunde <select> specifically —
 * that page has no Kunde/Afdeling scoping concept of its own at all (its
 * commands address a vehicle directly by plate/2hire id), so repurposing
 * the header's existing Kunde field to jump straight to that Kunde's own
 * /costumer-details is more useful there than the normal persisted-switch
 * behavior every other page relies on. Uses the same kundeOptions this
 * component already computes for the normal Kunde <select> — the page only
 * supplies where a pick should go, not the option list itself.
 */
export interface PageHeaderKundeNavigateField {
  onSelect: (costumerId: string) => void;
}

/**
 * CostumerAdministrationPage.tsx-only: the same "quick jump" repurposing as
 * PageHeaderKundeNavigateField above, but for the Afdeling <select> — that
 * page's own flat, costumer-agnostic list has no Kunde/Afdeling scoping
 * concept either, so picking a department there jumps straight to
 * /department-details with it pre-selected instead of persisting a scope
 * switch. Handed the full DepartmentOption (not just its id) since the
 * page needs that department's own costumerId/costumerName too, to build
 * DepartmentDetailsPage.tsx's own router-state contract.
 */
export interface PageHeaderAfdelingNavigateField {
  onSelect: (department: DepartmentOption) => void;
  /** True while onSelect's own async work (e.g. a useScopeSwitch call) is in flight — disables the <select> so a second pick can't fire an overlapping request. */
  disabled?: boolean;
  /** An error message from onSelect's own async work, shown via the same InlinePopup pattern as switchError just below. */
  error?: string | null;
}

/**
 * The settings destination(s) for a given `user_profiles.role`. A plain
 * "user" (any non-"admin"/"sysadm" role, including null/undefined,
 * matching formatRoleLabel's convention) has only one settings page
 * (personal — self-view of "/user-details/:ownUserId", see
 * UserDetailsPage.tsx), so the settings button navigates straight there —
 * no menu. "admin"/"sysadm" have TWO: their own personal settings (same
 * self-view route) alongside their department/FLEETii-wide settings page —
 * hence a small menu instead of a single destination. `ownUserId` is the
 * viewing user's own user_id (profile.user_id) — needed here since the
 * personal-settings destination is no longer a fixed path.
 */
function settingsMenuItemsForRole(role: string | null | undefined, ownUserId: string | undefined): SettingsMenuItem[] {
  const personalSettingsPath = `/user-details/${ownUserId}`;
  if (isSysadm(role)) {
    return [
      { label: "Brugerindstillinger", path: personalSettingsPath },
      { label: "FLEETii-indstillinger", path: "/settings-superadmin" },
    ];
  }
  if (isDepartmentAdmin(role)) {
    return [
      { label: "Brugerindstillinger", path: personalSettingsPath },
      { label: "Afdelingsindstillinger", path: "/department-settings" },
    ];
  }
  return [];
}

/** True unless VITE_DATA_SOURCE is explicitly the real production adaptor — same "anything else is the safe/test default" convention as twoHireClient.ts's own reading of this var server-side. Gates the round test icon below (and the seed-test-bookings.mts function it calls, which re-checks this same var server-side rather than trusting the client). */
const isTestMode = import.meta.env.VITE_DATA_SOURCE !== "2hire-production-adaptor";

/** Standard page header: logo, sign-out button (only when logged in), a back button (only when logged in — plain browser-history navigate(-1), sits between sign-out and reload), a reload button (always shown, logged in or not — a real window.location.reload(), since the app's fixed-position body means iOS's native pull-to-refresh doesn't work here), a "Data Filter" button (only when logged in — funnel icon, same as every page's own former "Filtrer" button; opens a popup with a Kunde+Afdeling <select> pair, or a 3s "no departments" InlinePopup in the edge case a non-sysadm has none at all; see AuthContext's switchDepartment), a settings button (only when logged in — role "user" navigates straight to their personal settings, the only one they have; "admin"/"sysadm" instead open a dropdown offering BOTH their personal settings and their department/FLEETii-wide one, since they have two — see settingsMenuItemsForRole), an "About" link, and the current user's role/department. For a sysadm, the popup's Afdeling <select> lists every department under the currently-picked Kunde (or every department platform-wide once the Kunde <select> is "Alle" — see AuthContext's loadAvailableDepartments), and picking "Alle" in the Afdeling <select> alone (Kunde left as-is) persists that Kunde's own "every department" scope rather than fully unscoping — see handleSwitch's own doc comment. A regular admin never sees the Kunde <select> at all — only Afdeling, listing their own grant list, always scoped to their own single costumer. Deliberately styled as labeled <select> fields (same classes as every page's own "Filtrer" funnel popup, e.g. VehiclesPage.tsx) rather than a custom menu — this is the single, persisted source of truth for the app-wide Kunde/Afdeling scope those per-page popups themselves read (see the filter-redesign work), so sharing their visual language keeps the two families of popup legible as the same kind of control. Used on every page — public pages (like AboutPage) get the logged-out variant automatically since isFullyAuthenticated is false there.
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
 * no Bruger/Rolle/Navn).
 *
 * `koretoejNavigate`/`brugerNavigate` (optional, page-supplied — see
 * PageHeaderNavigateField): render right after the filter fields above,
 * always in that order — AdminFrontpage.tsx's own "Køretøjer"/"Brugere"
 * quick-jump to a specific vehicle's/user's detail page, since that page
 * shows no list of its own to filter.
 *
 * `hideAfdelingAlle` (optional, page-supplied — DepartmentDetailsPage.tsx
 * only): suppresses the Afdeling <select>'s own "Alle" option regardless of
 * afdelingOptions.length. That page's entire concept is managing exactly
 * ONE selected department at a time (selectedDepartmentId) — there's no
 * "all departments at once" mode for it to mean anything, unlike every
 * other page that reads this global scope, so offering "Alle" there is
 * simply a dead choice (see that page's own "Kunde changing to Alle...does
 * nothing" doc comment).
 *
 * `hideAfdeling`/`kundeNavigate` (optional, page-supplied —
 * TwoHireCommandPage.tsx/AdminFrontpage.tsx only): those pages have no
 * Kunde/Afdeling scoping concept at all, so `hideAfdeling` drops the
 * Afdeling <select> entirely (not just its "Alle" option), and
 * `kundeNavigate` (see PageHeaderKundeNavigateField) repurposes the Kunde
 * <select> into a straight jump to that Kunde's own /costumer-details
 * instead of the normal persisted Kunde/Afdeling switch every other sysadm
 * page uses it for.
 *
 * `hideKundeAlle` (optional, page-supplied — CostumerDetailsPage.tsx only):
 * same idea as `hideAfdelingAlle` above, but for the (non-navigate) Kunde
 * <select>'s own "Alle" option — that page manages exactly ONE costumer at
 * a time, so "every costumer at once" is a dead choice there too (see its
 * own "Kunde changing to Alle...does nothing" doc comment).
 *
 * `afdelingNavigate` (optional, page-supplied — CostumerAdministrationPage.tsx
 * only, see PageHeaderAfdelingNavigateField): same repurposing as
 * `kundeNavigate`, but for the Afdeling <select>. */
export function PageHeader({
  compact = false,
  rolleFilter,
  brugerFilter,
  navnFilter,
  koretoejFilter,
  koretoejNavigate,
  brugerNavigate,
  hideAfdelingAlle = false,
  hideAfdeling = false,
  hideKundeAlle = false,
  kundeNavigate,
  afdelingNavigate,
  onSwitcherOpenChange,
}: {
  compact?: boolean;
  rolleFilter?: PageHeaderFilterField;
  brugerFilter?: PageHeaderFilterField;
  navnFilter?: PageHeaderFilterField;
  koretoejFilter?: PageHeaderFilterField;
  koretoejNavigate?: PageHeaderNavigateField;
  brugerNavigate?: PageHeaderNavigateField;
  hideAfdelingAlle?: boolean;
  hideAfdeling?: boolean;
  hideKundeAlle?: boolean;
  kundeNavigate?: PageHeaderKundeNavigateField;
  afdelingNavigate?: PageHeaderAfdelingNavigateField;
  /** Fires whenever the "Data Filter" popup opens/closes — optional, purely so a page whose koretoejNavigate/brugerNavigate options come from an otherwise-unconditional fetch (see useCostumerQuickJumpOptions) can defer that fetch until the popup is actually opened at least once, instead of firing it on every mount regardless of whether the admin ever opens Data Filter at all. */
  onSwitcherOpenChange?: (open: boolean) => void;
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
    afdelingScopedToAllGrants,
    setAfdelingScopedToAllGrants,
    isFullyAuthenticated,
    session,
  } = useAuth();
  const navigate = useNavigate();
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  useEffect(() => {
    onSwitcherOpenChange?.(switcherOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switcherOpen]);
  const [switchError, setSwitchError] = useState<string | null>(null);
  /** True for the duration of any in-flight handleSwitch call — disables BOTH the Kunde and Afdeling <select>s (see their disabled props below) so a second pick can't fire while the first is still resolving. Without this, picking Kunde then immediately picking Afdeling "Alle" before the first switchDepartment call resolves would read a stale, pre-switch costumerId out of this render's closure (line ~496) and silently clobber the just-made Kunde pick once both requests land. */
  const [isSwitchingScope, setIsSwitchingScope] = useState(false);
  const [seedingBookings, setSeedingBookings] = useState(false);
  const [seedResultMessage, setSeedResultMessage] = useState<string | null>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsMenuItems = settingsMenuItemsForRole(profile?.role, profile?.user_id);

  /** Whether the Kunde <select> and the Afdeling <select>'s own "Alle" option should be offered — only for a sysadm (afdelingId === null IS "Alle" — see AuthContext's switchDepartment/loadAvailableDepartments). Regular admins never see either: their afdelingId is always a real department within their own fixed costumer, and "Alle" isn't a valid state for them at all. */
  const canSwitchToAll = isSysadm(profile?.role);

  /** Whether any page-local filter field (Rolle/Bruger/Navn/Køretøj) is currently narrowing the list — the same set "Nulstil filter" below resets. Drives the funnel button's own active-highlight (see its className below), same red/highlighted signal every per-page funnel-filter button gave before this control absorbed them. Deliberately does NOT include Kunde/Afdeling: those are now persisted, session-wide scope (switchDepartment) rather than an ephemeral filter, so a non-sysadm's everyday, always-on department scope would otherwise make this permanently "active" for them. */
  const hasActiveFilter = Boolean(rolleFilter?.value || brugerFilter?.value || navnFilter?.value || koretoejFilter?.value);

  /** Sysadm-only: every distinct Kunde availableDepartments spans, for the Kunde <select> below — deduped by costumerId (the grouping key, not costumerName, which can collide across costumers), sorted by name. Memoized: this component re-renders often (e.g. every isSwitchingScope/notImplementedKey change, or callers passing fresh inline filter-field props), and for a sysadm availableDepartments can span every department platform-wide — no need to redo the dedupe-and-sort on renders where it hasn't actually changed. */
  const kundeOptions = useMemo(
    () =>
      canSwitchToAll
        ? Array.from(
            new Map(
              availableDepartments
                .filter((d): d is typeof d & { costumerId: string } => Boolean(d.costumerId))
                .map((d) => [d.costumerId, d.costumerName ?? "Kunde"] as const),
            ).entries(),
          ).sort((a, b) => a[1].localeCompare(b[1]))
        : [],
    [canSwitchToAll, availableDepartments],
  );
  /** Options for the Afdeling <select> below — sysadm: every department under the currently-active Kunde (global costumerId), or every department platform-wide once Kunde is "Alle" (costumerId null); non-sysadm: their own grant list, unfiltered (they have no Kunde field to narrow by, and every entry is already within their one fixed costumer). Memoized for the same reason as kundeOptions above. */
  const afdelingOptions = useMemo(
    () => (canSwitchToAll ? availableDepartments.filter((d) => !costumerId || d.costumerId === costumerId) : availableDepartments),
    [canSwitchToAll, availableDepartments, costumerId],
  );

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
   * second pick, not close the popup out from under it. DOES disable both
   * selects for the duration (isSwitchingScope) — see that state's own doc
   * comment for why: a second pick fired before this one resolves would
   * read a stale costumerId/afdelingId out of a closure captured before the
   * first switch's result had propagated.
   */
  const handleSwitch = async (departmentId: string | null, costumerId?: string | null) => {
    setIsSwitchingScope(true);
    const error = await switchDepartment(departmentId, costumerId);
    setIsSwitchingScope(false);
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
          {isFullyAuthenticated && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Tilbage"
              title="Tilbage"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-brand-700 transition hover:bg-brand-100"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
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
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
                  hasActiveFilter
                    ? "border-red-500 bg-red-50 text-red-600 hover:bg-red-100"
                    : "border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"
                }`}
              >
                {/* Same funnel icon every page's own "Filtrer" popup uses (e.g. VehiclesPage.tsx) — this control is now that same family of filter, just app-wide/persisted for Kunde/Afdeling. */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
                  <polygon points="4 4 20 4 14 12.5 14 19 10 21 10 12.5 4 4" />
                </svg>
              </button>
              <InlinePopup visible={notImplementedKey === "no-other-departments"} message="Ingen afdelinger tilgængelige" align="right" />
              <InlinePopup visible={notImplementedKey === "switch-department-error"} message={switchError ?? "Kunne ikke skifte afdeling."} align="right" />
              {switcherOpen && <ClickOutsideOverlay onClick={() => setSwitcherOpen(false)} />}
              {/* Same InlinePopup shell + labeled <select> fields every "Filtrer" funnel popup uses (VehiclesPage.tsx/FleetManagementPage.tsx/AllBookingsPage.tsx/DepartmentPage.tsx) — card/border/shadow/text size/fade-in AND the select's own bg-brand-50/60 box styling, for visual consistency now that this control and those popups are the same "narrow what I'm looking at" family, just persisted here instead of page-local. */}
              <InlinePopup
                visible={switcherOpen}
                align="right"
                message={
                  <>
                    {canSwitchToAll && (
                      <label className="mb-2 block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-800">
                        Kunde
                        {kundeNavigate ? (
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) kundeNavigate.onSelect(e.target.value);
                            }}
                            className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                          >
                            <option value="">Vælg…</option>
                            {kundeOptions.map(([id, name]) => (
                              <option key={id} value={id}>
                                {name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select
                            value={costumerId ?? ""}
                            disabled={isSwitchingScope}
                            onChange={(e) => void handleSwitch(null, e.target.value || null)}
                            className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {/* Nothing meaningful to choose between with 0-1 real options. Also hidden outright when hideKundeAlle is set (CostumerDetailsPage.tsx — see its own doc comment), regardless of option count. */}
                            {kundeOptions.length > 1 && !hideKundeAlle && <option value="">Alle</option>}
                            {kundeOptions.map(([id, name]) => (
                              <option key={id} value={id}>
                                {name}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                    )}
                    {!hideAfdeling && (
                    <label className="relative mb-2 block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-800">
                      Afdeling
                      {afdelingNavigate ? (
                        <>
                          <select
                            value=""
                            disabled={afdelingNavigate.disabled}
                            onChange={(e) => {
                              const department = afdelingOptions.find((d) => d.department_id === e.target.value);
                              if (department) afdelingNavigate.onSelect(department);
                            }}
                            className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="">Vælg…</option>
                            {afdelingOptions.map((department) => (
                              <option key={department.department_id} value={department.department_id}>
                                {!costumerId && department.costumerName ? `${department.costumerName}/${department.name}` : department.name}
                              </option>
                            ))}
                          </select>
                          <InlinePopup visible={Boolean(afdelingNavigate.error)} message={afdelingNavigate.error ?? ""} align="right" />
                        </>
                      ) : (
                        <select
                          value={!canSwitchToAll && afdelingScopedToAllGrants ? "" : (afdelingId ?? "")}
                          disabled={isSwitchingScope}
                          onChange={(e) => {
                            const departmentId = e.target.value || null;
                            if (!canSwitchToAll) {
                              // Non-sysadm: "Alle" can never be persisted (switchDepartment
                              // rejects departmentId=null for this role — their own department_id
                              // must always be a real one) — so this is a purely local,
                              // non-persisted override instead (see afdelingScopedToAllGrants'
                              // own doc comment in AuthContext.tsx). Picking a real department
                              // clears the override and persists as normal, same as before.
                              setAfdelingScopedToAllGrants(!departmentId);
                              if (departmentId) void handleSwitch(departmentId);
                              return;
                            }
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
                          className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {/* Nothing meaningful to choose between with 0-1 real options — "Alle" and "that one department" (or no department at all) are the same thing, so hide the redundant choice. Shown for BOTH roles now — a non-sysadm's own "Alle" is just handled locally above (afdelingScopedToAllGrants) rather than persisted. Also hidden outright when hideAfdelingAlle is set (DepartmentDetailsPage.tsx — see its own doc comment), regardless of option count. */}
                          {afdelingOptions.length > 1 && !hideAfdelingAlle && <option value="">Alle</option>}
                          {afdelingOptions.map((department) => (
                            <option key={department.department_id} value={department.department_id}>
                              {/* Kunde "Alle" (costumerId null): afdelingOptions spans every costumer platform-wide, so the same department name can recur under different Kunder — prefix with "Kunde/" to disambiguate, same "Kunde / Afdeling" convention as elsewhere (BookingDetailsPage.tsx/ReservationPage.tsx). Once a specific Kunde is picked, every option is already implicitly that one Kunde's own, so the plain name is enough. */}
                              {!costumerId && department.costumerName ? `${department.costumerName}/${department.name}` : department.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                    )}
                    {/* Rolle/Bruger/Navn/Køretøj — a page's own extra filter fields (see PageHeaderFilterField), always in this fixed order regardless of which ones a given page actually supplies, data-driven below rather than four near-identical copies. Each always offers "Alle" (a real <option value="">) regardless of its own options.length — every page supplying one of these resets its value back to "" the moment Kunde/Afdeling changes (a previously-picked value almost certainly doesn't belong to the new scope, see e.g. DepartmentPage.tsx's/VehiclesPage.tsx's own reset effects), so that "" needs a real option to land on even with only one real choice in view — hiding "Alle" would leave the browser defaulting to showing that sole option as if deliberately picked, the exact misleading state the reset is trying to avoid. Køretøj (the last of the four when present) skips the trailing mb-2 the other three carry. */}
                    {(
                      [
                        { key: "rolle", field: rolleFilter, marginBottom: true },
                        { key: "bruger", field: brugerFilter, marginBottom: true },
                        { key: "navn", field: navnFilter, marginBottom: true },
                        { key: "koretoej", field: koretoejFilter, marginBottom: false },
                      ] as const
                    ).map(
                      ({ key, field, marginBottom }) =>
                        field && (
                          <label
                            key={key}
                            className={`${marginBottom ? "mb-2 " : ""}block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-800`}
                          >
                            {field.label}
                            <select
                              value={field.value}
                              onChange={(e) => field.onChange(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                            >
                              <option value="">Alle</option>
                              {field.options.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ),
                    )}
                    {/* Køretøjer/Brugere — AdminFrontpage.tsx's own "quick jump straight to one specific vehicle's/user's detail page" (see PageHeaderNavigateField), never present alongside the filter fields above (mutually exclusive per page), so their own mb-2/no-mb-2 spacing doesn't need to account for these two. Same data-driven rendering as the filter fields above. */}
                    {(
                      [
                        { key: "koretoejNavigate", field: koretoejNavigate, marginBottom: true },
                        { key: "brugerNavigate", field: brugerNavigate, marginBottom: false },
                      ] as const
                    ).map(
                      ({ key, field, marginBottom }) =>
                        field && (
                          <label
                            key={key}
                            className={`${marginBottom ? "mb-2 " : ""}block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-800`}
                          >
                            {field.label}
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) field.onSelect(e.target.value);
                              }}
                              className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                            >
                              <option value="">Vælg…</option>
                              {field.options.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ),
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
                    ? navigate(`/user-details/${profile?.user_id}`)
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
                  <ClickOutsideOverlay onClick={() => setSettingsMenuOpen(false)} />
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
            {/* afdeling is only ever null for a sysadm sitting on "Alle" (fully unscoped) or the newer "Kunde only" state (costumerId set, no specific department — see the Kunde-header row above); every other role always has a real department_id, so "—" (missing data) never actually applies to them. Distinguished by costumerId, since both states share a null afdeling. A non-sysadm's own "Alle" is checked FIRST and separately (afdelingScopedToAllGrants) — afdeling itself stays a real, non-null name for them even while it's active (see that state's own doc comment in AuthContext.tsx), so it would otherwise never show here at all. */}
            {afdelingScopedToAllGrants && !isSysadm(profile?.role)
              ? "Alle afdelinger"
              : (afdeling ?? (isSysadm(profile?.role) ? (costumerId ? "Alle afdelinger" : "Alle") : "—"))}
          </p>
        </div>
      )}
    </div>
  );
}
