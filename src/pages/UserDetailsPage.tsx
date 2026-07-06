import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
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

export function UserDetailsPage() {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const user = (location.state as { user?: ProfileRow } | null)?.user ?? null;

  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [department, setDepartment] = useState(user?.department ?? "");
  const [role, setRole] = useState(user?.role ?? "");

  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const [existingProfileId, setExistingProfileId] = useState<string | null>(user?.id ?? null);
  const [pendingAction, setPendingAction] = useState<"create" | "update" | "close" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hasChanges =
    fullName !== (user?.full_name ?? "") ||
    email !== (user?.email ?? "") ||
    phone !== (user?.phone ?? "") ||
    department !== (user?.department ?? "") ||
    role !== (user?.role ?? "");

  useEffect(() => {
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailExists(null);
      setExistingProfileId(null);
      return;
    }

    const handle = setTimeout(async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", trimmed)
        .maybeSingle<{ id: string }>();

      if (error) {
        setEmailExists(null);
        return;
      }

      setEmailExists(Boolean(data));
      setExistingProfileId(data?.id ?? null);
    }, 400);

    return () => clearTimeout(handle);
  }, [email]);

  const canCreate = email.trim().length > 0 && emailExists === false;
  const canUpdate = hasChanges && emailExists === true;

  const handleConfirm = async () => {
    if (pendingAction === "close") {
      navigate("/department");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    if (pendingAction === "create") {
      try {
        const response = await fetch("/.netlify/functions/create-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            full_name: fullName || null,
            phone: phone || null,
            department: department || null,
            role: role || "user",
          }),
        });

        const result = (await response.json()) as { id?: string; error?: string };

        if (!response.ok) {
          setSubmitError(result.error ?? "Kunne ikke oprette bruger.");
          setIsSubmitting(false);
          return;
        }
      } catch {
        setSubmitError("Kunne ikke kontakte serveren. Prøv igen senere.");
        setIsSubmitting(false);
        return;
      }
    }

    if (pendingAction === "update") {
      const targetId = existingProfileId ?? user?.id;
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          email: email.trim(),
          full_name: fullName || null,
          phone: phone || null,
          department: department || null,
          role: role || "user",
        })
        .eq("id", targetId);

      if (updateError) {
        setSubmitError(updateError.message);
        setIsSubmitting(false);
        return;
      }
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/department");
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
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <FleetiiLogo className="h-8 w-auto shrink-0" linkToHome />
              <p className="min-w-0 truncate text-[0.7rem] font-medium text-brand-600">{formatRoleLabel(profile?.role)}: {profile?.email ?? "—"} - Afdeling: {profile?.department ?? "—"}</p>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => navigate(-1)}
                aria-label="Tilbage"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-200 bg-white text-brand-700 transition hover:bg-brand-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                onClick={() => void signOut()}
                className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
              >
                Log ud
              </button>
            </div>
          </div>

          <section className="flex min-h-0 flex-1 flex-col rounded-[2rem] border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">Bruger oplysninger</h2>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Navn:</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">E-mail:</label>
                    <input
                      type="text"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Telefon:</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Afdeling:</label>
                    <input
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Rolle:</label>
                    <input
                      type="text"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                </div>
              </div>

              {submitError && <p className="text-sm text-red-600">{submitError}</p>}

              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setPendingAction("create")}
                  disabled={!canCreate}
                  className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Opret bruger
                </button>
                <button
                  type="button"
                  onClick={() => setPendingAction("update")}
                  disabled={!canUpdate}
                  className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Opdater bruger
                </button>
                <button
                  type="button"
                  onClick={() => setPendingAction("close")}
                  className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Luk
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>

      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <p className="text-sm font-medium text-brand-800">
              {pendingAction === "create" && "Er du sikker på, at du vil oprette denne bruger?"}
              {pendingAction === "update" && "Er du sikker på, at du vil opdatere denne bruger?"}
              {pendingAction === "close" && "Er du sikker på, at du vil lukke uden at gemme?"}
            </p>
            {submitError && <p className="mt-2 text-sm text-red-600">{submitError}</p>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                disabled={isSubmitting}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Nej
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={isSubmitting}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Vent…" : "Ja"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
