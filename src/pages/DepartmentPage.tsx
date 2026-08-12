import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
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
 * Admin "user management" page ("/department"): every user in the admin's
 * own department (or, for a FLEETii admin, any department — see
 * supabase/applied/user_profiles_select_allow_fleetii_admin.sql) — click a
 * row to open it in UserDetailsPage, which handles editing (via
 * update-user.mts, including that user's Rettigheder overrides) and
 * blocking/unblocking access (via delete-user.mts/unblock-user.mts) from
 * there, plus a link to create a new user. Blocked users stay listed here
 * rather than disappearing (a red "Blokeret" badge appears next to their
 * Rolle, same style as CostumerAdministrationPage's own "Adgang blokeret"
 * marker for a deactivated costumer), since blocking is reversible and they
 * need to stay reachable to unblock.
 */
export function DepartmentPage() {
  const { afdeling, afdelingId, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const emailWarning = (location.state as { emailWarning?: boolean } | null)?.emailWarning ?? false;
  /** Whether afdelingId's department shows "Bruger-ID" (vs. plain E-mail) as the first column's value below — see useIdentSettings' own doc comment. Same "revert" pattern as AllBookingsPage.tsx: the column itself never disappears (a user's identity is core information), only its value source swaps. */
  const { useUserIdent } = useIdentSettings(afdelingId);
  /** Column count for this table — Bruger/Navn/Afdeling/Rolle, always 4. */
  const columnCount = 4;

  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadUsers() {
      setLoading(true);
      setError(null);

      // Explicit !user_profiles_department_id_fkey disambiguates the embed:
      // since user_departments_table.sql, PostgREST also sees an implicit
      // many-to-many user_profiles<->departments relationship via
      // user_departments, so a bare "departments(...)" is now ambiguous
      // (PGRST201) and fails outright — this pins it to the direct FK.
      const { data, error: fetchError } = await supabase
        .from("user_profiles")
        .select(
          "user_id, email, full_name, phone, user_ident, department_id, costumer_id, role, deleted_at, departments!user_profiles_department_id_fkey(name)",
        )
        .order("full_name", { ascending: true })
        .returns<ProfileQueryRow[]>();

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
    // Re-fetches whenever the active department changes (via PageHeader's
    // "Skift afdeling") — user_profiles' SELECT RLS
    // (user_profiles_select_admin_own_department) scopes rows to the
    // admin's CURRENT department, so the previously-fetched list stops
    // containing anything relevant the moment afdelingId changes; an empty
    // dependency array left this page showing a stale (or empty, since none
    // of the old rows match the new department_id) table until a hard
    // refresh.
  }, [afdelingId]);

  // A FLEETii admin sees every user platform-wide (loadUsers' own SELECT
  // already returns them all, per user_profiles_select_allow_fleetii_admin.sql)
  // rather than being filtered down to a single department they may no
  // longer even have — matching this page's own doc comment above.
  const departmentUsers =
    profile?.role === "FLEETii admin" ? users : users.filter((u) => u.department_id === afdelingId);

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
              <h2 className="text-xl font-semibold text-brand-800">
                Brugeradministration: {afdeling ?? "—"}
              </h2>

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
                    {!loading && !error && departmentUsers.length === 0 && (
                      <tr>
                        <td colSpan={columnCount} className="px-2 py-3 text-center text-brand-500">Ingen brugere fundet.</td>
                      </tr>
                    )}
                    {!loading &&
                      !error &&
                      departmentUsers.map((user, index) => {
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
                <button
                  type="button"
                  onClick={() => navigate("/user-details")}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Opret ny bruger
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/import-users")}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
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
