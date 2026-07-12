import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { supabase } from "../lib/supabase";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  department: string | null;
  role: string;
};

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
        .from("profiles")
        .select("id, email, full_name, phone, department, role")
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
  const selectedUser = departmentUsers.find((u) => u.id === selectedUserId) ?? null;

  const handleDeleteUser = async () => {
    if (!pendingDelete) return;

    setIsDeleting(true);
    setDeleteError(null);

    const { error: deleteErr } = await supabase.from("profiles").delete().eq("id", pendingDelete.id);

    if (deleteErr) {
      setDeleteError(deleteErr.message);
      setIsDeleting(false);
      return;
    }

    setUsers((prev) => prev.filter((u) => u.id !== pendingDelete.id));
    if (selectedUserId === pendingDelete.id) setSelectedUserId(null);
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

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border border-brand-100">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7.5rem_7.5rem] bg-brand-50 px-1 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                  <div className="truncate border-r border-brand-200 pr-1">Navn</div>
                  <div className="truncate border-r border-brand-200 px-1">E-mail</div>
                  <div className="truncate border-r border-brand-200 px-1">Afdeling</div>
                  <div className="truncate px-1">Rolle</div>
                </div>

                <div className="min-h-0 flex-1 divide-y divide-brand-100 overflow-y-auto bg-white">
                  {loading && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Indlæser brugere…</div>
                  )}
                  {!loading && error && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-red-600">{error}</div>
                  )}
                  {!loading && !error && departmentUsers.length === 0 && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Ingen brugere fundet.</div>
                  )}
                  {!loading &&
                    !error &&
                    departmentUsers.map((user, index) => {
                      const isAlternate = index % 2 === 1;
                      const isSelected = user.id === selectedUserId;
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() =>
                            setSelectedUserId((current) => (current === user.id ? null : user.id))
                          }
                          className={`grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7.5rem_7.5rem] px-1 py-0.5 text-left text-[0.7rem] transition ${
                            isSelected
                              ? "bg-accent-50 text-brand-800 ring-1 ring-inset ring-accent-500"
                              : isAlternate
                                ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                                : "bg-white text-brand-700 hover:bg-brand-50"
                          }`}
                        >
                          <div className="truncate border-r border-brand-100 pr-1 font-medium">{user.full_name ?? "—"}</div>
                          <div className="truncate border-r border-brand-100 px-1">{user.email ?? "—"}</div>
                          <div className="truncate border-r border-brand-100 px-1">{user.department ?? "—"}</div>
                          <div className="truncate px-1">{user.role}</div>
                        </button>
                      );
                    })}
                </div>
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
