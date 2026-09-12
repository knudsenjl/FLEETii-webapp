import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isSysadm as isSysadmRole } from "../lib/roles";
import { PageHeader } from "../components/PageHeader";
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
 * costumer (costumerId/costumerName via router state, or the viewer's own
 * costumerId for a regular admin) and, optionally, one specific department
 * within it (departmentId — e.g. DepartmentDetailsPage.tsx's own
 * BRUGERE button, a department row already selected there; absent means
 * "every user across the whole target costumer", matching AdminFrontpage's/
 * CostumerDetailsPage's own BRUGERE button and its count badge).
 *
 * Either way, this is only ever the INITIAL scope — the global header
 * ("Data Filter", PageHeader.tsx) always wins outright the moment it's
 * touched (headerTouched below), for BOTH Kunde and Afdeling, regardless of
 * how this page was reached. There's no "go back and pick a different row"
 * carve-out left here the way VehiclesPage.tsx/FleetManagementPage.tsx
 * still have for their own true LOCKED case — this page's users list always
 * follows "Data Filter" live. A regular admin's own users are always within
 * their own single department already (RLS itself enforces that regardless
 * — see user_profiles_select_admin_own_department), so none of this
 * distinction is visible to them in practice.
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
  const { costumerId, costumerName, afdelingId, afdeling, availableDepartments, afdelingScopedToAllGrants, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as
    | { costumerId?: string; costumerName?: string; departmentId?: string; departmentName?: string; emailWarning?: boolean }
    | null;
  const emailWarning = state?.emailWarning ?? false;
  /** Column count for this table — Bruger/Navn/Afdeling/Rolle, always 4. */
  const columnCount = 4;

  /** A sysadm has no costumer of their own — for them, targetCostumerId only ever comes from router state (until the header is touched — see headerTouched below). */
  const isSysadm = isSysadmRole(profile?.role);
  /**
   * Whether the header's own Kunde/Afdeling scope has genuinely changed
   * since this page mounted (either one) — once it has, it wins outright
   * over any router-state seed (state?.costumerId/departmentId) for the
   * rest of this visit, INCLUDING true LOCKED visits (a specific department
   * row's own BRUGERE button on DepartmentDetailsPage.tsx). This
   * deliberately overrides the original filter-redesign plan's "LOCKED mode
   * stays frozen for its whole visit" decision for this page specifically,
   * per explicit, repeated request: changing Kunde or Afdeling in "Data
   * Filter" must always update this page's own user list, regardless of how
   * it was reached — there's no "go back and pick a different row" carve-out
   * left here (VehiclesPage.tsx/FleetManagementPage.tsx still keep that
   * carve-out; this page no longer does).
   *
   * Sticky rather than a live mount-time comparison — a live comparison
   * would incorrectly revert to trusting the stale router-state seed again
   * if the header ever cycles back to exactly its mount-time values.
   */
  const [headerTouched, setHeaderTouched] = useState(false);
  const mountedCostumerIdRef = useRef(costumerId);
  const mountedAfdelingIdRef = useRef(afdelingId);
  const mountedAllGrantsRef = useRef(afdelingScopedToAllGrants);
  useEffect(() => {
    if (
      costumerId !== mountedCostumerIdRef.current ||
      afdelingId !== mountedAfdelingIdRef.current ||
      afdelingScopedToAllGrants !== mountedAllGrantsRef.current
    ) {
      mountedCostumerIdRef.current = costumerId;
      mountedAfdelingIdRef.current = afdelingId;
      mountedAllGrantsRef.current = afdelingScopedToAllGrants;
      setHeaderTouched(true);
    }
  }, [costumerId, afdelingId, afdelingScopedToAllGrants]);
  const targetCostumerId = headerTouched ? costumerId : (state?.costumerId ?? costumerId);
  /** Same headerTouched gate as targetCostumerId above — without it, the "Brugere hos {targetCostumerName}" heading would keep showing the router-state-seeded name even after the header (and thus the actual user list) had already moved on to a different Kunde. costumerName (global) is the correct fallback once touched, same as VehiclesPage.tsx's identical fix — this page just never had a reason to read it before. */
  const targetCostumerName = isSysadm ? (headerTouched ? costumerName : (state?.costumerName ?? null)) : null;

  /**
   * The global header's active department (afdelingId), carried over IF
   * (and only if) it actually belongs to targetCostumerId — otherwise null,
   * i.e. no narrowing. This is the "navigation wins" formula (see the
   * filter-redesign plan's Common pattern): without the membership check,
   * navigating here for a DIFFERENT costumer than the header's
   * currently-active department would filter every one of this costumer's
   * users out (none of them have that foreign department_id), showing an
   * empty table instead of the whole costumer's users.
   *
   * A regular admin's own afdelingId is never null (switchDepartment
   * rejects departmentId=null for that role), so without
   * afdelingScopedToAllGrants below, this would ALWAYS narrow them to just
   * their one currently-active department — even though
   * user_profiles_select_admin_own_costumer.sql already widens their own
   * RLS to their WHOLE costumer specifically so this page's UNLOCKED mode
   * could show every department they're granted, not just one at a time.
   * afdelingScopedToAllGrants (set via PageHeader.tsx's own Afdeling
   * "Alle" — a local override, never persisted, since this role can't
   * persist an unscoped department_id) is exactly that: "Alle" for a
   * non-sysadm, so this becomes null (no narrowing) the same way a
   * sysadm's real, persisted null afdelingId already does.
   */
  const effectiveAfdelingId =
    !isSysadm && afdelingScopedToAllGrants
      ? null
      : afdelingId && availableDepartments.some((d) => d.department_id === afdelingId && (!isSysadm || d.costumerId === targetCostumerId))
        ? afdelingId
        : null;
  /** Router-state seed (e.g. DepartmentDetailsPage.tsx's own department-specific BRUGERE button) wins ONLY until the header is touched (see headerTouched above) — once it is, effectiveAfdelingId takes over outright, same as targetCostumerId. Absent/null means UNLOCKED (whole costumer, filterable). */
  const targetDepartmentId = headerTouched ? effectiveAfdelingId : (state?.departmentId ?? null);
  const targetDepartmentName = headerTouched ? (targetDepartmentId ? afdeling : null) : (state?.departmentName ?? null);

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
  /** Resets all three back to "Alle" whenever the Kunde/Afdeling scope itself changes — a previously-picked Rolle/Bruger/Navn almost certainly doesn't correspond to the NEW scope's users (the picked Bruger/Navn might not even be a user of the new department/costumer at all), so leaving them selected would silently show an empty or misleading result. Same reasoning/fix as VehiclesPage.tsx's own Køretøj reset. */
  useEffect(() => {
    setFilterRolle("");
    setFilterBruger("");
    setFilterNavn("");
  }, [targetCostumerId, effectiveAfdelingId]);

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
  const hasActiveFilter = Boolean(filterBruger || filterNavn || filterRolle);

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
                  Opret bruger
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/import-users")}
                  className="flex-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Opret brugere fra fil
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
