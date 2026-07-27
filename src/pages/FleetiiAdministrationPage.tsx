// The "FLEETii admin" home page ("/fleetii-admin" — where RootRoute sends a
// user with role "FLEETii admin" after login, instead of the regular admin
// dashboard). Lists every costumer; clicking one opens CostumerDetailsPage.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";

/** A row from the `costumers` table. Fetched in full (not just costumer_id/name/deactivated_at) so the object handed to CostumerDetailsPage via router state already has everything it displays — otherwise its view would show "—" for cvr/address/contact_person/phone/email until its own fetch-by-id fallback kicked in. */
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

/** A pending "send-vehicle-request" submission (see costumer_orders_table.sql) — every field it carries, so the object handed to VehicleCreatePage via router state already has everything it needs, same reasoning as Costumer above. costumerName/departmentName come from the embedded costumers(name)/departments(name) joins, not columns on costumer_orders itself. */
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
  /** Whether each of VehicleCreatePage.tsx's three provisioning steps has been marked done — see costumer_orders_add_step_flags.sql. */
  vehicle_registered: boolean;
  iot_device_associated: boolean;
  other_2hire_done: boolean;
  costumerName: string | null;
  departmentName: string | null;
};

/** Raw shape of the Supabase query before flattening the embedded costumers(name)/departments(name) relations. */
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

/** FLEETii admin dashboard. Reachable only by role "FLEETii admin" (see ProtectedRoute requireRole="FLEETii admin" in App.tsx) — plain "admin" does not get in. */
export function FleetiiAdministrationPage() {
  const navigate = useNavigate();

  const [costumers, setCostumers] = useState<Costumer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCostumers() {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("costumers")
        .select("costumer_id, name, deactivated_at, cvr, address, contact_person, phone, email")
        .order("name", { ascending: true })
        .returns<Costumer[]>();

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setCostumers(data ?? []);
      setLoading(false);
    }

    void loadCostumers();
  }, []);

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
          "order_id, costumer_id, department_id, number_plate, brand, model, model_year, needs_fleetii_device, fleetii_device_id, contactperson, contactnumber, vehicle_registered, iot_device_associated, other_2hire_done, costumers(name), departments(name)",
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
            <h2 className="text-xl font-semibold text-brand-800">Administration af kunder</h2>

            <div className="flex max-h-[50vh] flex-col overflow-auto rounded-none border border-brand-100">
              <table className="w-full border-collapse text-[0.7rem]">
                <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                  <tr>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Navn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100 bg-white">
                  {loading && (
                    <tr>
                      <td className="px-2 py-3 text-center text-brand-500">Indlæser kunder…</td>
                    </tr>
                  )}
                  {!loading && error && (
                    <tr>
                      <td className="px-2 py-3 text-center text-red-600">{error}</td>
                    </tr>
                  )}
                  {!loading && !error && costumers.length === 0 && (
                    <tr>
                      <td className="px-2 py-3 text-center text-brand-500">Ingen kunder fundet.</td>
                    </tr>
                  )}
                  {!loading &&
                    !error &&
                    costumers.map((costumer, index) => {
                      const isAlternate = index % 2 === 1;
                      const goToCostumer = () =>
                        navigate(`/costumer-details/${costumer.costumer_id}`, { state: { costumer } });
                      return (
                        <tr
                          key={costumer.costumer_id}
                          role="button"
                          tabIndex={0}
                          onClick={goToCostumer}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              goToCostumer();
                            }
                          }}
                          className={`cursor-pointer transition ${
                            isAlternate
                              ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                              : "bg-white text-brand-700 hover:bg-brand-50"
                          }`}
                        >
                          <td className="whitespace-nowrap px-2 py-0.5 font-medium">
                            {costumer.name ?? "—"}
                            {costumer.deactivated_at && (
                              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-red-700">
                                Adgang blokeret
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() => navigate("/costumer-details")}
              className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Ny kunde
            </button>

            <h2 className="text-xl font-semibold text-brand-800">Administration af installationer</h2>

            <div className="flex max-h-[50vh] flex-col overflow-auto rounded-none border border-brand-100">
              <table className="w-full border-collapse text-[0.7rem]">
                <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                  <tr>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Kunde</th>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Afdeling</th>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Nummerplade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100 bg-white">
                  {ordersLoading && (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-center text-brand-500">Indlæser installationer…</td>
                    </tr>
                  )}
                  {!ordersLoading && ordersError && (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-center text-red-600">{ordersError}</td>
                    </tr>
                  )}
                  {!ordersLoading && !ordersError && costumerOrders.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-center text-brand-500">Ingen installationer fundet.</td>
                    </tr>
                  )}
                  {!ordersLoading &&
                    !ordersError &&
                    costumerOrders.map((order, index) => {
                      const isAlternate = index % 2 === 1;
                      const goToVehicleCreate = () =>
                        navigate(`/vehicle-create/${order.order_id}`, { state: { order } });
                      return (
                        <tr
                          key={order.order_id}
                          role="button"
                          tabIndex={0}
                          onClick={goToVehicleCreate}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              goToVehicleCreate();
                            }
                          }}
                          className={`cursor-pointer transition ${
                            isAlternate
                              ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                              : "bg-white text-brand-700 hover:bg-brand-50"
                          }`}
                        >
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
