import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { supabase } from "../lib/supabase";
import { friendlyCostumerError } from "../lib/costumerErrors";

/** The freshly-inserted costumer row, as returned by handleCreate's own .select(). Only the fields this page itself needs. */
type NewCostumer = {
  costumer_id: string;
  name: string | null;
  cvr: string | null;
};

/**
 * "/costumer-new" — FLEETii-admin-only (see ProtectedRoute requireRole="FLEETii admin"
 * in App.tsx). Costumer creation is two steps, both handled here, entirely
 * via local component state (deliberately NOT split across a route
 * transition with router-state flags the way an earlier version of this
 * flow worked — that turned out fragile/hard to reason about, and this page
 * existing at all is the fix): first the ordinary company-details form
 * ("step: create"), then — once that row is inserted — a second required
 * step ("step: register") where a FLEETii staffer pastes in the client
 * ID/secret from having ALSO registered the costumer on 2hire's own side.
 * Only once that succeeds (which also subscribes this costumer's 2hire
 * webhook via 2hire-subscribe.mts, closing the gap where nothing used to
 * do that automatically) is the costumer actually usable.
 *
 * If "Fortryd" is chosen during the register step, the just-created row is
 * deleted again (delete-draft-costumer.mts) rather than left behind
 * half-configured. If a FLEETii admin instead navigates away some other way
 * (closes the tab, clicks a different link) mid-registration, the draft
 * costumer survives in the DB and shows up in CostumerAdministrationPage's
 * list with a "Mangler 2hire registrering" badge — reachable and finishable
 * later via the ordinary CostumerDetailsPage edit form (which has its own,
 * much simpler "type the 2hire fields and save" path — see its own doc
 * comment for why it ALSO calls 2hire-subscribe when those fields are
 * touched, so a draft resumed there doesn't silently skip the webhook
 * subscription this page would otherwise have triggered).
 *
 * CostumerDetailsPage.tsx itself no longer has a "no costumerId" create
 * mode — this page replaced that entirely, so CostumerDetailsPage's own job
 * is purely viewing/editing a costumer that already exists.
 *
 * The "create" step's CVR field has a small lookup button (see
 * handleCvrLookup/cvr-lookup.mts) that fills Navn/Vej og husnr./Postnr. og
 * by from cvrapi.dk in one shot — same external-lookup-fills-the-form shape
 * as VehicleCreatePage.tsx's MotorAPI button, just one combined fetch
 * instead of several independently-cached per-field ones, since cvrapi.dk
 * already returns everything needed together. Purely a convenience: every
 * field stays a plain editable input, so a failed/skipped lookup never
 * blocks manual entry.
 */
export function CostumerNewPage() {
  const navigate = useNavigate();
  const { session } = useAuth();

  const [step, setStep] = useState<"create" | "register" | "success">("create");
  const [costumer, setCostumer] = useState<NewCostumer | null>(null);

  const [name, setName] = useState("");
  const [cvr, setCvr] = useState("");
  const [street, setStreet] = useState("");
  const [postalCity, setPostalCity] = useState("");
  // Defaults to "Danmark" rather than empty — almost every costumer is
  // Danish, matching the DB column's own default (see
  // costumers_address_country_default_denmark.sql) — still a plain
  // editable field, just pre-filled.
  const [country, setCountry] = useState("Danmark");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [twoHireClientId, setTwoHireClientId] = useState("");
  const [twoHireClientSecret, setTwoHireClientSecret] = useState("");

  const [pendingAction, setPendingAction] = useState<"create" | "register" | "discardDraft" | "closeCreate" | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** "Slå op i CVR-registret" state (see cvr-lookup.mts / handleCvrLookup below) — same shape as VehicleCreatePage.tsx's MotorAPI lookup (loading/error state, a small circular fetch button), just without a cached result to fill several DIFFERENT fields from one lookup response instead of caching a single result for several independent per-field fill buttons. */
  const [cvrLookupLoading, setCvrLookupLoading] = useState(false);
  const [cvrLookupError, setCvrLookupError] = useState<string | null>(null);

  const canSubmitCreate =
    name.trim().length > 0 &&
    cvr.trim().length > 0 &&
    street.trim().length > 0 &&
    postalCity.trim().length > 0 &&
    country.trim().length > 0 &&
    contactPerson.trim().length > 0 &&
    phone.trim().length > 0 &&
    email.trim().length > 0;
  const canSubmitRegister = twoHireClientId.trim().length > 0 && twoHireClientSecret.trim().length > 0;

  /** Looks up the typed CVR number via cvr-lookup.mts (cvrapi.dk) and fills Navn/Vej og husnr./Postnr. og by from the result — Land is left untouched (already defaults to "Danmark", and cvrapi.dk's own "country=dk" search scope means every result is Danish anyway). A failed lookup just shows the error below the field; nothing already typed gets cleared, so a manual fallback is always still possible. */
  const handleCvrLookup = async () => {
    setCvrLookupLoading(true);
    setCvrLookupError(null);

    try {
      const response = await fetch(`/.netlify/functions/cvr-lookup?cvr=${encodeURIComponent(cvr.trim())}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const result = (await response.json()) as {
        error?: string;
        name?: string;
        address?: string;
        zipcode?: string | number;
        city?: string;
        cityname?: string;
      };

      if (!response.ok || result.error) {
        setCvrLookupError(result.error ?? "Kunne ikke slå CVR-nummeret op.");
        setCvrLookupLoading(false);
        return;
      }

      if (result.name) setName(result.name);
      if (result.address) setStreet(result.address);
      const city = result.city ?? result.cityname;
      if (result.zipcode && city) setPostalCity(`${result.zipcode} ${city}`);
    } catch {
      setCvrLookupError("Kunne ikke kontakte serveren. Prøv igen senere.");
    } finally {
      setCvrLookupLoading(false);
    }
  };

  /** Inserts the new costumer row and advances to the register step — no navigation, this stays on "/costumer-new" the whole time. */
  const handleCreate = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    const { data, error } = await supabase
      .from("costumers")
      .insert({
        name: name.trim(),
        cvr: cvr.trim() || null,
        address_street: street.trim() || null,
        address_postal_city: postalCity.trim() || null,
        address_country: country.trim() || null,
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
      })
      .select("costumer_id, name, cvr")
      .single<NewCostumer>();

    if (error || !data) {
      setSubmitError(friendlyCostumerError(error, "Kunne ikke oprette kunden."));
      setIsSubmitting(false);
      return;
    }

    setCostumer(data);
    setIsSubmitting(false);
    setPendingAction(null);
    setStep("register");
  };

  /** Saves the 2hire client ID/secret onto the just-created costumer, then subscribes its 2hire webhook (2hire-subscribe.mts, scoped to just this one costumer) before showing the "klar til brug" confirmation. A failed subscribe leaves the typed field values and the register step untouched so pressing "Registrer i 2hire" again is an obvious, safe-looking retry — the Supabase update itself already succeeded by that point. */
  const handleRegister = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const { error } = await supabase
      .from("costumers")
      .update({
        twohire_client_id: twoHireClientId.trim(),
        twohire_client_secret: twoHireClientSecret.trim(),
      })
      .eq("costumer_id", costumer.costumer_id);

    if (error) {
      setSubmitError(friendlyCostumerError(error, "Kunne ikke gemme 2hire-oplysningerne."));
      setIsSubmitting(false);
      return;
    }

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
          result.error ?? "2hire-oplysningerne blev gemt, men registrering hos 2hire mislykkedes. Prøv igen.",
        );
        setIsSubmitting(false);
        return;
      }
    } catch {
      setSubmitError(
        "2hire-oplysningerne blev gemt, men kunne ikke kontakte serveren for at fuldføre registreringen. Prøv igen.",
      );
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    setStep("success");
  };

  /** "Fortryd" during the register step — deletes the just-created costumer via delete-draft-costumer.mts (a narrowly-scoped function, NOT delete-costumer.mts: this costumer was created seconds ago and never blocked/typed-confirmed, so none of that function's preconditions make sense here — see its own header comment). */
  const handleDiscardDraft = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/.netlify/functions/delete-draft-costumer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ costumerId: costumer.costumer_id }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSubmitError(result.error ?? "Kunne ikke fortryde oprettelsen.");
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
    navigate("/fleetii-admin", { replace: true });
  };

  const handleConfirm = async () => {
    if (pendingAction === "closeCreate") {
      navigate("/fleetii-admin");
      return;
    }
    if (pendingAction === "register") {
      await handleRegister();
      return;
    }
    if (pendingAction === "discardDraft") {
      await handleDiscardDraft();
      return;
    }
    await handleCreate();
  };

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
              {step === "success" ? "Kunde registreret" : step === "register" ? "Registrer kunde i 2hire" : "Opret kunde"}
            </h2>

            {step === "success" ? (
              <>
                <p className="text-sm text-brand-800">Den nye kunde er nu registreret i 2hire, og klar til brug.</p>
                <button
                  type="button"
                  onClick={() => navigate("/fleetii-admin")}
                  className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Til kundeliste
                </button>
              </>
            ) : step === "register" ? (
              <>
                <div className="overflow-hidden rounded-2xl border border-brand-100">
                  <div className="divide-y divide-brand-100 bg-white">
                    {/* Matches the 2hire inputs' own border/padding (just transparent) below so this static text lines up with theirs instead of sitting flush left. */}
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">CVR.</label>
                      <span className="rounded-lg border border-transparent px-2 py-0.5 text-sm text-brand-800">
                        {costumer?.cvr ?? "—"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">Navn:</label>
                      <span className="rounded-lg border border-transparent px-2 py-0.5 text-sm text-brand-800">
                        {costumer?.name ?? "—"}
                      </span>
                    </div>
                    <RequiredFieldRow label="2hire client ID:" value={twoHireClientId} onChange={setTwoHireClientId} />
                    <RequiredFieldRow
                      label="2hire client secret:"
                      value={twoHireClientSecret}
                      onChange={setTwoHireClientSecret}
                      type="password"
                    />
                  </div>
                </div>

                <p className="text-right text-xs text-brand-500">
                  <span className="text-red-600">*</span> Feltet skal udfyldes
                </p>

                {submitError && <p className="text-sm text-red-600">{submitError}</p>}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPendingAction("register")}
                    disabled={!canSubmitRegister}
                    className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Registrer i 2hire
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingAction("discardDraft")}
                    className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
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
                      <label className="flex items-center text-sm font-medium text-brand-700">
                        CVR: <span className="ml-0.5 text-red-600">*</span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          required
                          aria-required="true"
                          value={cvr}
                          onChange={(e) => setCvr(e.target.value)}
                          className="min-w-0 flex-1 rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCvrLookup()}
                          disabled={cvrLookupLoading || !/^\d{8}$/.test(cvr.trim())}
                          title="Slå op i CVR-registret"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand-300 text-brand-600 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          {cvrLookupLoading ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3 w-3 animate-spin">
                              <path d="M21 12a9 9 0 1 1-9-9" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                              <circle cx="11" cy="11" r="7" />
                              <path d="m21 21-4.3-4.3" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                    {cvrLookupError && <p className="px-0.5 pb-1 text-xs text-red-600">{cvrLookupError}</p>}
                    <RequiredFieldRow label="Navn:" value={name} onChange={setName} />
                    <RequiredFieldRow label="Vej og husnr.:" value={street} onChange={setStreet} />
                    <RequiredFieldRow label="Postnr. og by:" value={postalCity} onChange={setPostalCity} />
                    <RequiredFieldRow label="Land:" value={country} onChange={setCountry} />
                    <RequiredFieldRow label="Kontaktperson:" value={contactPerson} onChange={setContactPerson} />
                    <RequiredFieldRow label="Tlf:" value={phone} onChange={setPhone} type="tel" />
                    <RequiredFieldRow label="E-mail:" value={email} onChange={setEmail} type="email" />
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
                    disabled={!canSubmitCreate}
                    className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Opret kunde
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingAction("closeCreate")}
                    className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
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
              : pendingAction === "register"
                ? "Er du sikker på, at kunden er oprettet i 2hire, og de indtastede oplysninger er korrekte?"
                : pendingAction === "discardDraft"
                  ? `Er du sikker på, at du vil fortryde? Kunden "${costumer?.name ?? ""}" er endnu ikke færdigregistreret i 2hire og bliver slettet permanent.`
                  : "Er du sikker på, at du vil lukke uden at gemme?"
          }
          error={submitError}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handleConfirm()}
          isPending={isSubmitting}
          confirmPendingLabel={
            pendingAction === "discardDraft" ? "Sletter…" : pendingAction === "register" ? "Registrerer…" : "Vent…"
          }
        />
      )}
    </div>
  );
}
