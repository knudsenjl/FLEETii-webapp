import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { supabase } from "../lib/supabase";
import { EMAIL_PATTERN, PHONE_PATTERN } from "../lib/validation";

/** A row from the `user_profiles` table. When reached with one pre-filled via router state (clicking a row on DepartmentPage), the form is meant to edit it — see the KNOWN LIMITATION below. */
type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  department_name: string | null;
  role: string;
};

/**
 * Admin "create/edit user" form ("/user-details"). Validates every field is
 * filled and that the email isn't already taken (debounced live check
 * against `user_profiles`, ignoring the user's own row when editing) before
 * enabling "Opret bruger"/"Opdater bruger", which call the create-user/
 * update-user Netlify Functions respectively (authenticated with the
 * current session). When reached with an existing user (via DepartmentPage),
 * also shows "Slet", which calls the delete-user Netlify Function to remove
 * both that user's `user_profiles` row AND their underlying Supabase Auth
 * account — not just the profile row, so a "deleted" user can no longer log
 * in either (see delete-user.mts's header for why this needs the
 * service-role key and can't be a direct client-side delete).
 */
export function UserDetailsPage() {
  const { session, costumerId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const user = (location.state as { user?: ProfileRow } | null)?.user ?? null;

  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  // No default department when there's a real choice to make (2+ options) —
  // the admin must explicitly pick one from the dropdown. Auto-filled (and
  // locked, see the departmentOptions effect below) only when their costumer
  // has exactly one department, since there's no actual choice then.
  const [department, setDepartment] = useState(user?.department_name ?? "");
  const [role, setRole] = useState(user?.role ?? "user");

  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const [pendingAction, setPendingAction] = useState<"create" | "update" | "close" | "delete" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);

  // Scoped to the admin's own costumer (costumerId) — otherwise this listed
  // every department across every costumer, letting an admin assign a new
  // user to a department outside their own company.
  useEffect(() => {
    if (!costumerId) {
      setDepartmentOptions([]);
      return;
    }
    void supabase
      .from("departments")
      .select("name")
      .eq("costumer_id", costumerId)
      .order("name", { ascending: true })
      .returns<{ name: string }[]>()
      .then(({ data }) => setDepartmentOptions((data ?? []).map((d) => d.name)));
  }, [costumerId]);

  // A costumer with only one department has no real choice to make — force
  // it and lock the field instead of showing a single-option dropdown.
  useEffect(() => {
    if (departmentOptions.length === 1) {
      setDepartment(departmentOptions[0]);
    }
  }, [departmentOptions]);

  useEffect(() => {
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailExists(null);
      return;
    }

    const handle = setTimeout(async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("user_id")
        .eq("email", trimmed)
        .maybeSingle<{ user_id: string }>();

      if (error) {
        setEmailExists(null);
        return;
      }

      // Editing an existing user: their own (unchanged) email is not a
      // conflict — only a match belonging to a DIFFERENT user counts.
      setEmailExists(Boolean(data) && data?.user_id !== user?.user_id);
    }, 400);

    return () => clearTimeout(handle);
  }, [email, user?.user_id]);

  const emailFormatInvalid = email.trim().length > 0 && !EMAIL_PATTERN.test(email.trim());
  const phoneFormatInvalid = phone.trim().length > 0 && !PHONE_PATTERN.test(phone.trim());

  const canSubmit =
    fullName.trim().length > 0 &&
    EMAIL_PATTERN.test(email.trim()) &&
    emailExists === false &&
    PHONE_PATTERN.test(phone.trim()) &&
    department.trim().length > 0 &&
    role.trim().length > 0;

  /** Deletes this user's `user_profiles` row AND their Supabase Auth account via delete-user.mts (a real client-side delete can't reach auth.users at all — that requires the service-role key), then returns to DepartmentPage. */
  const handleDelete = async () => {
    if (!user) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/.netlify/functions/delete-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ userId: user.user_id }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSubmitError(result.error ?? "Kunne ikke slette bruger.");
        setIsSubmitting(false);
        return;
      }
    } catch {
      setSubmitError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/department");
  };

  /** Calls update-user with the form's current values for this user, authenticated with the current session's access token. Shows the server's error message (or a generic connection-failure one) inline on failure. */
  const handleUpdate = async () => {
    if (!user) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/.netlify/functions/update-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          userId: user.user_id,
          email: email.trim(),
          full_name: fullName || null,
          phone: phone || null,
          department: department || null,
          role: role || "user",
        }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSubmitError(result.error ?? "Kunne ikke opdatere bruger.");
        setIsSubmitting(false);
        return;
      }
    } catch {
      setSubmitError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/department");
  };

  /** Calls create-user with the form's values, authenticated with the current session's access token. Shows the server's error message (or a generic connection-failure one) inline on failure. */
  const handleConfirm = async () => {
    if (pendingAction === "close") {
      navigate("/department");
      return;
    }

    if (pendingAction === "delete") {
      await handleDelete();
      return;
    }

    if (pendingAction === "update") {
      await handleUpdate();
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/.netlify/functions/create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          email: email.trim(),
          full_name: fullName || null,
          phone: phone || null,
          department: department || null,
          role: role || "user",
        }),
      });

      const result = (await response.json()) as { id?: string; emailSent?: boolean; error?: string };

      if (!response.ok) {
        setSubmitError(result.error ?? "Kunne ikke oprette bruger.");
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      setPendingAction(null);
      navigate("/department", { state: { emailWarning: result.emailSent === false } });
      return;
    } catch {
      setSubmitError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsSubmitting(false);
      return;
    }
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
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">
                {user ? "Opdater bruger oplysninger" : "Ny bruger oplysninger"}
              </h2>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <RequiredFieldRow label="Navn:" value={fullName} onChange={setFullName} />
                  <RequiredFieldRow label="E-mail:" value={email} onChange={setEmail} type="email" />
                  <RequiredFieldRow label="Telefon:" value={phone} onChange={setPhone} type="tel" />
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Afdeling: {departmentOptions.length !== 1 && <span className="ml-0.5 text-red-600">*</span>}
                    </label>
                    {departmentOptions.length === 1 ? (
                      <input
                        type="text"
                        readOnly
                        disabled
                        value={departmentOptions[0]}
                        className="cursor-not-allowed rounded-lg border border-brand-200 bg-brand-100/60 px-2 py-0.5 text-sm text-brand-800"
                      />
                    ) : (
                      <select
                        required
                        aria-required="true"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      >
                        <option value="">Vælg afdeling</option>
                        {departmentOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Rolle: <span className="ml-0.5 text-red-600">*</span>
                    </label>
                    <select
                      required
                      aria-required="true"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    >
                      <option value="">Vælg rolle</option>
                      <option value="user">Bruger</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </div>
                </div>
              </div>

              {emailFormatInvalid && <p className="text-xs text-red-600">Ugyldigt e-mailformat.</p>}
              {phoneFormatInvalid && <p className="text-xs text-red-600">Ugyldigt telefonnummer.</p>}

              <p className="text-right text-xs text-brand-500">
                <span className="text-red-600">*</span> Feltet skal udfyldes
              </p>

              {submitError && <p className="text-sm text-red-600">{submitError}</p>}

              {user ? (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPendingAction("update")}
                      disabled={!canSubmit}
                      className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Opdater bruger
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingAction("close")}
                      className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                    >
                      Fortryd
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingAction("delete")}
                    className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Slet bruger
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPendingAction("create")}
                    disabled={!canSubmit}
                    className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Opret bruger
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingAction("close")}
                    className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Fortryd
                  </button>
                </div>
              )}
            </div>
          </section>
        </motion.main>
      </div>

      {pendingAction && (
        <ConfirmDialog
          message={
            pendingAction === "create"
              ? "Er du sikker på, at du vil oprette denne bruger?"
              : pendingAction === "update"
                ? "Er du sikker på, at du vil opdatere denne bruger?"
                : pendingAction === "delete"
                  ? "Er du sikker på, at du vil slette denne bruger?"
                  : "Er du sikker på, at du vil lukke uden at gemme?"
          }
          error={submitError}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handleConfirm()}
          isPending={isSubmitting}
          confirmPendingLabel={pendingAction === "delete" ? "Sletter…" : "Vent…"}
        />
      )}
    </div>
  );
}
