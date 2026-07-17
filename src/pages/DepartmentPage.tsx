import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { supabase } from "../lib/supabase";

/** A row from the `user_profiles` table, as listed/selected on this page. */
type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  department: string | null;
  role: string;
};

/**
 * Admin "user management" page ("/department"): every user in the admin's
 * own department, select-a-row-then-act (Rediger/Slet), plus a link to
 * create a new user via UserDetailsPage.
 *
 * KNOWN LIMITATION: "Rediger" navigates to UserDetailsPage pre-filled with
 * the existing user, but that page's form only ever calls create-user
 * (which always invites a brand-new auth user) — there is no actual update
 * path, so editing an existing user does not work today. "Slet" also only
 * deletes the `user_profiles` row, not the underlying Supabase Auth account, so a
 * "deleted" user can still log in.
 */
export function DepartmentPage() {
  const { afdeling } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProfileRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    async function loadUsers() {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("user_profiles")
        .select("user_id, email, full_name, phone, department, role")
        .order("full_name", { ascending: true })
        .returns<ProfileRow[]>();

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setUsers(data ?? []);
      setLoading(false);
    }

    void loadUsers();
  }, []);

  const departmentUsers = users.filter((u) => u.department === afdeling);
  const selectedUser = departmentUsers.find((u) => u.user_id === selectedUserId) ?? null;

  /** Deletes the pending user's `user_profiles` row (does NOT revoke their Supabase Auth account — see the KNOWN LIMITATION note on DepartmentPage above) and removes them from the local list. */
  const handleDeleteUser = async () => {
    if (!pendingDelete) return;

    setIsDeleting(true);
    setDeleteError(null);

    const { error: deleteErr } = await supabase.from("user_profiles").delete().eq("user_id", pendingDelete.user_id);

    if (deleteErr) {
      setDeleteError(deleteErr.message);
      setIsDeleting(false);
      return;
    }

    setUsers((prev) => prev.filter((u) => u.user_id !== pendingDelete.user_id));
    if (selectedUserId === pendingDelete.user_id) setSelectedUserId(null);
    setIsDeleting(false);
    setPendingDelete(null);
  };

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <h2 className="text-xl font-semibold text-brand-800">
                Afdeling: {afdeling ?? "—"}
              </h2>

              <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-none border border-brand-100">
                {/* A real <table> (not the CSS-grid-per-row layout used elsewhere)
                    so column widths are computed once across the header AND every
                    row together — table-layout:auto sizes each column to fit its
                    widest actual content, rather than a fixed/1fr split. */}
                <table className="w-full border-collapse text-[0.7rem]">
                  <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    <tr>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Navn</th>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">E-mail</th>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Afdeling</th>
                      <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Rolle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {loading && (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-brand-500">Indlæser brugere…</td>
                      </tr>
                    )}
                    {!loading && error && (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-red-600">{error}</td>
                      </tr>
                    )}
                    {!loading && !error && departmentUsers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-brand-500">Ingen brugere fundet.</td>
                      </tr>
                    )}
                    {!loading &&
                      !error &&
                      departmentUsers.map((user, index) => {
                        const isAlternate = index % 2 === 1;
                        const isSelected = user.user_id === selectedUserId;
                        const toggleSelected = () =>
                          setSelectedUserId((current) => (current === user.user_id ? null : user.user_id));
                        return (
                          <tr
                            key={user.user_id}
                            role="button"
                            tabIndex={0}
                            aria-pressed={isSelected}
                            onClick={toggleSelected}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleSelected();
                              }
                            }}
                            className={`cursor-pointer transition ${
                              isSelected
                                ? "bg-accent-50 text-brand-800 ring-1 ring-inset ring-accent-500"
                                : isAlternate
                                  ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                                  : "bg-white text-brand-700 hover:bg-brand-50"
                            }`}
                          >
                            <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">{user.full_name ?? "—"}</td>
                            <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5">{user.email ?? "—"}</td>
                            <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5">{user.department ?? "—"}</td>
                            <td className="whitespace-nowrap px-2 py-0.5">{user.role}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!selectedUser}
                  onClick={() => selectedUser && navigate("/user-details", { state: { user: selectedUser } })}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Rediger
                </button>
                <button
                  type="button"
                  disabled={!selectedUser}
                  onClick={() => selectedUser && setPendingDelete(selectedUser)}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Slet
                </button>
              </div>

              <button
                type="button"
                onClick={() => navigate("/user-details")}
                className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Opret ny bruger
              </button>
            </div>
          </section>
        </motion.main>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          message="Er du sikker på, at du vil slette denne bruger?"
          error={deleteError}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void handleDeleteUser()}
          isPending={isDeleting}
          confirmPendingLabel="Sletter…"
        />
      )}
    </div>
  );
}
