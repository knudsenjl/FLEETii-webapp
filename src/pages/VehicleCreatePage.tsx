import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useRefreshVehicles } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { QrScanButton } from "../components/QrScanButton";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";

/** A pending "send-vehicle-request" submission — mirrors FleetiiAdministrationPage.tsx's own CostumerOrder shape. Normally arrives pre-filled via router state (its table row click), but also fetchable by id alone (see the fetch-by-id effect below) so "/vehicle-create/:orderId" works as a direct link. */
type CostumerOrder = {
  order_id: string;
  costumer_id: string;
  department_id: string | null;
  /** Company-wide "Køretøj-ID" identifier — optional, see costumer_orders_add_vehicle_ident.sql. Null/empty falls back to number_plate wherever this is displayed (same convention as VehicleDetailsPage.tsx/HandleVehiclePage.tsx). */
  vehicle_ident: string | null;
  number_plate: string;
  brand: string;
  model: string;
  model_year: string;
  needs_fleetii_device: boolean;
  fleetii_device_id: string | null;
  contactperson: string;
  contactemail: string | null;
  contactnumber: string;
  vehicle_registered: boolean;
  iot_device_associated: boolean;
  other_2hire_done: boolean;
  /** The real 2hire vehicleId once registered (see 2hire-register-vehicle.mts) — null until vehicle_registered is true. */
  vehicle_id: string | null;
  costumerName: string | null;
  departmentName: string | null;
};

/** Raw shape of the fetch-by-id query below, before flattening the embedded costumers(name)/departments(name) relations — mirrors FleetiiAdministrationPage.tsx's own CostumerOrderQueryRow. */
type CostumerOrderQueryRow = {
  order_id: string;
  costumer_id: string;
  department_id: string | null;
  vehicle_ident: string | null;
  number_plate: string;
  brand: string;
  model: string;
  model_year: string;
  needs_fleetii_device: boolean;
  fleetii_device_id: string | null;
  contactperson: string;
  contactemail: string | null;
  contactnumber: string;
  vehicle_registered: boolean;
  iot_device_associated: boolean;
  other_2hire_done: boolean;
  vehicle_id: string | null;
  costumers: { name: string | null } | null;
  departments: { name: string | null } | null;
};

/** One of 2hire's own vehicle-configuration profiles (see 2hire-board-profiles.mts) — confirmed real shape { id, title, description, makerName, modelName, modelYearRange } (developer.2hire.io/reference/getpublicprofilelist-1's own example response, see twoHireClient.ts's own TwoHireBoardProfile comment); still loosely typed since only id/title are actually used here. */
type TwoHireBoardProfile = Record<string, unknown>;

/** id extraction for a profile — "id" is the confirmed real field; "profileId" kept as a defensive fallback. Falls back to an empty string (which the picker then can't submit, rather than silently using a wrong value) if neither is present. */
function boardProfileId(profile: TwoHireBoardProfile): string {
  const raw = profile.id ?? profile.profileId;
  return typeof raw === "string" ? raw : "";
}

/** Human-readable label for a profile — "title" is the confirmed real field (e.g. "Fiat 500 2019-2020"); "name"/"profileName" kept as defensive fallbacks, then the id, then the raw JSON as a last resort so the picker never shows a blank option. */
function boardProfileLabel(profile: TwoHireBoardProfile): string {
  const raw = profile.title ?? profile.name ?? profile.profileName;
  if (typeof raw === "string" && raw.length > 0) return raw;
  const id = boardProfileId(profile);
  return id || JSON.stringify(profile);
}

/** The one remaining manual-checklist step ("Other 2hire registrations") — see costumer_orders_add_step_flags.sql. "vehicle_registered"/"iot_device_associated" used to be separate manual steps here too, but are now set together by the real 2hire-register-vehicle.mts call below, so they're no longer reactivatable via this generic flip-back-to-false mechanism. */
type ReactivatableStep = "other_2hire_done";

/**
 * "Opret køretøj" page — FLEETii-admin only (see ProtectedRoute
 * requireRole="FLEETii admin" in App.tsx — there's no reason for a
 * customer's own admin to see this, mirroring VehicleDeletePage.tsx's own
 * gating). Reachable at plain "/vehicle-create" (order passed via router
 * state — FleetiiAdministrationPage's "Administration af installationer"
 * table row click) or "/vehicle-create/:orderId" (fetches the order by id —
 * a direct URL/refresh/bookmark with no router state, mirroring
 * UserDetailsPage.tsx's own fetch-by-id fallback). Missing both state and a
 * resolvable :orderId redirects back to "/fleetii-admin". Shows everything
 * the admin submitted via NewVehiclePage.tsx's "Ny bestilling" so FLEETii
 * staff can see what needs provisioning, plus:
 *   - "Registrér køretøj i 2hire": the real action — takes the physical
 *     2hire-board device's printed QR code + a chosen 2hire profile,
 *     registers it with 2hire (2hire-register-vehicle.mts), and inserts the
 *     resulting vehicle into vehicle_profiles/vehicle_departments. This
 *     covers what used to be two separate manual-only steps ("register
 *     vehicle" and "associate IoT device") — 2hire's actual API has no
 *     separate endpoint for the second, a device's QR code IS what's being
 *     associated when it's registered. Once done, this can't be
 *     "reactivated" from here — undoing a real 2hire registration would
 *     need a real deregisterVehicle call, a different, weightier action.
 *   - "Other 2hire registrations": still a manual-only checklist flag (no
 *     known automatable action) — clicking it just records the step as
 *     done; re-clicking a done step asks, via ConfirmDialog, whether to
 *     reactivate (reset) it.
 *   - "Installation afsluttet - slettes": real once all three are done —
 *     deletes this order's costumer_orders row (its job is finished; the
 *     vehicle itself lives on in vehicle_profiles) and returns to
 *     "/fleetii-admin".
 */
export function VehicleCreatePage() {
  const { session } = useAuth();
  const refreshVehicles = useRefreshVehicles();
  const navigate = useNavigate();
  const location = useLocation();
  const { orderId } = useParams<{ orderId: string }>();
  const stateOrder = (location.state as { order?: CostumerOrder } | null)?.order ?? null;
  const [fetchedOrder, setFetchedOrder] = useState<CostumerOrder | null>(null);
  // Lazy-initialized true whenever a fetch-by-id is actually going to happen
  // (orderId present, no stateOrder yet) — starting this false and only
  // flipping it inside the fetch effect below raced the redirect effect
  // further down: both effects run in the same post-mount pass, so the
  // redirect effect would still see the ORIGINAL (false) value and fire
  // immediately, bouncing straight back to "/fleetii-admin" before the fetch
  // ever got a chance to resolve.
  const [orderLoading, setOrderLoading] = useState(() => Boolean(orderId) && !stateOrder);
  const order = stateOrder ?? fetchedOrder;
  /** Whether this order's own department shows the "Køretøj-ID:" row below at all — see useIdentSettings' own doc comment. */
  const { useVehicleIdent } = useIdentSettings(order?.department_id ?? null);

  /** Fetch-by-id fallback for a direct URL/refresh/bookmark to "/vehicle-create/:orderId" (no router state) — skipped entirely when stateOrder is already present. Naturally scoped to a FLEETii admin (any costumer) by costumer_orders' SELECT RLS policy — an orderId outside it just resolves to null, same as "not found". */
  useEffect(() => {
    if (stateOrder || !orderId) return;

    let cancelled = false;
    setOrderLoading(true);
    void supabase
      .from("costumer_orders")
      .select(
        "order_id, costumer_id, department_id, vehicle_ident, number_plate, brand, model, model_year, needs_fleetii_device, fleetii_device_id, contactperson, contactemail, contactnumber, vehicle_registered, iot_device_associated, other_2hire_done, vehicle_id, costumers(name), departments(name)",
      )
      .eq("order_id", orderId)
      .maybeSingle<CostumerOrderQueryRow>()
      .then(({ data }) => {
        if (cancelled) return;
        setFetchedOrder(
          data
            ? {
                order_id: data.order_id,
                costumer_id: data.costumer_id,
                department_id: data.department_id,
                vehicle_ident: data.vehicle_ident,
                number_plate: data.number_plate,
                brand: data.brand,
                model: data.model,
                model_year: data.model_year,
                needs_fleetii_device: data.needs_fleetii_device,
                fleetii_device_id: data.fleetii_device_id,
                contactperson: data.contactperson,
                contactemail: data.contactemail,
                contactnumber: data.contactnumber,
                vehicle_registered: data.vehicle_registered,
                iot_device_associated: data.iot_device_associated,
                other_2hire_done: data.other_2hire_done,
                vehicle_id: data.vehicle_id,
                costumerName: data.costumers?.name ?? null,
                departmentName: data.departments?.name ?? null,
              }
            : null,
        );
        setOrderLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId, stateOrder]);

  // Redirects back to the installations list once it's clear the order can't
  // be resolved: either no :orderId AND no router state at all (reached with
  // nothing to show), or a specific :orderId that came back empty (deleted,
  // or outside RLS) once the fetch has finished.
  useEffect(() => {
    if (!order && !orderLoading) {
      navigate("/fleetii-admin", { replace: true });
    }
  }, [order, orderLoading, navigate]);

  const [vehicleRegistered, setVehicleRegistered] = useState(order?.vehicle_registered ?? false);
  const [iotDeviceAssociated, setIotDeviceAssociated] = useState(order?.iot_device_associated ?? false);
  const [other2hireDone, setOther2hireDone] = useState(order?.other_2hire_done ?? false);
  const [registeredVehicleId, setRegisteredVehicleId] = useState(order?.vehicle_id ?? null);

  // Populates the step flags/vehicleId once `order` resolves asynchronously
  // (the fetch-by-id path above) — the useState initializers just above only
  // run on the very first render, which happens before that fetch can
  // possibly have completed. Harmless no-op re-set on the (more common)
  // router-state path, where `order` is already correct on the first render.
  useEffect(() => {
    if (!order) return;
    setVehicleRegistered(order.vehicle_registered);
    setIotDeviceAssociated(order.iot_device_associated);
    setOther2hireDone(order.other_2hire_done);
    setRegisteredVehicleId(order.vehicle_id);
  }, [order]);

  /** "Registrér køretøj i 2hire" form state — only relevant while !vehicleRegistered. */
  const [qrCode, setQrCode] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profiles, setProfiles] = useState<TwoHireBoardProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  /** Loads 2hire's own board profiles for the picker above — skipped once the vehicle is already registered (no longer needed). */
  useEffect(() => {
    if (order?.vehicle_registered) return;

    let cancelled = false;
    setProfilesLoading(true);
    setProfilesError(null);
    void fetch("/.netlify/functions/2hire-board-profiles", {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    })
      .then(async (response) => {
        const result = (await response.json()) as { profiles?: TwoHireBoardProfile[]; error?: string };
        if (cancelled) return;
        if (!response.ok) {
          setProfilesError(result.error ?? "Kunne ikke hente 2hire-profiler.");
          setProfilesLoading(false);
          return;
        }
        setProfiles(result.profiles ?? []);
        setProfilesLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setProfilesError("Kunne ikke kontakte serveren. Prøv igen senere.");
        setProfilesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session, order?.vehicle_registered]);

  /** "Which (if any) already-done step is pending a "skal denne handling genaktiveres?" confirmation — only "other_2hire_done" can go through this anymore (see ReactivatableStep's own doc comment). */
  const [pendingReactivateStep, setPendingReactivateStep] = useState<ReactivatableStep | null>(null);
  const [reactivatePending, setReactivatePending] = useState(false);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  const [showDeleteOrderConfirm, setShowDeleteOrderConfirm] = useState(false);
  const [isDeletingOrder, setIsDeletingOrder] = useState(false);
  const [deleteOrderError, setDeleteOrderError] = useState<string | null>(null);

  /** Which (if any) of "Other 2hire registrations"' own "Endnu ikke implementeret" popup is showing — the one step left with no real automation. */
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();
  const [otherStepError, setOtherStepError] = useState<string | null>(null);

  // Only while a SPECIFIC order is being fetched by id (:orderId present, no
  // router state yet) — without this guard, the page would flash-redirect
  // toward "/fleetii-admin" for a moment before the fetch resolves.
  if (orderId && !order && orderLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-brand-50 text-brand-600">Indlæser bestilling…</div>
    );
  }

  if (!order) {
    return null;
  }

  /** The real fulfillment action — registers the physical device with 2hire and inserts the resulting vehicle into our own DB (see 2hire-register-vehicle.mts's own doc comment for the full sequence). */
  const handleRegisterVehicle = async () => {
    setIsRegistering(true);
    setRegisterError(null);

    try {
      const response = await fetch("/.netlify/functions/2hire-register-vehicle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ orderId: order.order_id, qrCode: qrCode.trim(), profileId: selectedProfileId }),
      });

      const result = (await response.json()) as { ok?: boolean; vehicleId?: string; error?: string };

      if (!response.ok) {
        setRegisterError(result.error ?? "Kunne ikke registrere køretøjet.");
        setIsRegistering(false);
        return;
      }

      setVehicleRegistered(true);
      setIotDeviceAssociated(true);
      setRegisteredVehicleId(result.vehicleId ?? null);
      await refreshVehicles();
    } catch {
      setRegisterError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsRegistering(false);
      return;
    }

    setIsRegistering(false);
  };

  /** Records "Other 2hire registrations" as done — still a manual checklist flag, no real automation exists for it. */
  const markOtherStepDone = async () => {
    setOtherStepError(null);
    triggerNotImplemented("other-2hire");
    const { error } = await supabase
      .from("costumer_orders")
      .update({ other_2hire_done: true })
      .eq("order_id", order.order_id);

    if (error) {
      setOtherStepError(error.message);
      return;
    }
    setOther2hireDone(true);
  };

  /** Resets "Other 2hire registrations" back to not-done — the "Ja" action of the reactivate ConfirmDialog. */
  const reactivateOtherStep = async () => {
    setReactivatePending(true);
    setReactivateError(null);
    const { error } = await supabase
      .from("costumer_orders")
      .update({ other_2hire_done: false })
      .eq("order_id", order.order_id);
    setReactivatePending(false);

    if (error) {
      setReactivateError(error.message);
      return;
    }
    setOther2hireDone(false);
    setPendingReactivateStep(null);
  };

  /** "Installation afsluttet - slettes": deletes this order's costumer_orders row now that it's fully provisioned — the vehicle itself lives on in vehicle_profiles, only the tracking order goes away. */
  const handleDeleteOrder = async () => {
    setIsDeletingOrder(true);
    setDeleteOrderError(null);

    const { error } = await supabase.from("costumer_orders").delete().eq("order_id", order.order_id);

    if (error) {
      setDeleteOrderError(error.message);
      setIsDeletingOrder(false);
      return;
    }

    navigate("/fleetii-admin", { replace: true });
  };

  const rows: [string, string][] = [
    ["Kunde:", order.costumerName ?? "—"],
    ["Afdeling:", order.departmentName ?? "—"],
    ...(useVehicleIdent ? ([["Køretøj-ID:", order.vehicle_ident || order.number_plate]] as [string, string][]) : []),
    ["Nummerplade:", order.number_plate],
    ["Brand:", order.brand],
    ["Mærke:", order.model],
    ["Årgang:", order.model_year],
    [
      "FLEETii device:",
      order.needs_fleetii_device ? "Nyt device skal installeres" : `Eksisterende device (id: ${order.fleetii_device_id})`,
    ],
    ["Kontaktperson:", order.contactperson],
    ["Kontakt e-mail:", order.contactemail ?? "—"],
    ["Kontakt tlf.:", order.contactnumber],
    ...(registeredVehicleId ? ([["2hire vehicle-id:", registeredVehicleId]] as [string, string][]) : []),
  ];

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

          <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">Opret køretøj</h2>

            <div className="rounded-2xl border border-brand-100">
              <div className="divide-y divide-brand-100 rounded-2xl bg-white">
                {rows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">{label}</label>
                    <span className="text-sm text-brand-800">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {vehicleRegistered ? (
                <span className="flex w-full items-center justify-center rounded-lg bg-green-600 px-2 py-1.5 text-center text-sm font-semibold text-white">
                  ✓ Køretøj registreret i 2hire
                </span>
              ) : (
                <div className="flex flex-col gap-2 rounded-2xl border border-brand-100 bg-brand-50/40 p-3">
                  <div className="flex flex-col gap-0.5">
                    <div className="grid grid-cols-2 items-center gap-2">
                      <span className="flex items-center justify-between gap-2">
                        <label className="text-sm font-medium text-brand-700">QR-kode:</label>
                        <QrScanButton onScan={setQrCode} />
                      </span>
                      <input
                        type="text"
                        value={qrCode}
                        onChange={(e) => setQrCode(e.target.value)}
                        placeholder="fra det fysiske 2hire-device"
                        className="rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-2">
                      <label className="text-sm font-medium text-brand-700">2hire-profil:</label>
                      {profilesLoading ? (
                        <span className="text-sm text-brand-500">Indlæser…</span>
                      ) : profilesError ? (
                        <span className="text-sm text-red-600">{profilesError}</span>
                      ) : (
                        <select
                          value={selectedProfileId}
                          onChange={(e) => setSelectedProfileId(e.target.value)}
                          className="rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        >
                          <option value="">Vælg profil…</option>
                          {profiles.map((profile) => (
                            <option key={boardProfileId(profile)} value={boardProfileId(profile)}>
                              {boardProfileLabel(profile)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                  {registerError && <p className="text-sm text-red-600">{registerError}</p>}
                  <button
                    type="button"
                    disabled={!qrCode.trim() || !selectedProfileId || isRegistering}
                    onClick={() => void handleRegisterVehicle()}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRegistering ? "Registrerer…" : "Registrér køretøj i 2hire"}
                  </button>
                </div>
              )}

              {otherStepError && <p className="text-sm text-red-600">{otherStepError}</p>}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (other2hireDone) {
                      setPendingReactivateStep("other_2hire_done");
                      return;
                    }
                    void markOtherStepDone();
                  }}
                  className={`w-full rounded-lg px-2 py-1.5 text-sm font-semibold text-white transition ${
                    other2hireDone ? "bg-green-600 hover:bg-green-700" : "bg-brand-600 hover:bg-brand-700"
                  }`}
                >
                  {other2hireDone ? "✓ " : ""}Other 2hire registrations
                </button>
                <InlinePopup visible={notImplementedKey === "other-2hire"} message="Endnu ikke implementeret" />
              </div>

              {deleteOrderError && <p className="text-sm text-red-600">{deleteOrderError}</p>}
              <button
                type="button"
                disabled={!(vehicleRegistered && iotDeviceAssociated && other2hireDone) || isDeletingOrder}
                onClick={() => setShowDeleteOrderConfirm(true)}
                className="w-full rounded-lg bg-red-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeletingOrder ? "Sletter…" : "Installation afsluttet - slettes"}
              </button>
            </div>

            {pendingReactivateStep && (
              <ConfirmDialog
                message="Skal denne handling genaktiveres?"
                error={reactivateError}
                isPending={reactivatePending}
                confirmPendingLabel="Genaktiverer…"
                onCancel={() => {
                  setPendingReactivateStep(null);
                  setReactivateError(null);
                }}
                onConfirm={() => void reactivateOtherStep()}
              />
            )}

            {showDeleteOrderConfirm && (
              <ConfirmDialog
                message="Er du sikker på, at bestillingen er fuldt håndteret og kan slettes? Køretøjet selv forbliver oprettet."
                error={deleteOrderError}
                isPending={isDeletingOrder}
                confirmPendingLabel="Sletter…"
                onCancel={() => {
                  setShowDeleteOrderConfirm(false);
                  setDeleteOrderError(null);
                }}
                onConfirm={() => void handleDeleteOrder()}
              />
            )}
          </section>
        </motion.main>
      </div>
    </div>
  );
}
