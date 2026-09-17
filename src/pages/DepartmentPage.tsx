import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isSysadm as isSysadmRole } from "../lib/roles";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useEffectiveAfdelingId } from "../hooks/useEffectiveAfdelingId";
import { useResetOnScopeChange } from "../hooks/useResetOnScopeChange";
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
  /** Fed through to UserDetailsPage via router state so its own targetCostumerId can resolve to this user's OWN costumer (not the viewing admin's) when editing — needed for a sysadm editing a user outside their (former) home costumer. */
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
 * Admin "user management" page ("/department"): scoped to a target
 * costumer (the global header's own costumerId — see "Data Filter",
 * PageHeader.tsx) and, optionally, one specific department within it (the
 * header's own afdelingId, membership-checked below — e.g.
 * DepartmentDetailsPage.tsx's own BRUGERE button switches the header to a
 * specific department before navigating here; absent means "every user
 * across the whole target costumer", matching AdminFrontpage's/
 * CostumerDetailsPage's own BRUGERE button and its count badge).
 *
 * This page's users list always follows the global header ("Data Filter")
 * live, for BOTH Kunde and Afdeling, regardless of how it was reached —
 * there's no router-state seed or "stays frozen for this visit" mode any
 * more. A regular admin's own users are always within their own single
 * department already (RLS itself enforces that regardless — see
 * user_profiles_select_admin_own_department), so none of this distinction
 * is visible to them in practice.
 *
 * Reaching this page with neither a costumerId a sysadm could resolve
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
  const { costumerId, costumerName, afdeling, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  /** Only emailWarning still travels via router state — see UserDetailsPage.tsx's create-success navigate — a one-off banner flag, unrelated to Kunde/Afdeling scope. */
  const state = location.state as { emailWarning?: boolean } | null;
  const emailWarning = state?.emailWarning ?? false;
  /** Column count for this table — Bruger/Navn/Afdeling/Rolle, always 4. */
  const columnCount = 4;

  /** A sysadm has no costumer of their own — for them, targetCostumerId just follows the global header directly. */
  const isSysadm = isSysadmRole(profile?.role);
  const targetCostumerId = costumerId;
  const targetCostumerName = isSysadm ? costumerName : null;

  /** See useEffectiveAfdelingId's own doc comment — shared with VehiclesPage.tsx/FleetManagementPage.tsx. */
  const effectiveAfdelingId = useEffectiveAfdelingId(targetCostumerId);
  const targetDepartmentId = effectiveAfdelingId;
  const targetDepartmentName = targetDepartmentId ? afdeling : null;

  /** Whether targetDepartmentId's OWN department_settings shows "Bruger-ID" (vs. plain E-mail) as the first column's value below — deliberately the LISTED department's own setting, not the viewing admin's currently-active one. Same "revert" pattern as AllBookingsPage.tsx: the column itself never disappears, only its value source swaps. UNLOCKED mode (targetDepartmentId null) has no single department's setting to apply across users from several departments at once, so useIdentSettings' own fail-closed default (plain E-mail) applies uniformly there instead. */
  const { useUserIdent } = useIdentSettings(targetDepartmentId);

  /** Redirects back to "/admin" if a sysadm reaches this page without even a costumer to scope to (e.g. a direct URL/refresh, router state lost) — this page has no "every costumer" fallback. A regular admin always has their own costumerId regardless of router state, so this never actually fires for them. */
  useEffect(() => {
    if (isSysadm && !targetCostumerId) {
      navigate("/admin", { replace: true });
    }
  }, [isSysadm, targetCostumerId, navigate]);

  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSysadm && !targetCostumerId) return;

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
        // A sysadm's own department_id/costumer_id is just their current
        // "Data Filter" scope pointer (see AuthContext's switchDepartment),
        // never real department membership — without this exclusion, a
        // sysadm who has ever switched their own scope into this
        // department/costumer would show up in this list as if they were a
        // genuine assigned user of it.
        .neq("role", "sysadm")
        .order("full_name", { ascending: true });
      // LOCKED mode: scope straight to targetDepartmentId (a department_id
      // already determines its own costumer, so no separate costumer_id
      // filter is needed there). UNLOCKED mode, sysadm: scope to the
      // whole target costumer instead — RLS already lets that role read any
      // costumer, so without this the query would otherwise pull every user
      // platform-wide just to show one costumer's worth. UNLOCKED mode,
      // regular admin: no added filter at all — RLS
      // (user_profiles_select_admin_own_department) already limits them to
      // their own current department regardless of what's asked for here.
      if (targetDepartmentId) {
        query = query.eq("department_id", targetDepartmentId);
      } else if (isSysadm && targetCostumerId) {
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
  }, [targetDepartmentId, targetCostumerId, isSysadm]);

  // Server-side filtering above already scopes `users` to the right set for
  // either mode — kept as its own name (rather than using `users` directly
  // below) purely so the rest of this file's filter-chain reads the same as
  // before.
  const departmentUsers = users;

  /** Page-local, transient (not persisted) — all three surfaced inside PageHeader's "Data Filter" popup as Rolle/Bruger/Navn <select> fields (see PageHeaderFilterField) rather than a separate funnel popup of this page's own; the popup is genuinely gone now, not just shrunk — nothing left here to give it a button for. */
  const [filterBruger, setFilterBruger] = useState("");
  const [filterNavn, setFilterNavn] = useState("");
  const [filterRolle, setFilterRolle] = useState("");
  /** Resets all three back to "Alle" whenever the Kunde/Afdeling scope itself changes — a previously-picked Rolle/Bruger/Navn almost certainly doesn't correspond to the NEW scope's users (the picked Bruger/Navn might not even be a user of the new department/costumer at all), so leaving them selected would silently show an empty or misleading result. Same reasoning/mechanism as VehiclesPage.tsx's/FleetManagementPage.tsx's/AllBookingsPage.tsx's own identical resets, now shared — see useResetOnScopeChange's own doc comment. */
  useResetOnScopeChange([targetCostumerId, effectiveAfdelingId], () => {
    setFilterRolle("");
    setFilterBruger("");
    setFilterNavn("");
  });

  /** Mirrors the Bruger column's own display logic (useUserIdent toggle) so the filter's dropdown values and matching always agree with what's actually shown in the table. */
  const brugerValue = (user: ProfileRow) => (useUserIdent ? user.user_ident || user.email : user.email) ?? "—";
  /** UNLOCKED mode only — the global header's Afdeling (effectiveAfdelingId above) narrows departmentUsers before the Rolle > Bruger/Navn filter hierarchy below applies on top; LOCKED mode's departmentUsers is already just one department, so this is a no-op there. Kept as its own name purely so the rest of this file's filter-chain reads the same as before the local Afdeling picker was removed. */
  const afdelingScopedUsers = effectiveAfdelingId ? departmentUsers.filter((u) => u.department_id === effectiveAfdelingId) : departmentUsers;
  /**
   * The filter fields form a hierarchy — Rolle > Bruger/Navn — where each
   * field's own option list is scoped down by whatever is picked ABOVE it,
   * never by a field at its own level or below. Bruger and Navn sit at the
   * same bottom rung (both identify one specific user), so they share the
   * same scope rather than narrowing each other. All three now render
   * together in PageHeader's popup (see rolleFilter/brugerFilter/navnFilter
   * below), so the cross-fill onChange handlers below stay meaningful —
   * unlike a field split off into a physically separate popup, every pick
   * here is visible in the same place the others are.
   */
  const rolleScopedUsers = filterRolle ? afdelingScopedUsers.filter((u) => u.role === filterRolle) : afdelingScopedUsers;
  const roleOptions = Array.from(new Set(afdelingScopedUsers.map((u) => u.role))).sort();
  const brugerOptions = Array.from(new Set(rolleScopedUsers.map(brugerValue))).sort();
  const navnOptions = Array.from(new Set(rolleScopedUsers.map((u) => u.full_name ?? "—"))).sort();

  const filteredUsers = afdelingScopedUsers.filter(
    (u) =>
      (!filterBruger || brugerValue(u) === filterBruger) &&
      (!filterNavn || (u.full_name ?? "—") === filterNavn) &&
      (!filterRolle || u.role === filterRolle),
  );
  /** Drives the "Ingen brugere matcher filteret." vs. "Ingen brugere fundet." choice below — includes targetDepartmentId (a specific department narrower than the whole-costumer view), not just the page-local Rolle/Bruger/Navn filters: a department with genuinely zero users should read as "doesn't match this scope," not "nothing exists at all," since a different department under the same costumer might have plenty. */
  const hasActiveFilter = Boolean(filterBruger || filterNavn || filterRolle || targetDepartmentId);

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
          <PageHeader
            rolleFilter={{
              label: "Rolle",
              value: filterRolle,
              onChange: (value) => {
                setFilterRolle(value);
                setFilterBruger("");
                setFilterNavn("");
              },
              options: roleOptions.map((role) => ({ value: role, label: role })),
            }}
            brugerFilter={{
              label: "Bruger",
              value: filterBruger,
              onChange: (value) => {
                setFilterBruger(value);
                if (!value) return;
                // Bruger/Navn each identify one specific user, so — unlike
                // Rolle above — picking one flows UP the hierarchy instead
                // of down: it fills in Rolle (and the other of Bruger/Navn)
                // from that user's own actual values, even if those were
                // still "Alle" beforehand. Matched against the full
                // departmentUsers list (not the already-scoped option
                // source) since Bruger/Navn values (email/user_ident) are
                // unique per user, so the match is unambiguous regardless
                // of the current scope.
                const match = departmentUsers.find((u) => brugerValue(u) === value);
                if (match) {
                  setFilterRolle(match.role);
                  setFilterNavn(match.full_name ?? "—");
                }
              },
              options: brugerOptions.map((bruger) => ({ value: bruger, label: bruger })),
            }}
            navnFilter={{
              label: "Navn",
              value: filterNavn,
              onChange: (value) => {
                setFilterNavn(value);
                if (!value) return;
                // Same up-the-hierarchy fill as Bruger above. Names aren't
                // guaranteed unique the way email/user_ident is, so this
                // takes the first matching user — an accepted approximation
                // for this edge case.
                const match = departmentUsers.find((u) => (u.full_name ?? "—") === value);
                if (match) {
                  setFilterRolle(match.role);
                  setFilterBruger(brugerValue(match));
                }
              },
              options: navnOptions.map((navn) => ({ value: navn, label: navn })),
            }}
          />

          <section className="flex min-w-0 min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-w-0 min-h-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold text-brand-800">
                  Brugere{targetCostumerName ? ` hos ${targetCostumerName}` : ""}
                  {targetDepartmentName ? ` — ${targetDepartmentName}` : ""}
                </h2>
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
                        const goToUser = () => navigate(`/user-details/${user.user_id}`, { state: { user } });
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
                <Button variant="secondary" type="button" onClick={() => navigate("/user-details")} className="flex-1">
                  Opret bruger
                </Button>
                <Button variant="secondary" type="button" onClick={() => navigate("/import-users")} className="flex-1">
                  Opret brugere fra fil
                </Button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
