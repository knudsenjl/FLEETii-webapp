import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CountBadge } from "../components/CountBadge";
import { supabase } from "../lib/supabase";
import { friendlyCostumerError } from "../lib/costumerErrors";
import { normalizeNumberSpacing } from "../lib/textNormalization";

/** The costumer row, as passed in via router state from CostumerAdministrationPage. The address is three separate lines (street+number, postal code+city, country) rather than one free-text field — see supabase/applied/costumers_split_address_into_three_fields.sql. */
type Costumer = {
  costumer_id: string;
  name: string | null;
  deactivated_at: string | null;
  cvr: string | null;
  address_street: string | null;
  address_postal_city: string | null;
  address_country: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  /** Generated column (twohire_client_id/twohire_client_secret both set — see supabase/applied/costumers_add_has_twohire_credentials.sql). Never exposes the raw credential values, only whether they're both present — drives the view-mode "2hire:" summary row. */
  has_twohire_credentials: boolean | null;
  /** The RAW client ID (see supabase/applied/costumers_expose_twohire_client_id.sql) — unlike the secret, an OAuth2 client_id is treated as a semi-public identifier, not a secret, so it's readable and shown directly in the edit form's own row rather than behind a boolean. */
  twohire_client_id: string | null;
  /** Presence-only companion for the SECRET (see supabase/applied/costumers_add_has_twohire_client_id_and_secret.sql) — the raw value itself stays SELECT-revoked (it's the actual credential), so this is all the edit form's own row can show: whether one is set, never what it is. */
  has_twohire_client_secret: boolean | null;
};

/**
 * Costumer view — "/costumer-details/:costumerId", reachable only by role
 * "FLEETii admin" (see ProtectedRoute requireRole="FLEETii admin" in
 * App.tsx). Reads an existing costumer when reached with one pre-filled via
 * router state (CostumerAdministrationPage's row click, which skips a
 * round-trip); a direct URL/refresh/bookmark (no router state) falls back
 * to fetching it by id instead, redirecting to "/costumers" if it can't
 * be found. "Rediger kunde" switches it into an editable form in place
 * (in-place rather than a separate page like VehicleDetailsPage/
 * HandleVehiclePage, since costumers only have a handful of editable
 * fields). Department management itself (create/select/delete) lives on its
 * own page — see DepartmentDetailsPage.tsx — reached via "Administration af
 * afdelinger" below.
 *
 * This page's job is purely viewing/editing a costumer that ALREADY exists
 * — creating a new one (including the required "register it on 2hire's own
 * side, then paste the client ID/secret back in" step) is a separate,
 * self-contained flow on CostumerNewPage.tsx ("/costumer-new"), reached via
 * CostumerAdministrationPage's own "Opret kunde" button. Splitting these two
 * apart keeps this page's own state simple (one costumer, either viewed or
 * edited) instead of also juggling "which step of a multi-step creation
 * wizard is this". A costumer whose 2hire registration was interrupted
 * mid-way (CostumerNewPage abandoned without finishing, or without hitting
 * its own "Fortryd") still lands here like any other costumer — it shows up
 * with "Ikke konfigureret" below and CostumerAdministrationPage's own
 * "Mangler 2hire registrering" badge, and can be finished by simply typing
 * the two 2hire fields into the ordinary edit form and saving: handleUpdate
 * below ALSO calls 2hire-subscribe.mts (scoped to just this one costumer)
 * whenever those two fields are actually typed into, whether that's
 * finishing an interrupted draft or just rotating an existing costumer's
 * key — so this page never reintroduces the "credentials saved but nothing
 * ever subscribes the webhook" gap CostumerNewPage was built to close.
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
  const state = location.state as { costumer?: Costumer } | null;
  const stateCostumer = state?.costumer ?? null;
  // undefined = "haven't fetched yet" (so costumer below falls back to
  // stateCostumer for an instant first paint); null = "fetched, confirmed
  // gone" (e.g. deleted — must NOT fall back to stale state, or the
  // redirect-on-missing-data effect below would never fire).
  const [fetchedCostumer, setFetchedCostumer] = useState<Costumer | null | undefined>(undefined);
  const [costumerLoading, setCostumerLoading] = useState(false);
  // fetchedCostumer wins once it arrives, not stateCostumer — router state
  // is only an instant-paint fallback for the moment before the fetch
  // below resolves. It used to be the other way around (state always won),
  // which looked fine for a normal navigation (state IS fresh then) but
  // silently showed STALE data after a hard refresh: browsers keep
  // history.state across a same-URL reload, so location.state can still be
  // populated with whatever was fetched on a PREVIOUS visit — e.g. from
  // before a later schema change, missing fields entirely.
  const costumer = fetchedCostumer !== undefined ? fetchedCostumer : stateCostumer;

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(costumer?.name ?? "");
  const [editCvr, setEditCvr] = useState(costumer?.cvr ?? "");
  const [editStreet, setEditStreet] = useState(costumer?.address_street ?? "");
  const [editPostalCity, setEditPostalCity] = useState(costumer?.address_postal_city ?? "");
  const [editCountry, setEditCountry] = useState(costumer?.address_country ?? "");
  const [editContactPerson, setEditContactPerson] = useState(costumer?.contact_person ?? "");
  const [editPhone, setEditPhone] = useState(costumer?.phone ?? "");
  const [editEmail, setEditEmail] = useState(costumer?.email ?? "");
  // Only ever populated by typing — the render logic below (see the 2hire
  // client ID/secret rows) swaps each field to a locked, read-only display
  // (the real id / a fixed mask) the moment it's already set, same
  // treatment as CVR above, so these two only stay wired to an actual
  // <input> while genuinely empty. handleUpdate's own payload construction
  // relies on that: a still-blank value here means "nothing was typed,
  // leave whatever's in the DB alone" (it's either already set — locked, so
  // there was no input to type into — or still empty and the admin simply
  // didn't fill it in this time).
  const [editTwoHireClientId, setEditTwoHireClientId] = useState("");
  const [editTwoHireClientSecret, setEditTwoHireClientSecret] = useState("");
  const [pendingAction, setPendingAction] = useState<"update" | "delete" | "deactivate" | "reactivate" | null>(null);
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
  /** Whether the RAPPORTER button's "not implemented yet" InlinePopup is open — a plain click-to-toggle rather than a `title` tooltip, since hover has no equivalent on iOS/touch (see this project's own outline-button/InlinePopup conventions elsewhere, e.g. NewVehiclePage.tsx's "?" info popovers). */
  const [showRapporterInfo, setShowRapporterInfo] = useState(false);
  /** Row counts for the AFDELINGER/KØRETØJER/BRUGERE buttons' own tables, scoped to this costumer — drives each button's green corner CountBadge. null until loaded (no badge yet). */
  const [departmentsCount, setDepartmentsCount] = useState<number | null>(null);
  const [vehiclesCount, setVehiclesCount] = useState<number | null>(null);
  const [usersCount, setUsersCount] = useState<number | null>(null);

  const canSubmitEdit =
    editName.trim().length > 0 &&
    editStreet.trim().length > 0 &&
    editPostalCity.trim().length > 0 &&
    editCountry.trim().length > 0 &&
    editContactPerson.trim().length > 0 &&
    editPhone.trim().length > 0 &&
    editEmail.trim().length > 0;

  /** Always (re)fetches the costumer by id — even when router state already has one, since that state can be stale (see costumer's own comment above). stateCostumer still avoids a loading flash for a normal navigation by giving the first paint something to show while this resolves. */
  useEffect(() => {
    if (!costumerId) return;

    let cancelled = false;
    setCostumerLoading(true);
    void supabase
      .from("costumers")
      .select(
        "costumer_id, name, deactivated_at, cvr, address_street, address_postal_city, address_country, contact_person, phone, email, has_twohire_credentials, twohire_client_id, has_twohire_client_secret",
      )
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
  }, [costumerId]);

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
    setEditStreet(costumer.address_street ?? "");
    setEditPostalCity(costumer.address_postal_city ?? "");
    setEditCountry(costumer.address_country ?? "");
    setEditContactPerson(costumer.contact_person ?? "");
    setEditPhone(costumer.phone ?? "");
    setEditEmail(costumer.email ?? "");
  }, [costumer]);

  // Redirects back to the FLEETii-admin costumer list if the requested
  // costumer couldn't be loaded — mirrors BookingDetailsPage/
  // VehicleDetailsPage/UserDetailsPage's same redirect-on-missing-data
  // pattern.
  useEffect(() => {
    if (costumerId && !costumer && !costumerLoading) {
      navigate("/costumers", { replace: true });
    }
  }, [costumerId, costumer, costumerLoading, navigate]);

  // Row counts for the AFDELINGER/KØRETØJER/BRUGERE grid buttons below.
  useEffect(() => {
    const targetCostumerId = costumer?.costumer_id;
    if (!targetCostumerId) return;

    let cancelled = false;
    void supabase
      .from("departments")
      .select("department_id", { count: "exact", head: true })
      .eq("costumer_id", targetCostumerId)
      .then(({ count }) => {
        if (!cancelled) setDepartmentsCount(count ?? 0);
      });
    void supabase
      .from("vehicle_profiles")
      .select("vehicle_id", { count: "exact", head: true })
      .eq("costumer_id", targetCostumerId)
      .then(({ count }) => {
        if (!cancelled) setVehiclesCount(count ?? 0);
      });
    void supabase
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("costumer_id", targetCostumerId)
      .then(({ count }) => {
        if (!cancelled) setUsersCount(count ?? 0);
      });

    return () => {
      cancelled = true;
    };
  }, [costumer?.costumer_id]);

  /**
   * Saves the edit form. If the 2hire client ID/secret fields were actually
   * typed into (as opposed to left blank, which means "leave unchanged" —
   * see their own comment above), this ALSO calls 2hire-subscribe.mts
   * (scoped to just this one costumer) right after the save succeeds, so
   * setting/rotating a costumer's 2hire credentials here never leaves them
   * saved-but-not-subscribed — see this page's own doc comment for why that
   * matters even though the main creation-time registration flow now lives
   * on CostumerNewPage.tsx. A failed subscribe leaves the typed field
   * values and pendingAction untouched (ConfirmDialog stays open showing
   * the error) so pressing "Opdater kunde" again is an obvious, safe-
   * looking retry — the Supabase update itself already succeeded by then.
   */
  const handleUpdate = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const twoHireFieldsTyped = Boolean(editTwoHireClientId.trim() || editTwoHireClientSecret.trim());

    const { error } = await supabase
      .from("costumers")
      .update({
        name: editName.trim(),
        cvr: normalizeNumberSpacing(editCvr) || null,
        address_street: editStreet.trim() || null,
        address_postal_city: editPostalCity.trim() || null,
        address_country: editCountry.trim() || null,
        contact_person: editContactPerson.trim() || null,
        phone: normalizeNumberSpacing(editPhone) || null,
        email: editEmail.trim() || null,
        // Only written when genuinely typed — a blank field here means
        // "leave whatever's already there alone", not "clear it".
        ...(editTwoHireClientId.trim() ? { twohire_client_id: editTwoHireClientId.trim() } : {}),
        ...(editTwoHireClientSecret.trim() ? { twohire_client_secret: editTwoHireClientSecret.trim() } : {}),
      })
      .eq("costumer_id", costumer.costumer_id);

    if (error) {
      setSubmitError(friendlyCostumerError(error, "Kunne ikke opdatere kunden."));
      setIsSubmitting(false);
      return;
    }

    if (twoHireFieldsTyped) {
      try {
        const response = await fetch("/.netlify/functions/2hire-subscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ costumerId: costumer.costumer_id }),
        });

        const result = (await response.json()) as { error?: string };
        if (!response.ok) {
          setSubmitError(
            result.error ?? "2hire-oplysningerne blev gemt, men registrering hos 2hire mislykkedes. Prøv at gemme igen.",
          );
          setIsSubmitting(false);
          return;
        }
      } catch {
        setSubmitError(
          "2hire-oplysningerne blev gemt, men kunne ikke kontakte serveren for at fuldføre 2hire-registreringen. Prøv at gemme igen.",
        );
        setIsSubmitting(false);
        return;
      }
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/costumers");
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
    navigate("/costumers", { replace: true });
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

  /** KØRETØJER/BRUGERE's own handler — navigates straight to `destination` UNLOCKED (costumerId/costumerName only, no departmentId), matching what those buttons' own count badges already promised: every vehicle/user across the whole costumer, not just one department's worth. VehiclesPage/DepartmentPage both support this unlocked, whole-costumer mode (with their own in-page Afdeling filter) precisely for this button — see their own doc comments. Used to fetch this costumer's departments first and fall back to DepartmentDetailsPage as a picker whenever there wasn't exactly one department; removed 2026-08-28 at the user's request, since landing on a whole different page just to pick one felt like the wrong destination for a button whose badge already showed the full count. */
  const goToVehiclesOrUsers = (destination: "/fleet-table" | "/department") => {
    if (!costumer) return;
    navigate(destination, { state: { costumerId: costumer.costumer_id, costumerName: costumer.name } });
  };

  const handleConfirm = async () => {
    if (pendingAction === "update") {
      await handleUpdate();
    } else if (pendingAction === "delete") {
      await handleDelete();
    } else if (pendingAction === "deactivate") {
      await handleDeactivate();
    } else if (pendingAction === "reactivate") {
      await handleReactivate();
    }
  };

  // While the costumer is still being fetched by id (:costumerId present,
  // no router state yet) — without this guard, the JSX below would try to
  // read costumer.* before it exists.
  if (costumerId && !costumer && costumerLoading) {
    return (
      <div className="flex h-svh items-center justify-center bg-brand-50 text-brand-600">Indlæser kunde…</div>
    );
  }
  // costumerId present but the fetch confirmed it's gone — the redirect
  // effect above is about to navigate away; render nothing in the meantime
  // rather than crash on a null costumer.
  if (!costumer) {
    return null;
  }

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
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

          <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">
              {isEditing ? "Rediger kundedata" : "Kundedata"} - {costumer.name ?? "—"}
            </h2>

            {isEditing ? (
              <>
                {/* shrink-0: without it, a flex item with overflow-hidden gets an automatic min-height of 0 (CSS spec behavior, not a bug) — under vertical space pressure the flex column can squeeze this whole box to zero height, clipping every row invisibly while sibling elements (no overflow-hidden, so a real content-based floor) stay visible. Confirmed live in a real browser session 2026-08-28: DOM had the correct data the whole time, this was purely a layout collapse. */}
                <div className="shrink-0 overflow-hidden rounded-2xl border border-brand-100">
                  <div className="divide-y divide-brand-100 bg-white">
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">CVR.</label>
                      {/* Locked — CVR is the unique Danish company registration number and shouldn't change after the fact (see costumers_cvr_unique.sql). Read-only here, unlike every other field in this form. Matches the editable inputs' own border/padding (just transparent) so its text lines up with theirs instead of sitting flush left. */}
                      <span className="rounded-lg border border-transparent px-2 py-0.5 text-sm text-brand-800">
                        {editCvr || "—"}
                      </span>
                    </div>
                    <RequiredFieldRow label="Navn:" value={editName} onChange={setEditName} />
                    <RequiredFieldRow label="Vej og husnr.:" value={editStreet} onChange={setEditStreet} />
                    <RequiredFieldRow label="Postnr. og by:" value={editPostalCity} onChange={setEditPostalCity} />
                    <RequiredFieldRow label="Land:" value={editCountry} onChange={setEditCountry} />
                    <RequiredFieldRow label="Kontaktperson:" value={editContactPerson} onChange={setEditContactPerson} />
                    <RequiredFieldRow label="Tlf:" value={editPhone} onChange={setEditPhone} type="tel" />
                    <RequiredFieldRow label="E-mail:" value={editEmail} onChange={setEditEmail} type="email" />
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">2hire client ID:</label>
                      {/* Locked once set (same "shown, not editable" treatment as CVR above) — the actual id (client_id isn't secret the way client_secret is, see costumers_expose_twohire_client_id.sql), not a status word, since the value itself already communicates "configured". Only editable while genuinely empty. */}
                      {costumer.twohire_client_id ? (
                        <span className="rounded-lg border border-transparent px-2 py-0.5 text-sm text-brand-800">
                          {costumer.twohire_client_id}
                        </span>
                      ) : (
                        <input
                          type="text"
                          value={editTwoHireClientId}
                          onChange={(e) => setEditTwoHireClientId(e.target.value)}
                          placeholder="Indtast 2hire Client ID her"
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      )}
                    </div>
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">2hire client secret:</label>
                      {/* Never the raw secret — a fixed mask once set, same locked treatment as the ID row above. Only editable while genuinely empty. */}
                      {costumer.has_twohire_client_secret ? (
                        <span className="rounded-lg border border-transparent px-2 py-0.5 text-sm text-brand-800">
                          **********
                        </span>
                      ) : (
                        <input
                          type="password"
                          value={editTwoHireClientSecret}
                          onChange={(e) => setEditTwoHireClientSecret(e.target.value)}
                          placeholder="Indtast 2hire Client Secret her"
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      )}
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
                    className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Opdater kunde
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditName(costumer.name ?? "");
                      setEditCvr(costumer.cvr ?? "");
                      setEditStreet(costumer.address_street ?? "");
                      setEditPostalCity(costumer.address_postal_city ?? "");
                      setEditCountry(costumer.address_country ?? "");
                      setEditContactPerson(costumer.contact_person ?? "");
                      setEditPhone(costumer.phone ?? "");
                      setEditEmail(costumer.email ?? "");
                      setEditTwoHireClientId("");
                      setEditTwoHireClientSecret("");
                      setIsEditing(false);
                    }}
                    className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                  >
                    Fortryd
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* shrink-0: without it, a flex item with overflow-hidden gets an automatic min-height of 0 (CSS spec behavior, not a bug) — under vertical space pressure the flex column can squeeze this whole box to zero height, clipping every row invisibly while sibling elements (no overflow-hidden, so a real content-based floor) stay visible. Confirmed live in a real browser session 2026-08-28: DOM had the correct data the whole time, this was purely a layout collapse. */}
                <div className="shrink-0 overflow-hidden rounded-2xl border border-brand-100">
                  <div className="divide-y divide-brand-100 bg-white">
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">CVR.</label>
                      <span className="text-sm text-brand-800">{costumer.cvr ?? "—"}</span>
                    </div>
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">Vej og husnr.:</label>
                      <span className="text-sm text-brand-800">{costumer.address_street ?? "—"}</span>
                    </div>
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">Postnr. og by:</label>
                      <span className="text-sm text-brand-800">{costumer.address_postal_city ?? "—"}</span>
                    </div>
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">Land:</label>
                      <span className="text-sm text-brand-800">{costumer.address_country ?? "—"}</span>
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
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">2hire:</label>
                      <span className="text-sm text-brand-800">
                        {costumer.has_twohire_credentials ? (
                          <span className="font-semibold text-green-700">Konfigureret</span>
                        ) : (
                          <span className="font-semibold text-amber-700">Ikke konfigureret</span>
                        )}
                      </span>
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
                        className="col-span-2 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                      >
                        Genetabler kundens adgang
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPurgeConfirmText("");
                          setPendingAction("delete");
                        }}
                        className="col-span-2 rounded-lg border-2 border-red-600 bg-white px-2 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
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
                          setEditStreet(costumer.address_street ?? "");
                          setEditPostalCity(costumer.address_postal_city ?? "");
                          setEditCountry(costumer.address_country ?? "");
                          setEditContactPerson(costumer.contact_person ?? "");
                          setEditPhone(costumer.phone ?? "");
                          setEditEmail(costumer.email ?? "");
                          setEditTwoHireClientId("");
                          setEditTwoHireClientSecret("");
                          setIsEditing(true);
                        }}
                        className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                      >
                        Rediger kunde
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingAction("deactivate")}
                        className="rounded-lg border-2 border-red-600 bg-white px-2 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        Bloker kundens adgang
                      </button>
                    </>
                  )}
                </div>

                <hr className="border-brand-200" />

                <div className="grid grid-cols-[repeat(2,max-content)] justify-center gap-3">
                  <div className="relative aspect-square w-28">
                    <button
                      type="button"
                      onClick={() =>
                        navigate("/department-details", {
                          state: { costumerId: costumer.costumer_id, costumerName: costumer.name },
                        })
                      }
                      className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 transition hover:bg-brand-100"
                    >
                      AFDELINGER
                    </button>
                    <CountBadge count={departmentsCount} />
                  </div>
                  <div className="relative aspect-square w-28">
                    <button
                      type="button"
                      onClick={() => goToVehiclesOrUsers("/fleet-table")}
                      className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 transition hover:bg-brand-100"
                    >
                      KØRETØJER
                    </button>
                    <CountBadge count={vehiclesCount} />
                  </div>
                  <div className="relative aspect-square w-28">
                    <button
                      type="button"
                      onClick={() => goToVehiclesOrUsers("/department")}
                      className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 transition hover:bg-brand-100"
                    >
                      BRUGERE
                    </button>
                    <CountBadge count={usersCount} />
                  </div>
                  <div className="relative aspect-square w-28">
                    <button
                      type="button"
                      onClick={() => setShowRapporterInfo((prev) => !prev)}
                      className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 opacity-50 transition hover:bg-brand-100"
                    >
                      RAPPORTER
                    </button>
                    {showRapporterInfo && (
                      <div className="fixed inset-0 z-10" onClick={() => setShowRapporterInfo(false)} />
                    )}
                    <InlinePopup visible={showRapporterInfo} align="right" message="Ikke implementeret endnu" />
                  </div>
                </div>
              </>
            )}
          </section>
        </motion.main>
      </div>

      {pendingAction && (
        <ConfirmDialog
          message={
            pendingAction === "update"
              ? "Er du sikker på, at du vil opdatere denne kunde?"
              : pendingAction === "delete"
                ? (
                    <>
                      <p>
                        Dette sletter PERMANENT al data for "{costumer.name ?? "denne kunde"}" — bookinger,
                        køretøjer, indstillinger og brugerkonti. Kan ikke fortrydes.
                      </p>
                      <p className="mt-2">Skriv kundens navn for at bekræfte:</p>
                      <input
                        type="text"
                        value={purgeConfirmText}
                        onChange={(e) => setPurgeConfirmText(e.target.value)}
                        placeholder={costumer.name ?? ""}
                        className="mt-1.5 w-full rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-1.5 text-sm text-brand-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30"
                      />
                    </>
                  )
                : pendingAction === "deactivate"
                  ? "Er du sikker på, at du vil blokere kundens adgang? Alle brugere under kunden bliver låst ude med det samme."
                  : "Er du sikker på, at du vil genetablere kundens adgang? Alle brugere under kunden får adgang igen."
          }
          error={submitError}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handleConfirm()}
          isPending={isSubmitting}
          confirmDisabled={
            pendingAction === "delete" && (!costumer.name?.trim() || purgeConfirmText.trim() !== costumer.name.trim())
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
