import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { supabase } from "../lib/supabase";
import { formatVehicleIdentLabel } from "../lib/bookings";

/** A pending "Nedlæg" (deletion) costumer_orders row — mirrors VehicleCreatePage.tsx's own CostumerOrder shape/reasoning, for the reverse flow (see costumer_orders_merge_deletion_requests.sql: both order types share this one table now, distinguished by order_type). Normally arrives pre-filled via router state (InstallationAdministrationPage's "Administration af installationer" table row click), but also fetchable by id alone so "/vehicle-delete/:orderId" works as a direct link (the email's own link). */
type VehicleDeletionOrder = {
  order_id: string;
  order_type: string;
  vehicle_id: string | null;
  costumer_id: string;
  department_id: string | null;
  number_plate: string;
  brand: string;
  model: string;
  model_year: string;
  contactperson: string;
  contactemail: string | null;
  contactnumber: string | null;
  device_removed: boolean;
  created_at: string;
  costumerName: string | null;
  departmentName: string | null;
};

/** Raw shape of the fetch-by-id query below, before flattening the embedded costumers(name)/departments(name) relations. */
type VehicleDeletionOrderQueryRow = {
  order_id: string;
  order_type: string;
  vehicle_id: string | null;
  costumer_id: string;
  department_id: string | null;
  number_plate: string;
  brand: string;
  model: string;
  model_year: string;
  contactperson: string;
  contactemail: string | null;
  contactnumber: string | null;
  device_removed: boolean;
  created_at: string;
  costumers: { name: string | null } | null;
  departments: { name: string | null } | null;
};

/**
 * "Slet køretøj" fulfillment page — sysadm only (see ProtectedRoute
 * requireRole="sysadm" in App.tsx; there's no reason for a customer's
 * own admin to see this, unlike VehicleCreatePage.tsx's looser gating).
 * Reachable at plain "/vehicle-delete" (order passed via router state —
 * InstallationAdministrationPage's "Administration af installationer" table
 * row click) or "/vehicle-delete/:orderId" (fetches the order by id — the
 * link in send-vehicle-deletion-request.mts's email). Missing both state and
 * a resolvable :orderId — or an order that isn't actually order_type
 * "Nedlæg" (a stale/mistyped link to what's really a creation order) —
 * redirects back to "/sysadm-installations". Shows what the customer
 * admin's "Slet køretøj" request carries, plus a single "Afregistrer 2hire
 * device og slet køretøjet" action gated behind a Fortryd/Ja ConfirmDialog
 * whose own message asks staff to confirm the physical device is actually
 * out — confirming persists device_removed: true (still re-verified
 * server-side by delete-vehicle.mts before anything irreversible happens)
 * and, in the same action, deregisters the vehicle from 2hire and deletes it
 * from our own DB. Was previously a separate persisted toggle step ahead of
 * the delete button; folded into the confirmation dialog itself since both
 * steps always happened together in practice.
 */
export function VehicleDeletePage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { orderId } = useParams<{ orderId: string }>();
  const stateOrder = (location.state as { request?: VehicleDeletionOrder } | null)?.request ?? null;
  const [fetchedOrder, setFetchedOrder] = useState<VehicleDeletionOrder | null>(null);
  // Lazy-initialized true whenever a fetch-by-id is actually going to happen
  // (orderId present, no stateOrder yet) — same reasoning as
  // VehicleCreatePage.tsx's orderLoading: starting this false would race the
  // redirect effect below, which would see the original (false) value and
  // bounce back to "/sysadm-installations" before the fetch had a
  // chance to resolve.
  const [orderLoading, setOrderLoading] = useState(() => Boolean(orderId) && !stateOrder);
  const rawOrder = stateOrder ?? fetchedOrder;
  // Treated as "not found" if it resolved to an Opret order — this page only
  // handles Nedlæg — same as costumer_orders' SELECT RLS scoping an orderId
  // outside the caller's reach down to "not found" too.
  const order = rawOrder && rawOrder.order_type === "Nedlæg" ? rawOrder : null;
  /** Whether this order's own department shows the "Køretøj-ID:" row below at all — see useIdentSettings' own doc comment. */
  const { useVehicleIdent } = useIdentSettings(order?.department_id ?? null);
  /** The real vehicle_profiles.vehicle_ident for order.vehicle_id (always set for a resolved "Nedlæg" order — see send-vehicle-deletion-request.mts, which never populates costumer_orders.vehicle_ident itself for a deletion request, unlike NewVehiclePage.tsx's creation flow) — fetched fresh from the actual vehicle rather than trusting the order snapshot. Falls back to order.number_plate, same convention as everywhere else. */
  const [vehicleIdent, setVehicleIdent] = useState<string | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deregisterWarning, setDeregisterWarning] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  /** Fetch-by-id fallback for a direct URL/refresh/bookmark to "/vehicle-delete/:orderId" (no router state) — skipped entirely when stateOrder is already present. Naturally scoped to the caller's own costumer (or any, for a sysadm) by costumer_orders' SELECT RLS policy. */
  useEffect(() => {
    if (stateOrder || !orderId) return;

    let cancelled = false;
    setOrderLoading(true);
    void supabase
      .from("costumer_orders")
      .select(
        "order_id, order_type, vehicle_id, costumer_id, department_id, number_plate, brand, model, model_year, contactperson, contactemail, contactnumber, device_removed, created_at, costumers(name), departments(name)",
      )
      .eq("order_id", orderId)
      .maybeSingle<VehicleDeletionOrderQueryRow>()
      .then(({ data }) => {
        if (cancelled) return;
        setFetchedOrder(
          data
            ? {
                order_id: data.order_id,
                order_type: data.order_type,
                vehicle_id: data.vehicle_id,
                costumer_id: data.costumer_id,
                department_id: data.department_id,
                number_plate: data.number_plate,
                brand: data.brand,
                model: data.model,
                model_year: data.model_year,
                contactperson: data.contactperson,
                contactemail: data.contactemail,
                contactnumber: data.contactnumber,
                device_removed: data.device_removed,
                created_at: data.created_at,
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

  // Redirects back to the installations list once it's clear the order
  // can't be resolved: either no :orderId AND no router state at all, a
  // specific :orderId that came back empty (already fulfilled/deleted, or
  // outside RLS) once the fetch has finished, or an order that resolved but
  // turned out to be order_type "Opret" (not this page's job).
  useEffect(() => {
    if (!order && !orderLoading) {
      navigate("/sysadm-installations", { replace: true });
    }
  }, [order, orderLoading, navigate]);

  /** Fetches the real vehicle_ident for order.vehicle_id — see vehicleIdent's own doc comment above. */
  useEffect(() => {
    if (!order?.vehicle_id) {
      setVehicleIdent(null);
      return;
    }

    let cancelled = false;
    void supabase
      .from("vehicle_profiles")
      .select("vehicle_ident")
      .eq("vehicle_id", order.vehicle_id)
      .maybeSingle<{ vehicle_ident: string | null }>()
      .then(({ data }) => {
        if (cancelled) return;
        setVehicleIdent(data?.vehicle_ident ?? null);
      });

    return () => {
      cancelled = true;
    };
  }, [order?.vehicle_id]);

  if (orderId && !order && orderLoading) {
    return (
      <div className="flex h-svh items-center justify-center bg-brand-50 text-brand-600">Indlæser anmodning…</div>
    );
  }

  if (!order) {
    return null;
  }

  /**
   * The real, terminal action — triggered from the Ja/Fortryd confirmation
   * dialog below, whose message itself IS the "have you physically removed
   * the device" question (replacing the old, separate persisted toggle
   * step). Persists device_removed: true first (delete-vehicle.mts
   * re-verifies this server-side before doing anything irreversible — see
   * its own doc comment — so this write has to land before that call, not
   * just be implied by the user clicking "Ja"), then deregisters the
   * vehicle from 2hire (best-effort) and deletes it from our own DB.
   */
  const handleDeleteVehicle = async () => {
    if (!order.vehicle_id) return;
    setIsDeleting(true);
    setDeleteError(null);

    const { error: deviceRemovedError } = await supabase
      .from("costumer_orders")
      .update({ device_removed: true })
      .eq("order_id", order.order_id);
    if (deviceRemovedError) {
      setDeleteError(deviceRemovedError.message);
      setIsDeleting(false);
      return;
    }

    try {
      const response = await fetch("/.netlify/functions/delete-vehicle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ vehicleId: order.vehicle_id, orderId: order.order_id }),
      });

      const result = (await response.json()) as { ok?: boolean; error?: string; deregisterWarning?: string | null };

      if (!response.ok) {
        setDeleteError(result.error ?? "Kunne ikke slette køretøjet.");
        setIsDeleting(false);
        return;
      }

      setDeregisterWarning(result.deregisterWarning ?? null);
    } catch {
      setDeleteError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsDeleting(false);
      return;
    }

    setIsDeleting(false);
    setShowDeleteConfirm(false);
    setDeleted(true);
  };

  const rows: [string, string][] = [
    ["Kunde:", order.costumerName ?? "—"],
    ["Afdeling:", order.departmentName ?? "—"],
    // Single merged row (was two: "Køretøj-ID:" + "Nummerplade:") —
    // "{vehicle_ident} - {number_plate}" when this order's department shows
    // vehicle_ident AND it's actually set, else just number_plate — same
    // design as VehicleDetailsPage.tsx's own merged "Køretøj:" row.
    ["Køretøj:", formatVehicleIdentLabel(vehicleIdent, order.number_plate, useVehicleIdent)],
    ["Mærke:", order.brand],
    ["Model:", order.model],
    ["Årgang:", order.model_year],
    ["Anmodet af:", order.contactperson],
    ["Kontakt e-mail:", order.contactemail ?? "—"],
    ["Telefon:", order.contactnumber ?? "—"],
    ["Anmodet:", new Date(order.created_at).toLocaleString("da-DK")],
  ];

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
            <h2 className="text-xl font-semibold text-brand-800">Slet køretøj</h2>

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

            {deleted ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <p className="text-sm font-semibold text-accent-700">Køretøjet er slettet.</p>
                {deregisterWarning && (
                  <p className="text-xs text-brand-600">
                    Bemærk: køretøjet kunne ikke afregistreres i 2hire ({deregisterWarning}) — det er sandsynligvis
                    aldrig blevet registreret der. Køretøjet er stadig slettet i FLEETii.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => navigate("/sysadm-installations", { replace: true })}
                  className="w-full rounded-lg border border-brand-200 bg-white px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
                >
                  Tilbage til oversigt
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full rounded-lg border-2 border-red-600 bg-white px-2 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Afregistrer 2hire device og slet køretøjet
                </button>
              </div>
            )}

            {showDeleteConfirm && (
              <ConfirmDialog
                message="Har du fjernet 2hire device, og ønsker du at nedlægge køretøjet - BEMÆRK, at dette også vil fjerne al historik omkring dette køretøj - kan IKKE reetableres  efterfølgende"
                error={deleteError}
                onCancel={() => setShowDeleteConfirm(false)}
                onConfirm={() => void handleDeleteVehicle()}
                isPending={isDeleting}
                confirmPendingLabel="Sletter…"
              />
            )}
          </section>
        </motion.main>
      </div>
    </div>
  );
}
