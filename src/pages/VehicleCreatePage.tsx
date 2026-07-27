import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";

/** A pending "send-vehicle-request" submission — mirrors FleetiiAdministrationPage.tsx's own CostumerOrder shape. Normally arrives pre-filled via router state (its table row click), but also fetchable by id alone (see the fetch-by-id effect below) so "/vehicle-create/:orderId" works as a direct link. */
type CostumerOrder = {
  order_id: string;
  costumer_id: string;
  department_id: string | null;
  number_plate: string;
  brand: string;
  model: string;
  model_year: string;
  needs_fleetii_device: boolean;
  fleetii_device_id: string | null;
  contactperson: string;
  contactnumber: string;
  vehicle_registered: boolean;
  iot_device_associated: boolean;
  other_2hire_done: boolean;
  costumerName: string | null;
  departmentName: string | null;
};

/** Raw shape of the fetch-by-id query below, before flattening the embedded costumers(name)/departments(name) relations — mirrors FleetiiAdministrationPage.tsx's own CostumerOrderQueryRow. */
type CostumerOrderQueryRow = {
  order_id: string;
  costumer_id: string;
  department_id: string | null;
  number_plate: string;
  brand: string;
  model: string;
  model_year: string;
  needs_fleetii_device: boolean;
  fleetii_device_id: string | null;
  contactperson: string;
  contactnumber: string;
  vehicle_registered: boolean;
  iot_device_associated: boolean;
  other_2hire_done: boolean;
  costumers: { name: string | null } | null;
  departments: { name: string | null } | null;
};

/** One of the three provisioning steps below — the costumer_orders column each writes to (see costumer_orders_add_step_flags.sql). */
type StepColumn = "vehicle_registered" | "iot_device_associated" | "other_2hire_done";

/**
 * "Opret køretøj" page — admin-only (see ProtectedRoute requireAdmin in
 * App.tsx; costumer_orders' own SELECT RLS further scopes a plain admin to
 * their own costumer's orders, same as everywhere else "admin OR FLEETii
 * admin" appears in this project). Reachable at plain "/vehicle-create"
 * (order passed via router state — FleetiiAdministrationPage's
 * "Administration af installationer" table row click) or
 * "/vehicle-create/:orderId" (fetches the order by id — a direct URL/
 * refresh/bookmark with no router state, mirroring UserDetailsPage.tsx's
 * own fetch-by-id fallback). Missing both state and a resolvable :orderId
 * redirects back to "/fleetii-admin". Shows everything the admin submitted
 * via NewVehiclePage.tsx's "Ny bestilling" so FLEETii staff can see what
 * needs provisioning, plus three step buttons — none are wired up to real
 * automation yet (2hire/FLEETii integration), so clicking one both shows
 * "Endnu ikke implementeret" AND records the step as done (persisted on
 * costumer_orders so it survives leaving and reopening this order), letting
 * FLEETii staff use this page as a manual checklist in the meantime. A done
 * step stays clickable (not HTML-disabled, since disabled buttons don't fire
 * onClick) but turns green and re-clicking it asks — via ConfirmDialog —
 * whether to reactivate (reset) it instead of re-showing the popup.
 * "Installation afsluttet - slettes" is a separate one-off action, gated on
 * all three steps being done (real disabled attribute — there's no
 * "reactivate" concept for it).
 */
export function VehicleCreatePage() {
  const { profile } = useAuth();
  /** The three step buttons and "Installation afsluttet - slettes" actually write to costumer_orders (see costumer_orders_add_step_flags.sql's UPDATE policy, scoped to is_fleetii_admin() only) — now that this route is admin-only rather than FLEETii-admin-only, a plain admin can view an order here but can't record its steps, so those buttons render disabled for them instead of silently no-oping via RLS. */
  const canManageSteps = profile?.role === "FLEETii admin";
  const navigate = useNavigate();
  const location = useLocation();
  const { orderId } = useParams<{ orderId: string }>();
  const stateOrder = (location.state as { order?: CostumerOrder } | null)?.order ?? null;
  const [fetchedOrder, setFetchedOrder] = useState<CostumerOrder | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const order = stateOrder ?? fetchedOrder;

  /** Fetch-by-id fallback for a direct URL/refresh/bookmark to "/vehicle-create/:orderId" (no router state) — skipped entirely when stateOrder is already present. Naturally scoped to the admin's own costumer (or any, for a FLEETii admin) by costumer_orders' SELECT RLS policy — an orderId outside it just resolves to null, same as "not found". */
  useEffect(() => {
    if (stateOrder || !orderId) return;

    let cancelled = false;
    setOrderLoading(true);
    void supabase
      .from("costumer_orders")
      .select(
        "order_id, costumer_id, department_id, number_plate, brand, model, model_year, needs_fleetii_device, fleetii_device_id, contactperson, contactnumber, vehicle_registered, iot_device_associated, other_2hire_done, costumers(name), departments(name)",
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
                number_plate: data.number_plate,
                brand: data.brand,
                model: data.model,
                model_year: data.model_year,
                needs_fleetii_device: data.needs_fleetii_device,
                fleetii_device_id: data.fleetii_device_id,
                contactperson: data.contactperson,
                contactnumber: data.contactnumber,
                vehicle_registered: data.vehicle_registered,
                iot_device_associated: data.iot_device_associated,
                other_2hire_done: data.other_2hire_done,
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
  // or outside the admin's own costumer per RLS) once the fetch has finished.
  useEffect(() => {
    if (!order && !orderLoading) {
      navigate("/fleetii-admin", { replace: true });
    }
  }, [order, orderLoading, navigate]);

  /** Which (if any) of the below action buttons' "Endnu ikke implementeret" popup is showing. */
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();
  const [vehicleRegistered, setVehicleRegistered] = useState(order?.vehicle_registered ?? false);
  const [iotDeviceAssociated, setIotDeviceAssociated] = useState(order?.iot_device_associated ?? false);
  const [other2hireDone, setOther2hireDone] = useState(order?.other_2hire_done ?? false);
  const [stepError, setStepError] = useState<string | null>(null);

  // Populates the three step flags once `order` resolves asynchronously (the
  // fetch-by-id path above) — the useState initializers just above only run
  // on the very first render, which happens before that fetch can possibly
  // have completed. Harmless no-op re-set on the (more common) router-state
  // path, where `order` is already correct on the first render.
  useEffect(() => {
    if (!order) return;
    setVehicleRegistered(order.vehicle_registered);
    setIotDeviceAssociated(order.iot_device_associated);
    setOther2hireDone(order.other_2hire_done);
  }, [order]);

  /** Which (if any) already-done step is pending a "skal denne handling genaktiveres?" confirmation — set by clicking a done step's button instead of running its normal done-flow. */
  const [pendingReactivateStep, setPendingReactivateStep] = useState<StepColumn | null>(null);
  const [reactivatePending, setReactivatePending] = useState(false);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

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

  /** Records a step as done (costumer_orders' matching boolean column) — called alongside triggerNotImplemented, since none of the three steps have real automation behind them yet. */
  const markStepDone = async (column: StepColumn, setDone: (done: boolean) => void) => {
    setStepError(null);
    const { error } = await supabase
      .from("costumer_orders")
      .update({ [column]: true })
      .eq("order_id", order.order_id);

    if (error) {
      setStepError(error.message);
      return;
    }
    setDone(true);
  };

  /** Each step's local-state setter, keyed by its column — used by reactivateStep below to flip the right one back to false once the ConfirmDialog is confirmed. */
  const stepSetters: Record<StepColumn, (done: boolean) => void> = {
    vehicle_registered: setVehicleRegistered,
    iot_device_associated: setIotDeviceAssociated,
    other_2hire_done: setOther2hireDone,
  };

  /** Resets a done step back to not-done (costumer_orders' matching column back to false) — the "Ja" action of the reactivate ConfirmDialog. */
  const reactivateStep = async (column: StepColumn) => {
    setReactivatePending(true);
    setReactivateError(null);
    const { error } = await supabase
      .from("costumer_orders")
      .update({ [column]: false })
      .eq("order_id", order.order_id);
    setReactivatePending(false);

    if (error) {
      setReactivateError(error.message);
      return;
    }
    stepSetters[column](false);
    setPendingReactivateStep(null);
  };

  const rows: [string, string][] = [
    ["Kunde:", order.costumerName ?? "—"],
    ["Afdeling:", order.departmentName ?? "—"],
    ["Nummerplade:", order.number_plate],
    ["Brand:", order.brand],
    ["Mærke:", order.model],
    ["Årgang:", order.model_year],
    [
      "FLEETii device:",
      order.needs_fleetii_device ? "Nyt device skal installeres" : `Eksisterende device (id: ${order.fleetii_device_id})`,
    ],
    ["Kontaktperson:", order.contactperson],
    ["Kontaktnummer:", order.contactnumber],
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

            {stepError && <p className="text-sm text-red-600">{stepError}</p>}

            <div className="flex flex-col gap-3">
              <div className="relative">
                <button
                  type="button"
                  disabled={!canManageSteps}
                  onClick={() => {
                    if (vehicleRegistered) {
                      setPendingReactivateStep("vehicle_registered");
                      return;
                    }
                    triggerNotImplemented("register-vehicle");
                    void markStepDone("vehicle_registered", setVehicleRegistered);
                  }}
                  className={`w-full rounded-lg px-2 py-1.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    vehicleRegistered ? "bg-green-600 hover:bg-green-700" : "bg-brand-600 hover:bg-brand-700"
                  }`}
                >
                  {vehicleRegistered ? "✓ " : ""}2hire register vehicle (and in FLEETii)
                </button>
                <InlinePopup visible={notImplementedKey === "register-vehicle"} message="Endnu ikke implementeret" />
              </div>
              <div className="relative">
                <button
                  type="button"
                  disabled={!canManageSteps}
                  onClick={() => {
                    if (iotDeviceAssociated) {
                      setPendingReactivateStep("iot_device_associated");
                      return;
                    }
                    triggerNotImplemented("associate-iot");
                    void markStepDone("iot_device_associated", setIotDeviceAssociated);
                  }}
                  className={`w-full rounded-lg px-2 py-1.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    iotDeviceAssociated ? "bg-green-600 hover:bg-green-700" : "bg-brand-600 hover:bg-brand-700"
                  }`}
                >
                  {iotDeviceAssociated ? "✓ " : ""}2hire associate IoT device (and in FLEETii)
                </button>
                <InlinePopup visible={notImplementedKey === "associate-iot"} message="Endnu ikke implementeret" />
              </div>
              <div className="relative">
                <button
                  type="button"
                  disabled={!canManageSteps}
                  onClick={() => {
                    if (other2hireDone) {
                      setPendingReactivateStep("other_2hire_done");
                      return;
                    }
                    triggerNotImplemented("other-2hire");
                    void markStepDone("other_2hire_done", setOther2hireDone);
                  }}
                  className={`w-full rounded-lg px-2 py-1.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    other2hireDone ? "bg-green-600 hover:bg-green-700" : "bg-brand-600 hover:bg-brand-700"
                  }`}
                >
                  {other2hireDone ? "✓ " : ""}Other 2hire registrations
                </button>
                <InlinePopup visible={notImplementedKey === "other-2hire"} message="Endnu ikke implementeret" />
              </div>
              <div className="relative">
                <button
                  type="button"
                  disabled={!canManageSteps || !(vehicleRegistered && iotDeviceAssociated && other2hireDone)}
                  onClick={() => triggerNotImplemented("delete-order")}
                  className="w-full rounded-lg bg-red-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Installation afsluttet - slettes
                </button>
                <InlinePopup visible={notImplementedKey === "delete-order"} message="Endnu ikke implementeret" variant="warning" />
              </div>
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
                onConfirm={() => void reactivateStep(pendingReactivateStep)}
              />
            )}
          </section>
        </motion.main>
      </div>
    </div>
  );
}
