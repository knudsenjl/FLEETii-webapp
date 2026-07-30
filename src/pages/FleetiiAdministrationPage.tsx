// The "FLEETii admin" home page ("/fleetii-admin" — where RootRoute sends a
// user with role "FLEETii admin" after login, instead of the regular admin
// dashboard). Lists every costumer; clicking one opens CostumerDetailsPage.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";

/** A vehicle_profiles row still on seeded mock data (iot_id like "2H2000...", see seed_vehicle_profiles.sql) — not yet a real 2hire test-adaptor registration. See 2hire-migrate-vehicle.mts. */
type MockVehicle = { vehicle_id: string; number_plate: string; brand: string; model: string };

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
  number_plate: string;
  brand: string;
  model: string;
  model_year: string;
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
  number_plate: string;
  brand: string;
  model: string;
  model_year: string;
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

/** FLEETii admin dashboard. Reachable only by role "FLEETii admin" (see ProtectedRoute requireRole="FLEETii admin" in App.tsx) — plain "admin" does not get in. */
export function FleetiiAdministrationPage() {
  const { session } = useAuth();
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
          "order_id, order_type, vehicle_id, costumer_id, department_id, number_plate, brand, model, model_year, needs_fleetii_device, fleetii_device_id, contactperson, contactemail, contactnumber, vehicle_registered, iot_device_associated, other_2hire_done, device_removed, created_at, costumers(name), departments(name)",
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

  const [mockVehicles, setMockVehicles] = useState<MockVehicle[]>([]);
  const [mockVehiclesLoading, setMockVehiclesLoading] = useState(true);
  const [mockVehiclesError, setMockVehiclesError] = useState<string | null>(null);

  useEffect(() => {
    async function loadMockVehicles() {
      setMockVehiclesLoading(true);
      setMockVehiclesError(null);

      const { data, error: fetchError } = await supabase
        .from("vehicle_profiles")
        .select("vehicle_id, number_plate, brand, model")
        .like("iot_id", "2H2000%")
        .order("number_plate", { ascending: true })
        .returns<MockVehicle[]>();

      if (fetchError) {
        setMockVehiclesError(fetchError.message);
        setMockVehiclesLoading(false);
        return;
      }

      setMockVehicles(data ?? []);
      setMockVehiclesLoading(false);
    }

    void loadMockVehicles();
  }, []);

  const [migratedVehicles, setMigratedVehicles] = useState<MockVehicle[]>([]);
  const [migratedVehiclesLoading, setMigratedVehiclesLoading] = useState(true);
  const [migratedVehiclesError, setMigratedVehiclesError] = useState<string | null>(null);

  /** Vehicles already migrated (real vehicle_id/iot_id) — offered here so a partially-failed dynamic-data push (2hire-migrate-vehicle.mts's own telemetryWarning, e.g. VEHICLE_LOCKED/MISSING_CONFIGURATION) can be retried without redoing the whole registration. */
  useEffect(() => {
    async function loadMigratedVehicles() {
      setMigratedVehiclesLoading(true);
      setMigratedVehiclesError(null);

      const { data, error: fetchError } = await supabase
        .from("vehicle_profiles")
        .select("vehicle_id, number_plate, brand, model")
        .not("iot_id", "like", "2H2000%")
        .order("number_plate", { ascending: true })
        .returns<MockVehicle[]>();

      if (fetchError) {
        setMigratedVehiclesError(fetchError.message);
        setMigratedVehiclesLoading(false);
        return;
      }

      setMigratedVehicles(data ?? []);
      setMigratedVehiclesLoading(false);
    }

    void loadMigratedVehicles();
  }, []);

  /** Which vehicle (if any) is currently mid-migration — disables that row's own button while in flight. */
  const [migratingVehicleId, setMigratingVehicleId] = useState<string | null>(null);
  /** Per-vehicle result messages, keyed by vehicle_id — only actually visible for a FAILED migration (the row stays in mockVehicles so this renders inline on it); a successful one removes the row before this could ever be seen there, which is exactly why migrationLog below exists. Kept anyway since it still drives the inline error display for failures. */
  const [migrationResults, setMigrationResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  /** Persistent, most-recent-first record of every migration attempt this page visit — the only place a SUCCESS's own message (plate, and any telemetryWarning) is actually visible, since a successful migration removes its row from mockVehicles immediately. */
  const [migrationLog, setMigrationLog] = useState<{ vehicle: MockVehicle; ok: boolean; message: string }[]>([]);
  const [isBulkMigrating, setIsBulkMigrating] = useState(false);

  /** Migrates one vehicle to a real 2hire test-adaptor registration (2hire-migrate-vehicle.mts) — removes it from mockVehicles on success, records a result either way (both inline on the row for failures, and in migrationLog for everything). Returns whether it succeeded, so handleMigrateAll can just await each call without needing its own duplicate error handling. */
  const migrateVehicle = async (vehicle: MockVehicle): Promise<boolean> => {
    const vehicleId = vehicle.vehicle_id;
    setMigratingVehicleId(vehicleId);
    let succeeded = false;
    let logEntry: { ok: boolean; message: string };

    try {
      const response = await fetch("/.netlify/functions/2hire-migrate-vehicle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ vehicleId }),
      });

      const result = (await response.json()) as {
        ok?: boolean;
        newVehicleId?: string;
        telemetryWarning?: string | null;
        error?: string;
      };

      if (!response.ok) {
        logEntry = { ok: false, message: result.error ?? "Kunne ikke migrere køretøjet." };
      } else {
        succeeded = true;
        logEntry = {
          ok: true,
          message: result.telemetryWarning
            ? `Migreret (advarsel ved overførsel af data: ${result.telemetryWarning})`
            : "Migreret.",
        };
        setMockVehicles((prev) => prev.filter((v) => v.vehicle_id !== vehicleId));
      }
    } catch {
      logEntry = { ok: false, message: "Kunne ikke kontakte serveren. Prøv igen senere." };
    } finally {
      setMigratingVehicleId(null);
    }

    setMigrationResults((prev) => ({ ...prev, [vehicleId]: logEntry }));
    setMigrationLog((prev) => [{ vehicle, ...logEntry }, ...prev]);

    return succeeded;
  };

  /** "Migrér alle resterende" — runs sequentially (awaits each vehicle before starting the next), not in parallel, to stay easy on 2hire's API and keep migrationLog's running order coherent. Continues past individual failures rather than aborting the whole batch. */
  const handleMigrateAll = async () => {
    setIsBulkMigrating(true);
    for (const vehicle of mockVehicles) {
      await migrateVehicle(vehicle);
    }
    setIsBulkMigrating(false);
  };

  /** Which already-migrated vehicle (if any) is currently mid-resync — disables that row's own button while in flight. */
  const [resyncingVehicleId, setResyncingVehicleId] = useState<string | null>(null);

  /** Retries just the dynamic-data push (2hire-resync-vehicle.mts) for an already-migrated vehicle — logs the result in the same migrationLog the initial migration uses, so both kinds of attempt show up in one running log. */
  const resyncVehicle = async (vehicle: MockVehicle) => {
    setResyncingVehicleId(vehicle.vehicle_id);
    let logEntry: { ok: boolean; message: string };

    try {
      const response = await fetch("/.netlify/functions/2hire-resync-vehicle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ vehicleId: vehicle.vehicle_id }),
      });

      const result = (await response.json()) as {
        ok?: boolean;
        warning?: string | null;
        deviceState?: unknown;
        error?: string;
      };

      if (!response.ok) {
        logEntry = { ok: false, message: result.error ?? "Kunne ikke gensynkronisere køretøjet." };
      } else {
        const base = result.warning ? `Gensynkroniseret (advarsel: ${result.warning})` : "Gensynkroniseret.";
        logEntry = { ok: true, message: `${base} 2hire state: ${JSON.stringify(result.deviceState)}` };
      }
    } catch {
      logEntry = { ok: false, message: "Kunne ikke kontakte serveren. Prøv igen senere." };
    } finally {
      setResyncingVehicleId(null);
    }

    setMigrationLog((prev) => [{ vehicle, ...logEntry }, ...prev]);
  };

  /** Which already-migrated vehicle (if any) is currently mid-test-trip — disables that row's own button while in flight. */
  const [testTripVehicleId, setTestTripVehicleId] = useState<string | null>(null);

  /** ONE-OFF diagnostic (see 2hire-test-trip.mts) — runs the Milano->Aarhus multi-waypoint test trip on a vehicle, to test 2hire's documented "moving -> unlocked at trip end" behaviour. Not a permanent feature. */
  const runTestTrip = async (vehicle: MockVehicle) => {
    setTestTripVehicleId(vehicle.vehicle_id);
    let logEntry: { ok: boolean; message: string };

    try {
      const response = await fetch("/.netlify/functions/2hire-test-trip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ vehicleId: vehicle.vehicle_id }),
      });

      const result = (await response.json()) as { ok?: boolean; deviceState?: unknown; error?: string };

      if (!response.ok) {
        logEntry = { ok: false, message: result.error ?? "Kunne ikke starte testturen." };
      } else {
        logEntry = { ok: true, message: `Testtur startet. 2hire state: ${JSON.stringify(result.deviceState)}` };
      }
    } catch {
      logEntry = { ok: false, message: "Kunne ikke kontakte serveren. Prøv igen senere." };
    } finally {
      setTestTripVehicleId(null);
    }

    setMigrationLog((prev) => [{ vehicle, ...logEntry }, ...prev]);
  };

  /** Which already-migrated vehicle (if any) is currently mid-status-check — disables that row's own button while in flight. */
  const [checkingStateVehicleId, setCheckingStateVehicleId] = useState<string | null>(null);

  /** ONE-OFF diagnostic (see 2hire-check-vehicle-state.mts) — reads 2hire's current device state WITHOUT sending any command, safe to use while a trip (e.g. runTestTrip's) is still in progress. Not a permanent feature. */
  const checkVehicleState = async (vehicle: MockVehicle) => {
    setCheckingStateVehicleId(vehicle.vehicle_id);
    let logEntry: { ok: boolean; message: string };

    try {
      const response = await fetch("/.netlify/functions/2hire-check-vehicle-state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ vehicleId: vehicle.vehicle_id }),
      });

      const result = (await response.json()) as { ok?: boolean; deviceState?: unknown; error?: string };

      if (!response.ok) {
        logEntry = { ok: false, message: result.error ?? "Kunne ikke hente status." };
      } else {
        logEntry = { ok: true, message: `2hire state: ${JSON.stringify(result.deviceState)}` };
      }
    } catch {
      logEntry = { ok: false, message: "Kunne ikke kontakte serveren. Prøv igen senere." };
    } finally {
      setCheckingStateVehicleId(null);
    }

    setMigrationLog((prev) => [{ vehicle, ...logEntry }, ...prev]);
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
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Type</th>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Kunde</th>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Afdeling</th>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Nummerplade</th>
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

            <h2 className="text-xl font-semibold text-brand-800">Migrering til 2hire (test)</h2>

            <div className="flex max-h-32 flex-col overflow-auto rounded-none border border-brand-100">
              <table className="w-full border-collapse text-[0.7rem]">
                <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                  <tr>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Nummerplade</th>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Mærke</th>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Model</th>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100 bg-white">
                  {mockVehiclesLoading && (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-brand-500">Indlæser køretøjer…</td>
                    </tr>
                  )}
                  {!mockVehiclesLoading && mockVehiclesError && (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-red-600">{mockVehiclesError}</td>
                    </tr>
                  )}
                  {!mockVehiclesLoading && !mockVehiclesError && mockVehicles.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-brand-500">
                        Alle køretøjer er migreret til 2hire.
                      </td>
                    </tr>
                  )}
                  {!mockVehiclesLoading &&
                    !mockVehiclesError &&
                    mockVehicles.map((vehicle, index) => {
                      const isAlternate = index % 2 === 1;
                      const result = migrationResults[vehicle.vehicle_id];
                      const isMigratingThis = migratingVehicleId === vehicle.vehicle_id;
                      return (
                        <tr key={vehicle.vehicle_id} className={isAlternate ? "bg-brand-50/70" : "bg-white"}>
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium text-brand-700">
                            {vehicle.number_plate}
                          </td>
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 text-brand-700">
                            {vehicle.brand}
                          </td>
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 text-brand-700">
                            {vehicle.model}
                          </td>
                          <td className="whitespace-nowrap px-2 py-0.5">
                            {result && !result.ok ? (
                              <span className="text-red-600">{result.message}</span>
                            ) : (
                              <button
                                type="button"
                                disabled={isMigratingThis || isBulkMigrating}
                                onClick={() => void migrateVehicle(vehicle)}
                                className="rounded-lg bg-brand-600 px-2 py-0.5 text-[0.68rem] font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isMigratingThis ? "Migrerer…" : "Migrér"}
                              </button>
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
              disabled={mockVehicles.length === 0 || isBulkMigrating || Boolean(migratingVehicleId)}
              onClick={() => void handleMigrateAll()}
              className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBulkMigrating ? "Migrerer alle…" : "Migrér alle resterende"}
            </button>

            <h2 className="text-xl font-semibold text-brand-800">Allerede migreret — gensynkronisér</h2>
            <p className="text-xs text-brand-600">
              Disse køretøjer er allerede registreret i 2hire, men positionen/batteriniveauet blev ikke nødvendigvis
              overført korrekt første gang (fx pga. VEHICLE_LOCKED eller MISSING_CONFIGURATION). "Gensynkronisér"
              forsøger blot overførslen igen, uden at gen-registrere køretøjet.
            </p>

            <div className="flex max-h-[50vh] flex-col overflow-auto rounded-none border border-brand-100">
              <table className="w-full border-collapse text-[0.7rem]">
                <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                  <tr>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Nummerplade</th>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Mærke</th>
                    <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Model</th>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Handling</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100 bg-white">
                  {migratedVehiclesLoading && (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-brand-500">Indlæser køretøjer…</td>
                    </tr>
                  )}
                  {!migratedVehiclesLoading && migratedVehiclesError && (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-red-600">{migratedVehiclesError}</td>
                    </tr>
                  )}
                  {!migratedVehiclesLoading && !migratedVehiclesError && migratedVehicles.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-brand-500">Ingen migrerede køretøjer fundet.</td>
                    </tr>
                  )}
                  {!migratedVehiclesLoading &&
                    !migratedVehiclesError &&
                    migratedVehicles.map((vehicle, index) => {
                      const isAlternate = index % 2 === 1;
                      const isResyncingThis = resyncingVehicleId === vehicle.vehicle_id;
                      const isTestTrippingThis = testTripVehicleId === vehicle.vehicle_id;
                      const isCheckingStateThis = checkingStateVehicleId === vehicle.vehicle_id;
                      return (
                        <tr key={vehicle.vehicle_id} className={isAlternate ? "bg-brand-50/70" : "bg-white"}>
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium text-brand-700">
                            {vehicle.number_plate}
                          </td>
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 text-brand-700">
                            {vehicle.brand}
                          </td>
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 text-brand-700">
                            {vehicle.model}
                          </td>
                          <td className="whitespace-nowrap px-2 py-0.5">
                            <div className="flex gap-1">
                              <button
                                type="button"
                                disabled={isResyncingThis}
                                onClick={() => void resyncVehicle(vehicle)}
                                className="rounded-lg bg-brand-600 px-2 py-0.5 text-[0.68rem] font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isResyncingThis ? "Gensynkroniserer…" : "Gensynkronisér"}
                              </button>
                              <button
                                type="button"
                                disabled={isTestTrippingThis}
                                onClick={() => void runTestTrip(vehicle)}
                                title="Diagnostisk testtur: Milano → München → Frankfurt → Hamburg → Aarhus"
                                className="rounded-lg border border-brand-300 px-2 py-0.5 text-[0.68rem] font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isTestTrippingThis ? "Kører testtur…" : "Testtur"}
                              </button>
                              <button
                                type="button"
                                disabled={isCheckingStateThis}
                                onClick={() => void checkVehicleState(vehicle)}
                                title="Læser 2hires nuværende status uden at sende nogen kommando"
                                className="rounded-lg border border-brand-300 px-2 py-0.5 text-[0.68rem] font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isCheckingStateThis ? "Tjekker…" : "Tjek status"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {migrationLog.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-2xl border border-brand-100 bg-brand-50/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-brand-700">Migreringslog (denne session)</p>
                  <button
                    type="button"
                    onClick={() => setMigrationLog([])}
                    className="rounded-lg border border-brand-200 px-2 py-0.5 text-[0.68rem] font-semibold text-brand-700 transition hover:bg-brand-100"
                  >
                    Ryd log
                  </button>
                </div>
                <div className="flex max-h-72 flex-col gap-1 overflow-auto text-xs">
                  {migrationLog.map((entry, index) => (
                    <p key={`${entry.vehicle.vehicle_id}-${index}`} className={entry.ok ? "text-accent-700" : "text-red-600"}>
                      <span className="font-medium">{entry.vehicle.number_plate}:</span> {entry.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </section>
        </motion.main>
      </div>
    </div>
  );
}
