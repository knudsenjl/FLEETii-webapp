import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../contexts/AuthContext";
import { useRefreshVehicles } from "../contexts/VehicleContext";
import { supabase } from "../lib/supabase";
import { shortSignalTimestamp } from "../lib/bookings";

/** A department the vehicle could be assigned to — scoped to the admin's own costumer (see the departments-loading effect below). */
type DepartmentOption = { department_id: string; name: string };

/** Every vehicle belongs to its costumer's "Alle køretøjer" department by definition (see supabase/applied/backfill_and_assign_vehicles_to_alle_koretojer.sql) — its checkbox below is always checked and disabled, never something this page's toggle can remove (the DB backstops this too, see vehicle_departments_protect_alle_koretojer_delete.sql). */
const ALLE_KORETOJER_NAME = "Alle køretøjer";

/** The DisplayVehicle shape, as passed in via router state from VehicleDetailsPage's "Rediger køretøj" button. Only vehicleId is actually used here — the editable fields (plate/brand/model/year) are fetched fresh from vehicle_profiles on mount instead of trusted from router state, since VehicleDetailsPage's own Vehicle type only carries an already-combined "brand model" display string, not the separate fields this form edits/saves. */
type Vehicle = {
  vehicleId: string;
  department: string;
  status: string;
  autonomyPercentage?: string;
  autonomyPercentageUpdatedAt?: string;
  distanceCovered?: string;
  distanceCoveredUpdatedAt?: string;
  onlineUpdatedAt?: string;
};

/** Raw shape of the vehicle_profiles row fetched fresh on mount for the editable fields. */
type VehicleProfileRow = {
  number_plate: string | null;
  brand: string | null;
  model: string | null;
  model_year: string | null;
  department_id: string | null;
};

/**
 * Admin "edit vehicle" page ("/edit-vehicle", reached via
 * VehicleDetailsPage's "Rediger køretøj"). Nummerplade/Mærke/Model/Årgang are
 * editable (they're the vehicle_profiles-backed fields an admin actually
 * manages) — loaded fresh from vehicle_profiles by vehicle_id on mount, then
 * saved back via an UPDATE (see supabase/applied/vehicle_profiles_update_policy.sql
 * for the RLS scoping: admin + vehicle in one of their own departments).
 * Brændstofniveau/Kilometerstand/Status stay read-only since they're live
 * telemetry written by the 2hire webhook — editing them wouldn't persist
 * past the next signal update anyway. Afdeling(er) is the first UI anywhere
 * in the app for managing vehicle_departments (previously read-only,
 * populated by a one-time backfill) — a checkbox table of the admin's own
 * costumer's departments, reconciled (inserted/deleted) against the DB
 * together with the rest of the form when "Gem ændringer" is pressed (see
 * supabase/applied/vehicle_departments_write_policies.sql for the RLS this
 * needs). "Fortryd" navigates back to VehicleDetailsPage without saving.
 */
export function HandleVehiclePage() {
  const { costumerId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const refreshVehicles = useRefreshVehicles();
  const state = location.state as { vehicle?: Vehicle } | null;
  const vehicle = state?.vehicle ?? null;

  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** The vehicle's own "home" department (vehicle_profiles.department_id — see supabase/applied/add_vehicle_profiles_costumer_and_department_fk.sql), selectable via a <select> filtered to departmentOptions the vehicle is actually assigned to (selectedDepartmentIds) below. Null while still loading. */
  const [homeDepartmentId, setHomeDepartmentId] = useState<string | null>(null);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<Set<string>>(new Set());
  /** The DB's own current vehicle_departments rows for this vehicle, at load time — diffed against selectedDepartmentIds on save to know which rows to insert/delete, rather than replacing the whole set blindly. */
  const [originalDepartmentIds, setOriginalDepartmentIds] = useState<Set<string>>(new Set());
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicle) {
      navigate("/fleet-table", { replace: true });
    }
  }, [vehicle, navigate]);

  useEffect(() => {
    if (!vehicle) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void supabase
      .from("vehicle_profiles")
      .select("number_plate, brand, model, model_year, department_id")
      .eq("vehicle_id", vehicle.vehicleId)
      .maybeSingle<VehicleProfileRow>()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLoadError(error.message);
          setLoading(false);
          return;
        }
        setPlate(data?.number_plate ?? "");
        setMake(data?.brand ?? "");
        setModel(data?.model ?? "");
        setYear(data?.model_year ?? "");
        setHomeDepartmentId(data?.department_id ?? null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [vehicle]);

  /** Loads the admin's own costumer's departments (the assignable options — scoped the same way UserDetailsPage.tsx's own department picker is) and this vehicle's current vehicle_departments rows. */
  useEffect(() => {
    if (!vehicle || !costumerId) return;

    let cancelled = false;
    setDepartmentsLoading(true);
    setDepartmentsError(null);

    void Promise.all([
      supabase
        .from("departments")
        .select("department_id, name")
        .eq("costumer_id", costumerId)
        .order("name", { ascending: true })
        .returns<DepartmentOption[]>(),
      supabase.from("vehicle_departments").select("department_id").eq("vehicle_id", vehicle.vehicleId).returns<
        { department_id: string }[]
      >(),
    ]).then(([departmentsResult, assignedResult]) => {
      if (cancelled) return;
      if (departmentsResult.error) {
        setDepartmentsError(departmentsResult.error.message);
        setDepartmentsLoading(false);
        return;
      }
      if (assignedResult.error) {
        setDepartmentsError(assignedResult.error.message);
        setDepartmentsLoading(false);
        return;
      }
      // "Alle køretøjer" always sorts first, ahead of the rest's alphabetical order (from the query's own .order("name")).
      const options = [...(departmentsResult.data ?? [])].sort((a, b) => {
        if (a.name === ALLE_KORETOJER_NAME) return -1;
        if (b.name === ALLE_KORETOJER_NAME) return 1;
        return 0;
      });
      setDepartmentOptions(options);
      const assigned = new Set((assignedResult.data ?? []).map((row) => row.department_id));
      // Self-heals a vehicle that's somehow missing its (guaranteed)
      // "Alle køretøjer" row yet — checked in the UI regardless (see
      // ALLE_KORETOJER_NAME), so selectedDepartmentIds must already include
      // it too, or saving would look like a no-op change instead of the
      // insert that's actually needed. originalDepartmentIds stays the
      // real DB snapshot so this still shows up correctly as a pending add.
      const alleKoretojer = options.find((d) => d.name === ALLE_KORETOJER_NAME);
      if (alleKoretojer) {
        assigned.add(alleKoretojer.department_id);
      }
      setSelectedDepartmentIds(assigned);
      setOriginalDepartmentIds(new Set((assignedResult.data ?? []).map((row) => row.department_id)));
      setDepartmentsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [vehicle, costumerId]);

  if (!vehicle) {
    return null;
  }

  /** [label, short value (visible), full value (hover tooltip)] — the UpdatedAt timestamps are shortened to "dd/mm HH.MM", full "dd/mm/yyyy HH.MM" available on hover. */
  const readOnlyRows: [string, string, string][] = [
    [
      "Brændstofniveau:",
      `${vehicle.autonomyPercentage ?? "—"}${vehicle.autonomyPercentageUpdatedAt ? ` (${shortSignalTimestamp(vehicle.autonomyPercentageUpdatedAt)})` : ""}`,
      `${vehicle.autonomyPercentage ?? "—"}${vehicle.autonomyPercentageUpdatedAt ? ` (${vehicle.autonomyPercentageUpdatedAt})` : ""}`,
    ],
    [
      "Kilometerstand:",
      `${vehicle.distanceCovered ?? "—"}${vehicle.distanceCoveredUpdatedAt ? ` (${shortSignalTimestamp(vehicle.distanceCoveredUpdatedAt)})` : ""}`,
      `${vehicle.distanceCovered ?? "—"}${vehicle.distanceCoveredUpdatedAt ? ` (${vehicle.distanceCoveredUpdatedAt})` : ""}`,
    ],
  ];

  const canSave =
    !loading &&
    plate.trim().length > 0 &&
    make.trim().length > 0 &&
    model.trim().length > 0 &&
    year.trim().length > 0 &&
    Boolean(homeDepartmentId);

  const toggleDepartment = (department: DepartmentOption, checked: boolean) => {
    // "Alle køretøjer" is disabled in the UI (see the checkbox below), but
    // guard here too rather than trusting only the disabled attribute.
    if (department.name === ALLE_KORETOJER_NAME) return;

    setSelectedDepartmentIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(department.department_id);
      } else {
        next.delete(department.department_id);
      }
      return next;
    });

    // Clear the home department selection if its own department was just
    // unchecked — otherwise handleSave would write vehicle_profiles.
    // department_id to a department this vehicle is no longer assigned to
    // via vehicle_departments (nothing else catches that inconsistency;
    // canSave above now also requires a home department to be (re-)picked
    // before saving is allowed at all).
    if (!checked && department.department_id === homeDepartmentId) {
      setHomeDepartmentId(null);
    }
  };

  /**
   * Updates this vehicle's editable fields in vehicle_profiles, then
   * returns to VehicleDetailsPage. Two things are needed for the change to
   * actually be visible afterward, not just in the DB:
   * - refreshVehicles() re-fetches the shared in-memory fleet list (see
   *   VehicleContext.tsx) — otherwise VehiclesPage/FleetManagementPage keep
   *   showing the pre-edit values until a full page reload, since that list
   *   is normally only fetched once per session.
   * - navigating to "/vehicle-details" with an explicitly rebuilt vehicle
   *   object (rather than navigate(-1), which would land back on
   *   VehicleDetailsPage with its OLD router state, unaffected by the
   *   refresh above) — VehicleDetailsPage reads its vehicle entirely from
   *   router state, not from context, so it needs the fresh values handed
   *   to it directly.
   */
  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);

    const trimmedPlate = plate.trim();
    const trimmedMake = make.trim();
    const trimmedModel = model.trim();
    const trimmedYear = year.trim();

    // .select() so a row actually being updated can be confirmed — RLS
    // (vehicle_profiles_update_policy.sql) silently returns 0 rows rather
    // than an error if it doesn't match (e.g. the admin's active department
    // changed in another tab between load and save), same as this app's
    // other RLS gaps taught us to check for explicitly rather than assume a
    // no-error response means success.
    const { data: updatedRows, error } = await supabase
      .from("vehicle_profiles")
      .update({
        number_plate: trimmedPlate,
        brand: trimmedMake,
        model: trimmedModel,
        model_year: trimmedYear,
        department_id: homeDepartmentId,
        costumer_id: costumerId,
      })
      .eq("vehicle_id", vehicle.vehicleId)
      .select("vehicle_id");

    if (error) {
      setSaveError(error.message);
      setIsSaving(false);
      return;
    }
    if (!updatedRows || updatedRows.length === 0) {
      setSaveError("Køretøjet kunne ikke opdateres.");
      setIsSaving(false);
      return;
    }

    // Reconciles vehicle_departments against whatever was toggled — only
    // when the departments section itself loaded successfully, so a failed
    // fetch (departmentsError set) can't wipe out real assignments the
    // admin never actually saw or touched. Adds new grants BEFORE removing
    // old ones (unlike a naive diff-and-apply in either order) — these two
    // writes aren't wrapped in a real DB transaction, so if the second call
    // fails partway through, this ordering leaves the vehicle with an EXTRA,
    // stale department grant rather than having already lost access to one
    // it should still have; the safer of the two possible partial-failure
    // states.
    if (!departmentsError) {
      const toAdd = [...selectedDepartmentIds].filter((id) => !originalDepartmentIds.has(id));
      const toRemove = [...originalDepartmentIds].filter((id) => !selectedDepartmentIds.has(id));

      if (toAdd.length > 0) {
        const { error: addError } = await supabase
          .from("vehicle_departments")
          .insert(toAdd.map((department_id) => ({ vehicle_id: vehicle.vehicleId, department_id })));
        if (addError) {
          setSaveError(addError.message);
          setIsSaving(false);
          return;
        }
      }

      if (toRemove.length > 0) {
        const { error: removeError } = await supabase
          .from("vehicle_departments")
          .delete()
          .eq("vehicle_id", vehicle.vehicleId)
          .in("department_id", toRemove);
        if (removeError) {
          setSaveError(removeError.message);
          setIsSaving(false);
          return;
        }
      }

      setOriginalDepartmentIds(new Set(selectedDepartmentIds));
    }

    await refreshVehicles();

    setIsSaving(false);
    navigate(`/vehicle-details/${vehicle.vehicleId}`, {
      replace: true,
      state: {
        vehicle: {
          ...vehicle,
          vehicle: `${trimmedMake} ${trimmedModel}`,
          plate: trimmedPlate,
          version: trimmedYear,
        },
      },
    });
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

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">Køretøj detaljer</h2>

              {loading && <p className="text-sm text-brand-500">Indlæser…</p>}
              {!loading && loadError && <p className="text-sm text-red-600">{loadError}</p>}

              {!loading && !loadError && (
                <div className="overflow-hidden rounded-none border border-brand-100">
                  <div className="divide-y divide-brand-100 bg-white">
                    <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-[0.7rem] text-brand-700">
                      <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Nummerplade:</label>
                      <input
                        type="text"
                        value={plate}
                        onChange={(e) => setPlate(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-[0.7rem] text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-[0.7rem] text-brand-700">
                      <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Mærke:</label>
                      <input
                        type="text"
                        value={make}
                        onChange={(e) => setMake(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-[0.7rem] text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-[0.7rem] text-brand-700">
                      <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Model:</label>
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-[0.7rem] text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-[0.7rem] text-brand-700">
                      <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Årgang:</label>
                      <input
                        type="text"
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-[0.7rem] text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    {readOnlyRows.map(([label, shortValue, fullValue]) => (
                      <div key={label} className="grid grid-cols-[0.4fr_1fr] px-1 py-0.5 text-[0.7rem] text-brand-700">
                        <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">{label}</div>
                        <div className="whitespace-nowrap px-1" title={fullValue}>{shortValue}</div>
                      </div>
                    ))}
                    <div className="grid grid-cols-[0.4fr_1fr] px-1 py-0.5 text-[0.7rem] text-brand-700">
                      <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Status:</div>
                      <div
                        className="whitespace-nowrap px-1"
                        title={vehicle.onlineUpdatedAt ? `${vehicle.status} (opdateret ${vehicle.onlineUpdatedAt})` : undefined}
                      >
                        {vehicle.status}
                        {vehicle.onlineUpdatedAt ? ` (opdateret ${shortSignalTimestamp(vehicle.onlineUpdatedAt)})` : ""}
                      </div>
                    </div>
                    <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-[0.7rem] text-brand-700">
                      <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Hjemmeafdeling:</div>
                      <select
                        value={homeDepartmentId ?? ""}
                        onChange={(e) => setHomeDepartmentId(e.target.value || null)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-[0.7rem] text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      >
                        <option value="" className="bg-brand-100">Vælg hjemmeafdeling:</option>
                        {departmentOptions
                          .filter((department) => selectedDepartmentIds.has(department.department_id))
                          .map((department) => (
                            <option key={department.department_id} value={department.department_id}>
                              {department.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-[0.4fr_1fr] items-start px-1 py-0.5 text-[0.7rem] text-brand-700">
                      <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Afdeling(er):</label>
                      <div className="py-0.5">
                        {departmentsLoading && <span className="text-brand-500">Indlæser…</span>}
                        {!departmentsLoading && departmentsError && (
                          <span className="text-red-600">{departmentsError}</span>
                        )}
                        {!departmentsLoading && !departmentsError && (
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
                                {departmentOptions.map((department) => {
                                  const isAlleKoretojer = department.name === ALLE_KORETOJER_NAME;
                                  return (
                                    <tr key={department.department_id}>
                                      <td className="whitespace-nowrap px-2 py-0.5 font-medium text-brand-700">
                                        {department.name}
                                      </td>
                                      <td className="px-2 py-0.5 text-center">
                                        <input
                                          type="checkbox"
                                          checked={isAlleKoretojer || selectedDepartmentIds.has(department.department_id)}
                                          disabled={isAlleKoretojer}
                                          title={isAlleKoretojer ? "Alle køretøjer kan ikke fjernes" : undefined}
                                          onChange={(e) => toggleDepartment(department, e.target.checked)}
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
                  </div>
                </div>
              )}

              {saveError && <p className="text-sm text-red-600">{saveError}</p>}

              <div className="flex flex-row gap-3">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!canSave || isSaving}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? "Gemmer…" : "Gem ændringer"}
                </button>
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  disabled={isSaving}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Fortryd
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
