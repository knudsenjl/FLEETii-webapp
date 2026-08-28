import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { supabase } from "../lib/supabase";

/** A row from the `user_profiles` table, as listed/selected on this page. department_name is resolved via the department_id FK's embedded join (see loadUsers) — used both for display in the table and passed through via router state to UserDetailsPage's create-user form. */
type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  /** Company-wide "Bruger-ID" identifier (see supabase/applied/user_profiles_add_user_ident.sql) — optional, edited on UserDetailsPage. */
  user_ident: string | null;
  department_id: string | null;
  /** Fed through to UserDetailsPage via router state so its own targetCostumerId can resolve to this user's OWN costumer (not the viewing admin's) when editing — needed for a FLEETii admin editing a user outside their (former) home costumer. */
  costumer_id: string | null;
  department_name: string | null;
  role: string;
  /** Set once "Bloker brugers adgang" has been used — see UserDetailsPage's own doc comment. Blocked users stay listed here (not hidden) so they can be reopened and unblocked. */
  deleted_at: string | null;
};

/** Raw shape of the Supabase query before flattening the embedded departments(name) relation into department_name. */
type ProfileQueryRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  user_ident: string | null;
  department_id: string | null;
  costumer_id: string | null;
  role: string;
  deleted_at: string | null;
  departments: { name: string } | null;
};

/**
 * Admin "user management" page ("/department"): two modes, both scoped to a
 * target costumer (costumerId/costumerName via router state, or the
 * viewer's own costumerId for a regular admin).
 *
 * LOCKED (departmentId also given — DepartmentDetailsPage's own BRUGERE
 * button, a department row already selected there): lists just that ONE
 * department's users, no in-page way to widen back out — "filtering by
 * navigation", same pattern this app already uses for costumerId scoping
 * elsewhere. To see a different department's users, go back and select a
 * different row on DepartmentDetailsPage.
 *
 * UNLOCKED (no departmentId — AdminFrontpage/CostumerDetailsPage's own
 * BRUGERE button, straight there): lists every user across the WHOLE target
 * costumer (matching what that button's own count badge already showed),
 * with an in-page Afdeling filter to narrow it back down —
 * CostumerDetailsPage's own BRUGERE used to fall back to DepartmentDetailsPage
 * as a picker whenever the costumer had 0 or 2+ departments; this replaced
 * that (2026-08-28, at the user's request) since landing on a whole
 * different page just to pick one felt like the wrong destination for a
 * button whose badge already promised "every user here". A regular admin's
 * own users are always within their own single department already (RLS
 * itself enforces that regardless of mode — see user_profiles_select_admin_own_department),
 * so none of this distinction is visible to them in practice.
 *
 * Reaching this page with neither a costumerId a FLEETii admin could resolve
 * nor one of their own (a regular admin always has one) redirects back to
 * "/admin" below. Click a row to open it in UserDetailsPage, which handles
 * editing (via update-user.mts, including that user's Rettigheder
 * overrides) and blocking/unblocking access (via delete-user.mts/
 * unblock-user.mts) from there, plus a link to create a new user. Blocked
 * users stay listed here rather than disappearing (a red "Blokeret" badge
 * appears next to their Rolle, same style as CostumerAdministrationPage's
 * own "Adgang blokeret" marker for a deactivated costumer), since blocking
 * is reversible and they need to stay reachable to unblock.
 */
export function DepartmentPage() {
  const { costumerId, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as
    | { costumerId?: string; costumerName?: string; departmentId?: string; departmentName?: string; emailWarning?: boolean }
    | null;
  const emailWarning = state?.emailWarning ?? false;
  /** Column count for this table — Bruger/Navn/Afdeling/Rolle, always 4. */
  const columnCount = 4;

  /** A FLEETii admin has no costumer of their own — for them, targetCostumerId only ever comes from router state. */
  const isFleetiiAdmin = profile?.role === "FLEETii admin";
  const targetCostumerId = state?.costumerId ?? costumerId;
  const targetCostumerName = isFleetiiAdmin ? (state?.costumerName ?? null) : null;
  /** When set, the whole visit is LOCKED to just this one department — see this component's own doc comment. Optional: absent means UNLOCKED (whole costumer, filterable). */
  const targetDepartmentId = state?.departmentId ?? null;
  const targetDepartmentName = state?.departmentName ?? null;

  /** Whether targetDepartmentId's OWN department_settings shows "Bruger-ID" (vs. plain E-mail) as the first column's value below — deliberately the LISTED department's own setting, not the viewing admin's currently-active one. Same "revert" pattern as AllBookingsPage.tsx: the column itself never disappears, only its value source swaps. UNLOCKED mode (targetDepartmentId null) has no single department's setting to apply across users from several departments at once, so useIdentSettings' own fail-closed default (plain E-mail) applies uniformly there instead. */
  const { useUserIdent } = useIdentSettings(targetDepartmentId);

  /** Redirects back to "/admin" if a FLEETii admin reaches this page without even a costumer to scope to (e.g. a direct URL/refresh, router state lost) — this page has no "every costumer" fallback. A regular admin always has their own costumerId regardless of router state, so this never actually fires for them. */
  useEffect(() => {
    if (isFleetiiAdmin && !targetCostumerId) {
      navigate("/admin", { replace: true });
    }
  }, [isFleetiiAdmin, targetCostumerId, navigate]);

  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isFleetiiAdmin && !targetCostumerId) return;

    async function loadUsers() {
      setLoading(true);
      setError(null);

      // Explicit !user_profiles_department_id_fkey disambiguates the embed:
      // since user_departments_table.sql, PostgREST also sees an implicit
      // many-to-many user_profiles<->departments relationship via
      // user_departments, so a bare "departments(...)" is now ambiguous
      // (PGRST201) and fails outright — this pins it to the direct FK.
      let query = supabase
        .from("user_profiles")
        .select(
          "user_id, email, full_name, phone, user_ident, department_id, costumer_id, role, deleted_at, departments!user_profiles_department_id_fkey(name)",
        )
        .order("full_name", { ascending: true });
      // LOCKED mode: scope straight to targetDepartmentId (a department_id
      // already determines its own costumer, so no separate costumer_id
      // filter is needed there). UNLOCKED mode, FLEETii admin: scope to the
      // whole target costumer instead — RLS already lets that role read any
      // costumer, so without this the query would otherwise pull every user
      // platform-wide just to show one costumer's worth. UNLOCKED mode,
      // regular admin: no added filter at all — RLS
      // (user_profiles_select_admin_own_department) already limits them to
      // their own current department regardless of what's asked for here.
      if (targetDepartmentId) {
        query = query.eq("department_id", targetDepartmentId);
      } else if (isFleetiiAdmin && targetCostumerId) {
        query = query.eq("costumer_id", targetCostumerId);
      }

      const { data, error: fetchError } = await query.returns<ProfileQueryRow[]>();

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setUsers(
        (data ?? []).map(({ departments, ...rest }) => ({ ...rest, department_name: departments?.name ?? null })),
      );
      setLoading(false);
    }

    void loadUsers();
    // Re-fetches whenever the target scope itself changes (a different
    // department/costumer selected without a full remount, e.g. via browser
    // back/forward).
  }, [targetDepartmentId, targetCostumerId, isFleetiiAdmin]);

  // Server-side filtering above already scopes `users` to the right set for
  // either mode — kept as its own name (rather than using `users` directly
  // below) purely so the rest of this file's filter-chain reads the same as
  // before.
  const departmentUsers = users;

  /** Same popup-filter pattern as VehiclesPage's fleet-table filter: a funnel button toggles an InlinePopup of dropdown selects, each populated from the actual rows in view (not free-text search) so every option is guaranteed to match something. */
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterBruger, setFilterBruger] = useState("");
  const [filterNavn, setFilterNavn] = useState("");
  /** UNLOCKED mode only — narrows the whole-costumer user list down to one department, same role LOCKED mode's targetDepartmentId plays but adjustable in-page instead of fixed for the whole visit. Never rendered/set in LOCKED mode. */
  const [filterAfdeling, setFilterAfdeling] = useState("");
  const [filterRolle, setFilterRolle] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filterOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen]);

  /** Mirrors the Bruger column's own display logic (useUserIdent toggle) so the filter's dropdown values and matching always agree with what's actually shown in the table. */
  const brugerValue = (user: ProfileRow) => (useUserIdent ? user.user_ident || user.email : user.email) ?? "—";
  /**
   * The filter fields form a hierarchy — Afdeling > Rolle > Bruger/Navn (UNLOCKED
   * mode only — LOCKED mode has no Afdeling tier at all, departmentUsers above
   * is already scoped to one department there, and the dropdown below isn't
   * rendered) — where each field's own option list is scoped down by whatever
   * is picked ABOVE it, never by a field at its own level or below. Bruger and
   * Navn sit at the same bottom rung (both identify one specific user), so they
   * share the same scope rather than narrowing each other.
   */
  const afdelingScopedUsers = filterAfdeling ? departmentUsers.filter((u) => u.department_id === filterAfdeling) : departmentUsers;
  const rolleScopedUsers = filterRolle ? afdelingScopedUsers.filter((u) => u.role === filterRolle) : afdelingScopedUsers;
  /** Deduped by department_id (the filter's actual match key) while keeping department_name for the option label — a Map collapses repeats from users sharing the same department. UNLOCKED mode only; stays empty (and unused) in LOCKED mode since departmentUsers there is already just one department. */
  const afdelingOptions = Array.from(
    new Map(departmentUsers.map((u) => [u.department_id, u.department_name] as const)).entries(),
  )
    .filter((entry): entry is [string, string] => entry[0] !== null && entry[1] !== null)
    .sort((a, b) => a[1].localeCompare(b[1]));
  const roleOptions = Array.from(new Set(afdelingScopedUsers.map((u) => u.role))).sort();
  const brugerOptions = Array.from(new Set(rolleScopedUsers.map(brugerValue))).sort();
  const navnOptions = Array.from(new Set(rolleScopedUsers.map((u) => u.full_name ?? "—"))).sort();

  const filteredUsers = departmentUsers.filter(
    (u) =>
      (!filterBruger || brugerValue(u) === filterBruger) &&
      (!filterNavn || (u.full_name ?? "—") === filterNavn) &&
      (!filterAfdeling || u.department_id === filterAfdeling) &&
      (!filterRolle || u.role === filterRolle),
  );
  const hasActiveFilter = Boolean(filterBruger || filterNavn || filterAfdeling || filterRolle);

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex min-w-0 min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-w-0 min-h-0 flex-1 flex-col"
        >
          <PageHeader />

          <section className="flex min-w-0 min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-w-0 min-h-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold text-brand-800">
                  Brugere{targetCostumerName ? ` hos ${targetCostumerName}` : ""}
                  {targetDepartmentName ? ` — ${targetDepartmentName}` : ""}
                </h2>
                <div className="relative" ref={filterRef}>
                  <button
                    type="button"
                    onClick={() => setFilterOpen((prev) => !prev)}
                    aria-label="Filtrer"
                    className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                      hasActiveFilter
                        ? "border-red-500 bg-red-50 text-red-600 hover:bg-red-100"
                        : "border-brand-300 text-brand-600 hover:bg-brand-50"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                      <polygon points="4 4 20 4 14 12.5 14 19 10 21 10 12.5 4 4" />
                    </svg>
                  </button>
                  <InlinePopup
                    visible={filterOpen}
                    align="right"
                    message={
                      <>
                        <p className="mb-2">Du kan her udvælge brugere på disse kriterier:</p>
                        {/* LOCKED mode (targetDepartmentId set) hides this entirely — nothing to widen back out to from in-page, see this component's own doc comment. */}
                        {!targetDepartmentId && (
                          <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                            Afdeling
                            <select
                              value={filterAfdeling}
                              onChange={(e) => {
                                // Changing an upstream field invalidates every field below it in
                                // the Afdeling > Rolle > Bruger/Navn hierarchy, so all of them
                                // reset rather than risking a stale, now-impossible combination.
                                setFilterAfdeling(e.target.value);
                                setFilterRolle("");
                                setFilterBruger("");
                                setFilterNavn("");
                              }}
                              className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                            >
                              <option value="">Alle</option>
                              {afdelingOptions.map(([departmentId, departmentName]) => (
                                <option key={departmentId} value={departmentId}>
                                  {departmentName}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                          Rolle
                          <select
                            value={filterRolle}
                            onChange={(e) => {
                              setFilterRolle(e.target.value);
                              setFilterBruger("");
                              setFilterNavn("");
                            }}
                            className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                          >
                            <option value="">Alle</option>
                            {roleOptions.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                          Bruger
                          <select
                            value={filterBruger}
                            onChange={(e) => {
                              const value = e.target.value;
                              setFilterBruger(value);
                              if (!value) return;
                              // Bruger/Navn each identify one specific user, so — unlike
                              // Afdeling/Rolle above — picking one flows UP the hierarchy instead
                              // of down: it fills in Afdeling/Rolle (and the other of
                              // Bruger/Navn) from that user's own actual values, even if those
                              // were still "Alle" beforehand. Matched against the full
                              // departmentUsers list (not the already-scoped option source)
                              // since Bruger/Navn values (email/user_ident) are unique per user,
                              // so the match is unambiguous regardless of the current scope.
                              const match = departmentUsers.find((u) => brugerValue(u) === value);
                              if (match) {
                                setFilterAfdeling(match.department_id ?? "");
                                setFilterRolle(match.role);
                                setFilterNavn(match.full_name ?? "—");
                              }
                            }}
                            className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                          >
                            <option value="">Alle</option>
                            {brugerOptions.map((bruger) => (
                              <option key={bruger} value={bruger}>
                                {bruger}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-[0.7rem] font-medium text-brand-700">
                          Navn
                          <select
                            value={filterNavn}
                            onChange={(e) => {
                              const value = e.target.value;
                              setFilterNavn(value);
                              if (!value) return;
                              // Same up-the-hierarchy fill as Bruger above. Names aren't
                              // guaranteed unique the way email/user_ident is, so this takes the
                              // first matching user — an accepted approximation for this edge case.
                              const match = departmentUsers.find((u) => (u.full_name ?? "—") === value);
                              if (match) {
                                setFilterAfdeling(match.department_id ?? "");
                                setFilterRolle(match.role);
                                setFilterBruger(brugerValue(match));
                              }
                            }}
                            className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                          >
                            <option value="">Alle</option>
                            {navnOptions.map((navn) => (
                              <option key={navn} value={navn}>
                                {navn}
                              </option>
                            ))}
                          </select>
                        </label>
                        {hasActiveFilter && (
                          <button
                            type="button"
                            onClick={() => {
                              setFilterBruger("");
                              setFilterNavn("");
                              setFilterAfdeling("");
                              setFilterRolle("");
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
              </div>

              {emailWarning && (
                <p className="text-sm text-red-600">
                  Brugeren blev oprettet, men velkomstmailen med login-oplysninger kunne ikke sendes. Giv brugeren adgangskoden på anden vis.
                </p>
              )}

              <div className="flex min-w-0 min-h-0 flex-col overflow-auto rounded-none border border-brand-100">
                {/* A real <table> (not the CSS-grid-per-row layout used elsewhere)
                    so column widths are computed once across the header AND every
                    row together — table-layout:auto sizes each column to fit its
                    widest actual content, rather than a fixed/1fr split. */}
                <table className="w-full border-collapse text-[0.7rem]">
                  <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    <tr>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Bruger</th>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Navn</th>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Afdeling</th>
                      <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Rolle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {loading && (
                      <tr>
                        <td colSpan={columnCount} className="px-2 py-3 text-center text-brand-500">Indlæser brugere…</td>
                      </tr>
                    )}
                    {!loading && error && (
                      <tr>
                        <td colSpan={columnCount} className="px-2 py-3 text-center text-red-600">{error}</td>
                      </tr>
                    )}
                    {!loading && !error && filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={columnCount} className="px-2 py-3 text-center text-brand-500">
                          {departmentUsers.length === 0
                            ? "Ingen brugere fundet."
                            : hasActiveFilter
                              ? "Ingen brugere matcher filteret."
                              : "Ingen brugere fundet."}
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      !error &&
                      filteredUsers.map((user, index) => {
                        const isAlternate = index % 2 === 1;
                        const goToUser = () =>
                          navigate(`/user-details/${user.user_id}`, {
                            state: {
                              user,
                              costumerId: targetCostumerId,
                              costumerName: targetCostumerName,
                              departmentId: targetDepartmentId,
                              departmentName: targetDepartmentName,
                            },
                          });
                        return (
                          <tr
                            key={user.user_id}
                            role="button"
                            tabIndex={0}
                            onClick={goToUser}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                goToUser();
                              }
                            }}
                            className={`cursor-pointer transition ${
                              isAlternate
                                ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                                : "bg-white text-brand-700 hover:bg-brand-50"
                            }`}
                          >
                            <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5">
                              {(useUserIdent ? user.user_ident || user.email : user.email) ?? "—"}
                            </td>
                            <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">{user.full_name ?? "—"}</td>
                            <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5">{user.department_name ?? "—"}</td>
                            <td className="whitespace-nowrap px-2 py-0.5">
                              {user.deleted_at ? (
                                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-red-700">
                                  Blokeret
                                </span>
                              ) : (
                                user.role
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() =>
                    navigate("/user-details", {
                      state: {
                        costumerId: targetCostumerId,
                        costumerName: targetCostumerName,
                        departmentId: targetDepartmentId,
                        departmentName: targetDepartmentName,
                      },
                    })
                  }
                  className="flex-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Opret ny bruger
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/import-users")}
                  className="flex-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Opret nye brugere fra fil
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
