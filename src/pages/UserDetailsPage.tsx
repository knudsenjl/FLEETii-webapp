import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InlinePopup } from "../components/InlinePopup";
import { RettighederSettings, type RettighederSettingsHandle } from "../components/RettighederSettings";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";
import { EMAIL_PATTERN, PHONE_PATTERN } from "../lib/validation";

/** A row from the `user_profiles` table. When reached with one pre-filled via router state (clicking a row on DepartmentPage), the form edits it (see UserDetailsPage's own doc comment below for how). */
type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  department_name: string | null;
  role: string;
};

/** A department the user's home department could be set to, or a department listed in the Afdelinger grants table below — scoped to the admin's own costumer. */
type DepartmentOption = { department_id: string; name: string };

/** Always preselected and undeselectable in the Afdelinger table below, same treatment as HandleVehiclePage.tsx's vehicle Afdeling(er) list. */
const ALLE_KORETOJER_NAME = "Alle køretøjer";

/**
 * Admin "create/edit user" form. Validates every field is
 * filled and that the email isn't already taken (debounced live check
 * against `user_profiles`, ignoring the user's own row when editing) before
 * enabling "Opret bruger"/"Opdater bruger", which call the create-user/
 * update-user Netlify Functions respectively (authenticated with the
 * current session). When reached with an existing user (via DepartmentPage),
 * also shows "Arkiver bruger", which calls the delete-user Netlify Function
 * to ARCHIVE the account — bans their Supabase Auth login (so they can no
 * longer log in at all) and marks `user_profiles.deleted_at` rather than
 * deleting the row, so their booking history keeps resolving their name/
 * email exactly as before (see delete-user.mts's header for the full
 * reasoning, including why this needs the service-role key and can't be a
 * direct client-side action).
 *
 * Whenever the LOGGED-IN admin's own role (profile.role, not the role
 * being assigned to whichever user this form is creating/editing) is
 * "admin", "Hjemmeafdeling" becomes a select filtered to just
 * userDepartmentIds (staged locally pre-creation, loaded from
 * user_departments when editing) rather than every department in the
 * costumer, and the Afdelinger checkbox table (mirroring
 * HandleVehiclePage.tsx's Afdeling(er)/vehicle_departments pattern) is
 * shown — for both the "Ny bruger" creation form and editing an existing
 * user — so the admin can grant departments beyond the one home
 * department. (In practice this route already requires role "admin" to
 * reach at all — see App.tsx's ProtectedRoute requireAdmin — so today this
 * is always true; the explicit check exists so this page keeps behaving
 * correctly if that route guard ever changes.) Its own Hjemmeafdeling is
 * self-healed into userDepartmentIds regardless, so create-user.mts's own
 * historical gap (never seeding user_departments at all) gets closed for
 * every new user: on successful creation, whatever's in userDepartmentIds
 * (at least the chosen home department, thanks to that self-heal) is
 * inserted for the new user_id.
 *
 * Reachable at plain "/user-details" (create — no user, matches App.tsx's
 * route with no :userId) or "/user-details/:userId" (edit). Normally reached
 * with the user pre-filled via router state (DepartmentPage's row click),
 * which skips a round-trip; a direct URL/refresh/bookmark to the :userId
 * route (no router state) falls back to fetching it by id instead,
 * redirecting to "/department" if it can't be found (deleted, archived, or
 * outside the admin's own department per RLS) — since that case was clearly
 * meant to be an edit, not silently falling into the create form.
 */
export function UserDetailsPage() {
  const { session, profile, costumerId, afdelingId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { userId } = useParams<{ userId: string }>();
  const stateUser = (location.state as { user?: ProfileRow } | null)?.user ?? null;
  const [fetchedUser, setFetchedUser] = useState<ProfileRow | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const user = stateUser ?? fetchedUser;

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
  const rettighederRef = useRef<RettighederSettingsHandle>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [isLastAdmin, setIsLastAdmin] = useState(false);
  const { activeKey: warningKey, trigger: triggerWarning } = useTimedFlag();

  /** Fetch-by-id fallback for a direct URL/refresh/bookmark to "/user-details/:userId" (no router state) — skipped entirely when stateUser is already present. Excludes archived users (deleted_at) same as DepartmentPage's own list, and is naturally scoped to the admin's own department by user_profiles' SELECT RLS policy — a userId outside it just resolves to null, same as "not found". */
  useEffect(() => {
    if (stateUser || !userId) return;

    let cancelled = false;
    setUserLoading(true);
    void supabase
      .from("user_profiles")
      .select("user_id, email, full_name, phone, role, departments!user_profiles_department_id_fkey(name)")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle<{
        user_id: string;
        email: string | null;
        full_name: string | null;
        phone: string | null;
        role: string;
        departments: { name: string } | null;
      }>()
      .then(({ data }) => {
        if (cancelled) return;
        setFetchedUser(
          data
            ? {
                user_id: data.user_id,
                email: data.email,
                full_name: data.full_name,
                phone: data.phone,
                department_name: data.departments?.name ?? null,
                role: data.role,
              }
            : null,
        );
        setUserLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, stateUser]);

  // Populates the form fields once `user` resolves asynchronously (the
  // fetch-by-id path above) — the useState initializers just above only run
  // on the very first render, which happens before that fetch can possibly
  // have completed, so without this the fields would stay stuck blank even
  // once fetchedUser arrives. Harmless no-op re-set on the (more common)
  // router-state path, where `user` is already correct on the first render.
  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name ?? "");
    setEmail(user.email ?? "");
    setPhone(user.phone ?? "");
    setDepartment(user.department_name ?? "");
    setRole(user.role ?? "user");
  }, [user]);

  // Redirects back to the department list if a SPECIFIC user was requested
  // (a :userId in the URL) but couldn't be loaded (deleted, archived, or
  // outside the admin's own department) — mirrors BookingDetailsPage/
  // VehicleDetailsPage's same redirect-on-missing-data pattern. Never fires
  // for the plain "/user-details" create route, which has no userId at all.
  useEffect(() => {
    if (userId && !user && !userLoading) {
      navigate("/department", { replace: true });
    }
  }, [userId, user, userLoading, navigate]);

  /** This user's own Afdelinger grants (user_departments) — only loaded/relevant when editing an existing user (see the fetch effect below). */
  const [userDepartmentIds, setUserDepartmentIds] = useState<Set<string>>(new Set());
  /** The DB's own current user_departments rows, at load time — diffed against userDepartmentIds on save, same pattern as HandleVehiclePage.tsx's vehicle_departments reconciliation. */
  const [originalUserDepartmentIds, setOriginalUserDepartmentIds] = useState<Set<string>>(new Set());
  const [grantsLoading, setGrantsLoading] = useState(true);
  const [grantsError, setGrantsError] = useState<string | null>(null);

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
      .select("department_id, name")
      .eq("costumer_id", costumerId)
      .order("name", { ascending: true })
      .returns<DepartmentOption[]>()
      .then(({ data }) => {
        // "Alle køretøjer" always sorts first, ahead of the rest's
        // alphabetical order — same convention as HandleVehiclePage.tsx/
        // AuthContext.tsx's loadAvailableDepartments.
        const options = [...(data ?? [])].sort((a, b) => {
          if (a.name === "Alle køretøjer") return -1;
          if (b.name === "Alle køretøjer") return 1;
          return 0;
        });
        setDepartmentOptions(options);
      });
  }, [costumerId]);

  // A costumer with only one department has no real choice to make — force
  // it and lock the field instead of showing a single-option dropdown.
  useEffect(() => {
    if (departmentOptions.length === 1) {
      setDepartment(departmentOptions[0].name);
    }
  }, [departmentOptions]);

  /** Loads this user's own Afdelinger grants (user_departments) — only when editing an existing user. */
  useEffect(() => {
    if (!user) {
      setGrantsLoading(false);
      return;
    }

    let cancelled = false;
    setGrantsLoading(true);
    setGrantsError(null);

    void supabase
      .from("user_departments")
      .select("department_id")
      .eq("user_id", user.user_id)
      .returns<{ department_id: string }[]>()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setGrantsError(error.message);
          setGrantsLoading(false);
          return;
        }
        const grants = new Set((data ?? []).map((row) => row.department_id));
        setUserDepartmentIds(grants);
        setOriginalUserDepartmentIds(new Set(grants));
        setGrantsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  /** Self-heals the current home department into userDepartmentIds whenever either resolves/changes — a user's home department must always be one of their own grants, same invariant as vehicles always having "Alle køretøjer" (though here it just tracks whatever the current selection is, not one fixed name). Runs for a brand-new user too (not just when editing), so create-user.mts's insert below always has at least the chosen home department to seed. */
  useEffect(() => {
    const homeId = departmentOptions.find((d) => d.name === department)?.department_id;
    if (!homeId) return;
    setUserDepartmentIds((prev) => (prev.has(homeId) ? prev : new Set(prev).add(homeId)));
  }, [department, departmentOptions]);

  /** Self-heals "Alle køretøjer" into userDepartmentIds too — always preselected and undeselectable in the Afdelinger table below, same treatment as HandleVehiclePage.tsx's vehicle Afdeling(er) list. */
  useEffect(() => {
    const alleId = departmentOptions.find((d) => d.name === ALLE_KORETOJER_NAME)?.department_id;
    if (!alleId) return;
    setUserDepartmentIds((prev) => (prev.has(alleId) ? prev : new Set(prev).add(alleId)));
  }, [departmentOptions]);

  // Pre-checks whether this user is the last remaining admin in the
  // (caller's own) department, so clicking "Arkiver bruger" can show a
  // warning popup instead of "Er du sikker...?" for an archive delete-user.mts
  // will reject anyway. Mirrors that function's own guard — this is a UX
  // pre-check only, not the authorization boundary (the server re-checks it
  // regardless).
  useEffect(() => {
    if (!user || user.role !== "admin" || !afdelingId) {
      setIsLastAdmin(false);
      return;
    }
    void supabase
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("department_id", afdelingId)
      .eq("role", "admin")
      .is("deleted_at", null)
      .neq("user_id", user.user_id)
      .then(({ count }) => setIsLastAdmin((count ?? 0) === 0));
  }, [user, afdelingId]);

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

  const homeDepartmentId = departmentOptions.find((d) => d.name === department)?.department_id;

  /** Toggles a department's Afdelinger grant — refuses the one matching the current home department (a user can't lose access to their own active home department) and "Alle køretøjer" (always granted, matching HandleVehiclePage.tsx's vehicle Afdeling(er) list), guarded here too rather than trusting only the checkbox's disabled attribute below. */
  const toggleUserDepartment = (option: DepartmentOption, checked: boolean) => {
    if (option.department_id === homeDepartmentId || option.name === ALLE_KORETOJER_NAME) return;

    setUserDepartmentIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(option.department_id);
      } else {
        next.delete(option.department_id);
      }
      return next;
    });
  };

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

  /** Calls update-user with the form's current values for this user, authenticated with the current session's access token, then persists any pending Rettigheder checkbox changes (staged locally via deferSave — see RettighederSettings' exposed save()). Shows the server's error message (or a generic connection-failure one) inline on failure. */
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

    // Reconciles user_departments against whatever was toggled — only when
    // the grants section itself loaded successfully, so a failed fetch
    // (grantsError set) can't wipe out real grants the admin never
    // actually saw or touched. Mirrors HandleVehiclePage.tsx's own
    // vehicle_departments reconciliation.
    if (!grantsError) {
      const toAdd = [...userDepartmentIds].filter((id) => !originalUserDepartmentIds.has(id));
      const toRemove = [...originalUserDepartmentIds].filter((id) => !userDepartmentIds.has(id));

      if (toRemove.length > 0) {
        const { error: removeError } = await supabase
          .from("user_departments")
          .delete()
          .eq("user_id", user.user_id)
          .in("department_id", toRemove);
        if (removeError) {
          setSubmitError(removeError.message);
          setIsSubmitting(false);
          return;
        }
      }

      if (toAdd.length > 0) {
        const { error: addError } = await supabase
          .from("user_departments")
          .insert(toAdd.map((department_id) => ({ user_id: user.user_id, department_id })));
        if (addError) {
          setSubmitError(addError.message);
          setIsSubmitting(false);
          return;
        }
      }
    }

    const rettighederResult = await rettighederRef.current?.save();
    if (rettighederResult?.error) {
      setSubmitError(rettighederResult.error);
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

      // Seeds user_departments for the new user — create-user.mts itself
      // never touches that table, so without this a brand-new user would
      // have zero grants (the gap flagged earlier this session). The
      // self-heal effect above guarantees userDepartmentIds already has at
      // least the chosen home department; if role is "admin" it may also
      // include whatever else was checked in the Afdelinger table.
      const newUserId = result.id;
      if (newUserId && userDepartmentIds.size > 0) {
        const { error: insertGrantsError } = await supabase
          .from("user_departments")
          .insert([...userDepartmentIds].map((department_id) => ({ user_id: newUserId, department_id })));
        if (insertGrantsError) {
          setSubmitError(insertGrantsError.message);
          setIsSubmitting(false);
          return;
        }
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

  // Only while a SPECIFIC user is being fetched by id (:userId present, no
  // router state yet) — without this guard, the form would flash as "Ny
  // bruger oplysninger" (create mode) for a moment before the fetch resolves
  // and `user` becomes non-null.
  if (userId && !user && userLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-brand-50 text-brand-600">Indlæser bruger…</div>
    );
  }

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
                      Hjemmeafdeling: {departmentOptions.length !== 1 && <span className="ml-0.5 text-red-600">*</span>}
                    </label>
                    {departmentOptions.length === 1 ? (
                      <input
                        type="text"
                        readOnly
                        disabled
                        value={departmentOptions[0].name}
                        className="cursor-not-allowed rounded-lg border border-brand-200 bg-brand-100/60 px-2 py-0.5 text-sm text-brand-800"
                      />
                    ) : profile?.role === "admin" ? (
                      <select
                        required
                        aria-required="true"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      >
                        <option value="" className="bg-brand-100">Vælg hjemmeafdeling:</option>
                        {departmentOptions
                          .filter((option) => userDepartmentIds.has(option.department_id))
                          .map((option) => (
                            <option key={option.department_id} value={option.name}>
                              {option.name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <select
                        required
                        aria-required="true"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      >
                        <option value="" className="bg-brand-100">Vælg hjemmeafdeling:</option>
                        {departmentOptions.map((option) => (
                          <option key={option.department_id} value={option.name}>
                            {option.name}
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
                      <option value="" className="bg-brand-100">Vælg rolle:</option>
                      <option value="user">Bruger</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </div>
                  {profile?.role === "admin" && (
                    <div className="grid grid-cols-2 items-start gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">Afdeling(er):</label>
                      <div className="py-0.5">
                        {grantsLoading && <span className="text-sm text-brand-500">Indlæser…</span>}
                        {!grantsLoading && grantsError && <span className="text-sm text-red-600">{grantsError}</span>}
                        {!grantsLoading && !grantsError && (
                          <div className="max-h-32 overflow-auto rounded-none border border-brand-100">
                            <table className="w-full border-collapse text-[0.7rem]">
                              <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                                <tr>
                                  <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">
                                    Afdeling
                                  </th>
                                  <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-center">
                                    Tilladt
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-brand-100 bg-white">
                                {departmentOptions.length === 0 && (
                                  <tr>
                                    <td colSpan={2} className="px-2 py-1 text-center text-brand-500">
                                      Ingen afdelinger fundet.
                                    </td>
                                  </tr>
                                )}
                                {departmentOptions.map((option) => {
                                  const isHome = option.department_id === homeDepartmentId;
                                  const isAlleKoretojer = option.name === ALLE_KORETOJER_NAME;
                                  const isLocked = isHome || isAlleKoretojer;
                                  return (
                                    <tr key={option.department_id}>
                                      <td className="whitespace-nowrap px-2 py-0.5 font-medium text-brand-700">
                                        {option.name}
                                      </td>
                                      <td className="px-2 py-0.5 text-center">
                                        <input
                                          type="checkbox"
                                          checked={isLocked || userDepartmentIds.has(option.department_id)}
                                          disabled={isLocked}
                                          title={
                                            isAlleKoretojer
                                              ? "Alle køretøjer kan ikke fjernes"
                                              : isHome
                                                ? "Kan ikke fjernes fra brugerens hjemmeafdeling"
                                                : undefined
                                          }
                                          onChange={(e) => toggleUserDepartment(option, e.target.checked)}
                                          className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500 disabled:cursor-not-allowed"
                                        />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {emailFormatInvalid && <p className="text-xs text-red-600">Ugyldigt e-mailformat.</p>}
              {phoneFormatInvalid && <p className="text-xs text-red-600">Ugyldigt telefonnummer.</p>}

              <p className="text-right text-xs text-brand-500">
                <span className="text-red-600">*</span> Feltet skal udfyldes
              </p>

              {user && user.role === "user" && (
                <RettighederSettings
                  ref={rettighederRef}
                  table="user_settings"
                  scopeColumn="user_id"
                  scopeId={user.user_id}
                  deferSave
                />
              )}

              {submitError && <p className="text-sm text-red-600">{submitError}</p>}

              {user ? (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSubmitError(null);
                        setPendingAction("update");
                      }}
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
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        if (isLastAdmin) {
                          triggerWarning("last-admin");
                          return;
                        }
                        setSubmitError(null);
                        setPendingAction("delete");
                      }}
                      className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                    >
                      Arkiver bruger
                    </button>
                    <InlinePopup
                      visible={warningKey === "last-admin"}
                      message="Kan ikke arkivere den sidste administrator i afdelingen."
                      variant="warning"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSubmitError(null);
                      setPendingAction("create");
                    }}
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
                  ? "Er du sikker på, at du vil arkivere denne bruger? Brugeren kan ikke længere logge ind, men brugerens historik (fx bookinger) bevares."
                  : "Er du sikker på, at du vil lukke uden at gemme?"
          }
          error={submitError}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handleConfirm()}
          isPending={isSubmitting}
          confirmPendingLabel={pendingAction === "delete" ? "Arkiverer…" : "Vent…"}
        />
      )}
    </div>
  );
}
