// "Administration af installationer" — the other of the two FLEETii-admin-only
// pages split out of what used to be a single FleetiiAdministrationPage.tsx
// ("/fleetii-admin" — see AdminFrontpage.tsx's "FLEETii admin: Administration
// af installationer" button, the second of its two FLEETii-admin-only
// buttons). Lists every costumer_orders row; clicking one opens
// VehicleCreatePage.tsx ("Opret" orders) or VehicleDeletePage.tsx ("Nedlæg"
// orders). The sibling "administration af kunder" half now lives on its own
// page — see CostumerAdministrationPage.tsx.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";

/**
 * A costumer_orders row — either order_type "Opret" ("please create this
 * vehicle", fulfilled at VehicleCreatePage.tsx) or "Nedlæg" ("please delete
 * this vehicle", fulfilled at VehicleDeletePage.tsx). The two used to be
 * separate tables/lists (costumer_orders + vehicle_deletion_requests) until
 * they were merged (see costumer_orders_merge_deletion_requests.sql) —
 * they're two sides of the same "administration af installationer" coin, so
 * one table/list with an order_type column made more sense than duplicating
 * costumer_id/department_id/number_plate/brand/model/model_year/
 * contactperson/contactnumber/created_at across two. Every field either
 * destination page needs is carried here, so the object handed onward via
 * router state already has everything it needs — needs_fleetii_device/
 * fleetii_device_id/vehicle_registered/iot_device_associated/
 * other_2hire_done only matter for "Opret" rows, vehicle_id/device_removed
 * only for "Nedlæg" rows.
 */
type CostumerOrder = {
  order_id: string;
  order_type: string;
  vehicle_id: string | null;
  costumer_id: string;
  department_id: string | null;
  /** Company-wide "Køretøj-ID" identifier — optional, see costumer_orders_add_vehicle_ident.sql. Not shown in this page's own table (an order has no confirmed identifier until a real vehicle_profiles row exists — see the "Reg.nr." column below, which always uses number_plate instead); carried through router state so VehicleCreatePage.tsx's own "Køretøj-ID:" row can still show/prefill it. */
  vehicle_ident: string | null;
  number_plate: string;
  /** Optional as of costumer_orders_brand_model_year_nullable.sql — no longer required on NewVehiclePage.tsx's "Ny bestilling" form, fillable later via VehicleCreatePage.tsx's own editable rows. */
  brand: string | null;
  model: string | null;
  model_year: string | null;
  /** Only meaningful for order_type "Opret" — see costumer_orders_add_drivmiddel.sql. Carried through router state so VehicleCreatePage.tsx's own "Drivmiddel:" row doesn't need a redundant fetch. */
  drivmiddel: string;
  needs_fleetii_device: boolean;
  fleetii_device_id: string | null;
  contactperson: string;
  contactemail: string | null;
  contactnumber: string | null;
  /** Whether each of VehicleCreatePage.tsx's three provisioning steps has been marked done — see costumer_orders_add_step_flags.sql. Only meaningful for order_type "Opret". */
  vehicle_registered: boolean;
  iot_device_associated: boolean;
  other_2hire_done: boolean;
  /** Whether VehicleDeletePage.tsx's physical-device-removal step has been confirmed. Only meaningful for order_type "Nedlæg". */
  device_removed: boolean;
  created_at: string;
  costumerName: string | null;
  departmentName: string | null;
};

/** Raw shape of the Supabase query before flattening the embedded costumers(name)/departments(name) relations. */
type CostumerOrderQueryRow = {
  order_id: string;
  order_type: string;
  vehicle_id: string | null;
  costumer_id: string;
  department_id: string | null;
  vehicle_ident: string | null;
  number_plate: string;
  brand: string | null;
  model: string | null;
  model_year: string | null;
  drivmiddel: string;
  needs_fleetii_device: boolean;
  fleetii_device_id: string | null;
  contactperson: string;
  contactemail: string | null;
  contactnumber: string | null;
  vehicle_registered: boolean;
  iot_device_associated: boolean;
  other_2hire_done: boolean;
  device_removed: boolean;
  created_at: string;
  costumers: { name: string | null } | null;
  departments: { name: string | null } | null;
};

/** FLEETii admin's installation-order list. Reachable only by role "FLEETii admin" (see ProtectedRoute requireRole="FLEETii admin" in App.tsx) — plain "admin" does not get in. */
export function InstallationAdministrationPage() {
  const navigate = useNavigate();

  const [costumerOrders, setCostumerOrders] = useState<CostumerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCostumerOrders() {
      setOrdersLoading(true);
      setOrdersError(null);

      const { data, error: fetchError } = await supabase
        .from("costumer_orders")
        .select(
          "order_id, order_type, vehicle_id, costumer_id, department_id, vehicle_ident, number_plate, brand, model, model_year, drivmiddel, needs_fleetii_device, fleetii_device_id, contactperson, contactemail, contactnumber, vehicle_registered, iot_device_associated, other_2hire_done, device_removed, created_at, costumers(name), departments(name)",
        )
        .order("created_at", { ascending: true })
        .returns<CostumerOrderQueryRow[]>();

      if (fetchError) {
        setOrdersError(fetchError.message);
        setOrdersLoading(false);
        return;
      }

      setCostumerOrders(
        (data ?? []).map(({ costumers, departments, ...rest }) => ({
          ...rest,
          costumerName: costumers?.name ?? null,
          departmentName: departments?.name ?? null,
        })),
      );
      setOrdersLoading(false);
    }

    void loadCostumerOrders();
  }, []);

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
            <h2 className="text-xl font-semibold text-brand-800">Administration af installationer</h2>

            <div className="flex max-h-[50vh] flex-col overflow-auto rounded-none border border-brand-100">
              <table className="w-full border-collapse text-[0.7rem]">
                <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                  <tr>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Type</th>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Kunde</th>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Afdeling</th>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Reg.nr.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100 bg-white">
                  {ordersLoading && (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-brand-500">Indlæser installationer…</td>
                    </tr>
                  )}
                  {!ordersLoading && ordersError && (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-red-600">{ordersError}</td>
                    </tr>
                  )}
                  {!ordersLoading && !ordersError && costumerOrders.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-brand-500">Ingen installationer fundet.</td>
                    </tr>
                  )}
                  {!ordersLoading &&
                    !ordersError &&
                    costumerOrders.map((order, index) => {
                      const isAlternate = index % 2 === 1;
                      const goToOrder = () =>
                        order.order_type === "Nedlæg"
                          ? navigate(`/vehicle-delete/${order.order_id}`, { state: { request: order } })
                          : navigate(`/vehicle-create/${order.order_id}`, { state: { order } });
                      return (
                        <tr
                          key={order.order_id}
                          role="button"
                          tabIndex={0}
                          onClick={goToOrder}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              goToOrder();
                            }
                          }}
                          className={`cursor-pointer transition ${
                            isAlternate
                              ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                              : "bg-white text-brand-700 hover:bg-brand-50"
                          }`}
                        >
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">
                            {order.order_type}
                          </td>
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">
                            {order.costumerName ?? "—"}
                          </td>
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5">
                            {order.departmentName ?? "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-0.5">{order.number_plate}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
