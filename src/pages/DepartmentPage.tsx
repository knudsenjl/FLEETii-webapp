import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
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
  const { signOut, profile, afdeling } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userAction, setUserAction] = useState<{ user: ProfileRow; mode: "choose" | "confirm-delete" } | null>(null);
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

  const handleDeleteUser = async () => {
    if (!userAction) return;

    setIsDeleting(true);
    setDeleteError(null);

    const { error: deleteErr } = await supabase.from("profiles").delete().eq("id", userAction.user.id);

    if (deleteErr) {
      setDeleteError(deleteErr.message);
      setIsDeleting(false);
      return;
    }

    setUsers((prev) => prev.filter((u) => u.id !== userAction.user.id));
    setIsDeleting(false);
    setUserAction(null);
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
          <div className="mb-2 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <FleetiiLogo className="h-8 w-auto shrink-0" linkToHome />
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => void signOut()}
                  className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
                >
                  Log ud
                </button>
              </div>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[0.7rem] font-medium text-brand-600">{formatRoleLabel(profile?.role)}: {profile?.email ?? "—"}</p>
              <p className="shrink-0 truncate text-[0.7rem] font-medium text-brand-600">Afdeling: {afdeling ?? "—"}</p>
            </div>
          </div>

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
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => setUserAction({ user, mode: "choose" })}
                          className={`grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7.5rem_7.5rem] px-1 py-0.5 text-left text-[0.7rem] transition ${
                            isAlternate ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100" : "bg-white text-brand-700 hover:bg-brand-50"
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

      {userAction?.mode === "choose" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <p className="text-sm font-medium text-brand-800">
              {userAction.user.full_name ?? userAction.user.email ?? "Bruger"}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => navigate("/user-details", { state: { user: userAction.user } })}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Rediger
              </button>
              <button
                type="button"
                onClick={() => setUserAction({ user: userAction.user, mode: "confirm-delete" })}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Slet
              </button>
            </div>
            <button
              type="button"
              onClick={() => setUserAction(null)}
              className="mt-2 w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Annuller
            </button>
          </div>
        </div>
      )}

      {userAction?.mode === "confirm-delete" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <p className="text-sm font-medium text-brand-800">
              Er du sikker på, at du vil slette denne bruger?
            </p>
            {deleteError && <p className="mt-2 text-sm text-red-600">{deleteError}</p>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setUserAction(null)}
                disabled={isDeleting}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Nej
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteUser()}
                disabled={isDeleting}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeleting ? "Sletter…" : "Ja"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
