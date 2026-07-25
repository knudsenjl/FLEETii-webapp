import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { supabase } from "../lib/supabase";

/** The costumer row, as passed in via router state from FleetiiAdministrationPage. Absent when reached via "Ny kunde" — see the KNOWN LIMITATION below. */
type Costumer = {
  costumer_id: string;
  name: string | null;
  deactivated_at: string | null;
  cvr: string | null;
  address: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
};

/**
 * Costumer view — plain "/costumer-details" (create, matches App.tsx's
 * route with no :costumerId) or "/costumer-details/:costumerId" (edit) —
 * reachable only by role "FLEETii admin" (see ProtectedRoute
 * requireRole="FLEETii admin" in App.tsx). Reads an existing costumer (Navn,
 * plus its departments) when reached with one pre-filled via router state
 * (FleetiiAdministrationPage's row click, which skips a round-trip); a
 * direct URL/refresh/bookmark to the :costumerId route (no router state)
 * falls back to fetching it by id instead, redirecting to "/fleetii-admin"
 * if it can't be found. "Rediger kunde" switches it into an editable form in
 * place (in-place rather than a separate page like VehicleDetailsPage/
 * HandleVehiclePage, since costumers only have one editable field). Reached
 * without a costumer (its "Ny kunde" button, or the plain "/costumer-details"
 * route), shows a create form instead — inserting a new costumers row
 * auto-creates its first department (see
 * supabase/applied/departments_default_name_alle_koretojer.sql). Department
 * management itself (create/select/delete) now lives on its own page — see
 * DepartmentDetailsPage.tsx — reached via "Administration af afdelinger"
 * below.
 *
 * Costumer lifecycle (see supabase/applied/costumers_add_deactivated_at.sql /
 * costumer_purge_function.sql, and delete-costumer.mts):
 *   - "Bloker kundens adgang" / "Genetabler kundens adgang" — reversible,
 *     blocks login for every user under the costumer (disputes/non-payment).
 *     Backed by costumers.deactivated_at (internal name — the UI-facing
 *     wording is "blocked access", not "deactivated"). Plain client-side
 *     update; no new RLS policy needed.
 *   - "Slet kunden permanent" — the final, IRREVERSIBLE step, only shown
 *     once the costumer's access is already blocked (alongside "Genetabler
 *     kundens adgang" — "Rediger kunde" is hidden in this state instead,
 *     since editing a costumer that's about to be purged isn't meaningful).
 *     Requires typing the costumer's exact name to confirm, then calls
 *     delete-costumer.mts, which purges every trace of the
 *     costumer's data (bookings, vehicles, settings, departments, user
 *     profiles, the costumer row) AND every affected user's Supabase Auth
 *     account — a real client-side delete can't reach auth.users at all,
 *     and the DB-side purge itself is only callable via the service-role
 *     client, never directly from the browser.
 */
export function CostumerDetailsPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const location = useLocation();
  const { costumerId } = useParams<{ costumerId: string }>();
  const state = location.state as { costumer?: Costumer; startEditing?: boolean } | null;
  const stateCostumer = state?.costumer ?? null;
  const [fetchedCostumer, setFetchedCostumer] = useState<Costumer | null>(null);
  const [costumerLoading, setCostumerLoading] = useState(false);
  const costumer = stateCostumer ?? fetchedCostumer;

  const [name, setName] = useState("");
  const [cvr, setCvr] = useState("");
  const [address, setAddress] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Seeded from router state's startEditing flag — handleCreate navigates
  // here right after "Opret kunde" with that flag set, so the newly created
  // costumer lands directly in its edit view instead of the plain
  // Kundedetaljer view.
  const [isEditing, setIsEditing] = useState(Boolean(state?.startEditing));
  const [editName, setEditName] = useState(costumer?.name ?? "");
  const [editCvr, setEditCvr] = useState(costumer?.cvr ?? "");
  const [editAddress, setEditAddress] = useState(costumer?.address ?? "");
  const [editContactPerson, setEditContactPerson] = useState(costumer?.contact_person ?? "");
  const [editPhone, setEditPhone] = useState(costumer?.phone ?? "");
  const [editEmail, setEditEmail] = useState(costumer?.email ?? "");
  const [pendingAction, setPendingAction] = useState<
    "create" | "update" | "delete" | "close" | "deactivate" | "reactivate" | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Local copy of costumer.deactivated_at, updated after a successful
  // deactivate/reactivate — costumer itself comes from router state (set
  // once at mount), so it wouldn't otherwise reflect a toggle made on this
  // same page visit without navigating away and back.
  const [deactivatedAt, setDeactivatedAt] = useState<string | null>(costumer?.deactivated_at ?? null);
  // Bound to the "type the costumer's name to confirm" input in the purge
  // ConfirmDialog — this is the one truly irreversible action in the app,
  // unlike archiving a user (data survives) or deactivating a costumer
  // (reversible), so a plain Ja/Fortryd dialog isn't enough friction.
  const [purgeConfirmText, setPurgeConfirmText] = useState("");

  const canSubmit =
    name.trim().length > 0 &&
    cvr.trim().length > 0 &&
    address.trim().length > 0 &&
    contactPerson.trim().length > 0 &&
    phone.trim().length > 0 &&
    email.trim().length > 0;
  const canSubmitEdit = editName.trim().length > 0;

  /** Fetch-by-id fallback for a direct URL/refresh/bookmark to "/costumer-details/:costumerId" (no router state) — skipped entirely when stateCostumer is already present. */
  useEffect(() => {
    if (stateCostumer || !costumerId) return;

    let cancelled = false;
    setCostumerLoading(true);
    void supabase
      .from("costumers")
      .select("costumer_id, name, deactivated_at, cvr, address, contact_person, phone, email")
      .eq("costumer_id", costumerId)
      .maybeSingle<Costumer>()
      .then(({ data }) => {
        if (cancelled) return;
        setFetchedCostumer(data ?? null);
        setCostumerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [costumerId, stateCostumer]);

  // Populates editName/deactivatedAt once `costumer` resolves asynchronously
  // (the fetch-by-id path above) — their useState initializers only run on
  // the very first render, before that fetch can possibly have completed.
  // Harmless no-op re-set on the (more common) router-state path, where
  // `costumer` is already correct on the first render.
  useEffect(() => {
    if (!costumer) return;
    setEditName(costumer.name ?? "");
    setDeactivatedAt(costumer.deactivated_at ?? null);
    setEditCvr(costumer.cvr ?? "");
    setEditAddress(costumer.address ?? "");
    setEditContactPerson(costumer.contact_person ?? "");
    setEditPhone(costumer.phone ?? "");
    setEditEmail(costumer.email ?? "");
  }, [costumer]);

  // Redirects back to the FLEETii-admin costumer list if a SPECIFIC costumer
  // was requested (a :costumerId in the URL) but couldn't be loaded —
  // mirrors BookingDetailsPage/VehicleDetailsPage/UserDetailsPage's same
  // redirect-on-missing-data pattern. Never fires for the plain
  // "/costumer-details" create route, which has no costumerId at all.
  useEffect(() => {
    if (costumerId && !costumer && !costumerLoading) {
      navigate("/fleetii-admin", { replace: true });
    }
  }, [costumerId, costumer, costumerLoading, navigate]);

  /** Inserts the new costumer row; the costumers_create_default_department trigger handles seeding its first department. */
  const handleCreate = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    // .select().single() so the newly created row (including its
    // costumer_id) comes straight back — needed to navigate onward into
    // its edit view without a redundant fetch.
    const { data, error } = await supabase
      .from("costumers")
      .insert({
        name: name.trim(),
        cvr: cvr.trim() || null,
        address: address.trim() || null,
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
      })
      .select("costumer_id, name, deactivated_at, cvr, address, contact_person, phone, email")
      .single<Costumer>();

    if (error || !data) {
      setSubmitError(error?.message ?? "Kunne ikke oprette kunden.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate(`/costumer-details/${data.costumer_id}`, {
      replace: true,
      state: { costumer: data, startEditing: true },
    });
  };

  const handleUpdate = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const { error } = await supabase
      .from("costumers")
      .update({
        name: editName.trim(),
        cvr: editCvr.trim() || null,
        address: editAddress.trim() || null,
        contact_person: editContactPerson.trim() || null,
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
      })
      .eq("costumer_id", costumer.costumer_id);

    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/fleetii-admin");
  };

  /**
   * Permanently purges the costumer — every booking, vehicle, setting,
   * department/user grant, user profile, department, and the costumer row
   * itself, plus every affected user's Supabase Auth account — via
   * delete-costumer.mts (a real client-side delete can't reach auth.users,
   * and the DB-side purge_costumer function is deliberately unreachable
   * from the browser — see both files' headers). Only reachable once
   * deactivatedAt is set and purgeConfirmText matches the costumer's name
   * exactly — both re-checked server-side regardless, this is just the
   * client-side guard that avoids the round-trip for an obviously-blocked
   * attempt.
   */
  const handleDelete = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/.netlify/functions/delete-costumer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ costumerId: costumer.costumer_id, confirmName: purgeConfirmText }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSubmitError(result.error ?? "Kunne ikke slette kunden.");
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
    navigate("/fleetii-admin");
  };

  /** Blocks login for every user under this costumer (see costumers_add_deactivated_at.sql — is_admin()/current_department_id()/current_costumer_id() also stop resolving for them, and AuthContext/LoginPage force a sign-out/refuse sign-in client-side). Reversible via handleReactivate. Plain client-side update — costumers_update_fleetii_admin already covers any column, no new RLS policy needed. */
  const handleDeactivate = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("costumers")
      .update({ deactivated_at: now })
      .eq("costumer_id", costumer.costumer_id);

    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }

    setDeactivatedAt(now);
    setIsSubmitting(false);
    setPendingAction(null);
  };

  /** Reverses handleDeactivate — restores login for this costumer's users. */
  const handleReactivate = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const { error } = await supabase
      .from("costumers")
      .update({ deactivated_at: null })
      .eq("costumer_id", costumer.costumer_id);

    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }

    setDeactivatedAt(null);
    setIsSubmitting(false);
    setPendingAction(null);
  };

  const handleConfirm = async () => {
    if (pendingAction === "close") {
      navigate("/fleetii-admin");
      return;
    }
    if (pendingAction === "update") {
      await handleUpdate();
      return;
    }
    if (pendingAction === "delete") {
      await handleDelete();
      return;
    }
    if (pendingAction === "deactivate") {
      await handleDeactivate();
      return;
    }
    if (pendingAction === "reactivate") {
      await handleReactivate();
      return;
    }
    await handleCreate();
  };

  // Only while a SPECIFIC costumer is being fetched by id (:costumerId
  // present, no router state yet) — without this guard, the form would
  // flash as "Ny kunde" (create mode) for a moment before the fetch resolves
  // and `costumer` becomes non-null.
  if (costumerId && !costumer && costumerLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-brand-50 text-brand-600">Indlæser kunde…</div>
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

          <p className="text-sm font-medium text-red-600">
            Vi skal have diskuteret, hvilke oplysninger der skal opbevares i FLEETii om hver kunde. Disse oplysninger
            vil KUN være synlige for vores interne brug (bortset fra navnet).
          </p>

          <section className="flex min-h-0 flex-1 flex-col gap-4 rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">
              {costumer ? (isEditing ? "Rediger kunde" : "Kundedetaljer") : "Ny kunde"}
            </h2>

            {costumer ? (
              isEditing ? (
                <>
                  <div className="overflow-hidden rounded-2xl border border-brand-100">
                    <div className="divide-y divide-brand-100 bg-white">
                      <RequiredFieldRow label="Navn:" value={editName} onChange={setEditName} />
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">CVR.</label>
                        <input
                          type="text"
                          value={editCvr}
                          onChange={(e) => setEditCvr(e.target.value)}
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      </div>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">Adresse:</label>
                        <input
                          type="text"
                          value={editAddress}
                          onChange={(e) => setEditAddress(e.target.value)}
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      </div>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">Kontaktperson:</label>
                        <input
                          type="text"
                          value={editContactPerson}
                          onChange={(e) => setEditContactPerson(e.target.value)}
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      </div>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">Tlf:</label>
                        <input
                          type="tel"
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      </div>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">E-mail:</label>
                        <input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      </div>
                    </div>
                  </div>

                  <p className="text-right text-xs text-brand-500">
                    <span className="text-red-600">*</span> Feltet skal udfyldes
                  </p>

                  {submitError && <p className="text-sm text-red-600">{submitError}</p>}

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPendingAction("update")}
                      disabled={!canSubmitEdit}
                      className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Opdater kunde
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditName(costumer.name ?? "");
                        setEditCvr(costumer.cvr ?? "");
                        setEditAddress(costumer.address ?? "");
                        setEditContactPerson(costumer.contact_person ?? "");
                        setEditPhone(costumer.phone ?? "");
                        setEditEmail(costumer.email ?? "");
                        setIsEditing(false);
                      }}
                      className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                    >
                      Fortryd
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="overflow-hidden rounded-2xl border border-brand-100">
                    <div className="divide-y divide-brand-100 bg-white">
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">Navn:</label>
                        <span className="text-sm text-brand-800">{costumer.name ?? "—"}</span>
                      </div>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">CVR.</label>
                        <span className="text-sm text-brand-800">{costumer.cvr ?? "—"}</span>
                      </div>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">Adresse:</label>
                        <span className="text-sm text-brand-800">{costumer.address ?? "—"}</span>
                      </div>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">Kontaktperson:</label>
                        <span className="text-sm text-brand-800">{costumer.contact_person ?? "—"}</span>
                      </div>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">Tlf:</label>
                        <span className="text-sm text-brand-800">{costumer.phone ?? "—"}</span>
                      </div>
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">E-mail:</label>
                        <span className="text-sm text-brand-800">{costumer.email ?? "—"}</span>
                      </div>
                    </div>
                  </div>

                  {deactivatedAt && (
                    <p className="text-sm font-medium text-red-600">
                      Kundens adgang er blokeret — alle brugere er låst ude.
                    </p>
                  )}

                  {submitError && <p className="text-sm text-red-600">{submitError}</p>}

                  <div className="grid grid-cols-2 gap-3">
                    {deactivatedAt ? (
                      <>
                        {/* Rediger kunde is intentionally hidden while access
                            is blocked — only two actions are meaningful for a
                            blocked costumer: restore access, or purge it for
                            good. */}
                        <button
                          type="button"
                          onClick={() => setPendingAction("reactivate")}
                          className="col-span-2 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                        >
                          Genetabler kundens adgang
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPurgeConfirmText("");
                            setPendingAction("delete");
                          }}
                          className="col-span-2 rounded-lg bg-red-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700"
                        >
                          Slet kunden permanent
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditName(costumer.name ?? "");
                            setEditCvr(costumer.cvr ?? "");
                            setEditAddress(costumer.address ?? "");
                            setEditContactPerson(costumer.contact_person ?? "");
                            setEditPhone(costumer.phone ?? "");
                            setEditEmail(costumer.email ?? "");
                            setIsEditing(true);
                          }}
                          className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                        >
                          Rediger kunde
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingAction("deactivate")}
                          className="rounded-lg bg-red-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700"
                        >
                          Bloker kundens adgang
                        </button>
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          navigate("/fleet-table", {
                            state: { costumerId: costumer.costumer_id, costumerName: costumer.name },
                          })
                        }
                        className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                      >
                        Administration af køretøjer
                      </button>
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          navigate("/department-details", {
                            state: { costumerId: costumer.costumer_id, costumerName: costumer.name },
                          })
                        }
                        className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                      >
                        Administration af afdelinger
                      </button>
                    </div>
                  </div>
                </>
              )
            ) : (
              <>
                <div className="overflow-hidden rounded-2xl border border-brand-100">
                  <div className="divide-y divide-brand-100 bg-white">
                    <RequiredFieldRow label="Navn:" value={name} onChange={setName} />
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">
                        CVR. <span className="ml-0.5 text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        aria-required="true"
                        value={cvr}
                        onChange={(e) => setCvr(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">
                        Adresse: <span className="ml-0.5 text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        aria-required="true"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">
                        Kontaktperson: <span className="ml-0.5 text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        aria-required="true"
                        value={contactPerson}
                        onChange={(e) => setContactPerson(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">
                        Tlf: <span className="ml-0.5 text-red-600">*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        aria-required="true"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">
                        E-mail: <span className="ml-0.5 text-red-600">*</span>
                      </label>
                      <input
                        type="email"
                        required
                        aria-required="true"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                  </div>
                </div>

                <p className="text-right text-xs text-brand-500">
                  <span className="text-red-600">*</span> Feltet skal udfyldes
                </p>

                {submitError && <p className="text-sm text-red-600">{submitError}</p>}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPendingAction("create")}
                    disabled={!canSubmit}
                    className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Opret kunde
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingAction("close")}
                    className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Fortryd
                  </button>
                </div>
              </>
            )}
          </section>
        </motion.main>
      </div>

      {pendingAction && (
        <ConfirmDialog
          message={
            pendingAction === "create"
              ? "Er du sikker på, at du vil oprette denne kunde?"
              : pendingAction === "update"
                ? "Er du sikker på, at du vil opdatere denne kunde?"
                : pendingAction === "delete"
                  ? (
                      <>
                        <p>
                          Dette sletter PERMANENT al data for "{costumer?.name ?? "denne kunde"}" — bookinger,
                          køretøjer, indstillinger og brugerkonti. Kan ikke fortrydes.
                        </p>
                        <p className="mt-2">
                          Skriv kundens navn for at bekræfte:
                        </p>
                        <input
                          type="text"
                          value={purgeConfirmText}
                          onChange={(e) => setPurgeConfirmText(e.target.value)}
                          placeholder={costumer?.name ?? ""}
                          className="mt-1.5 w-full rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-1.5 text-sm text-brand-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30"
                        />
                      </>
                    )
                  : pendingAction === "deactivate"
                    ? "Er du sikker på, at du vil blokere kundens adgang? Alle brugere under kunden bliver låst ude med det samme."
                    : pendingAction === "reactivate"
                      ? "Er du sikker på, at du vil genetablere kundens adgang? Alle brugere under kunden får adgang igen."
                      : "Er du sikker på, at du vil lukke uden at gemme?"
          }
          error={submitError}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handleConfirm()}
          isPending={isSubmitting}
          confirmDisabled={
            pendingAction === "delete" &&
            (!costumer?.name?.trim() || purgeConfirmText.trim() !== costumer.name.trim())
          }
          confirmPendingLabel={
            pendingAction === "delete"
              ? "Sletter…"
              : pendingAction === "deactivate"
                ? "Blokerer…"
                : pendingAction === "reactivate"
                  ? "Genetablerer…"
                  : "Vent…"
          }
        />
      )}
    </div>
  );
}
