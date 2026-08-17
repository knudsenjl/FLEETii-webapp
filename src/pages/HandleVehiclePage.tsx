import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useRefreshVehicles } from "../contexts/VehicleContext";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { supabase } from "../lib/supabase";
import { DRIVMIDDEL_OPTIONS, formatKilometerstand, shortSignalTimestamp } from "../lib/bookings";

/** A department the vehicle could be assigned to — scoped to the vehicle's OWN costumer, fetched fresh alongside the vehicle's other fields (see vehicleCostumerId / the departments-loading effect below), not the viewer's — a FLEETii admin has no costumer of their own and must still be able to reassign a vehicle belonging to any costumer. */
type DepartmentOption = { department_id: string; name: string };

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
  /** Company-wide "Køretøj-ID" identifier (see vehicle_profiles_add_vehicle_ident.sql) — optional, shown/edited separately from Nummerplade. */
  vehicle_ident: string | null;
  brand: string | null;
  model: string | null;
  model_year: string | null;
  department_id: string | null;
  costumer_id: string | null;
  drivmiddel: string;
};


/**
 * Admin "edit vehicle" page ("/edit-vehicle", reached via
 * VehicleDetailsPage's "Rediger køretøj"). Køretøj-ID/Nummerplade/Mærke/Model/
 * Årgang are editable (they're the vehicle_profiles-backed fields an admin
 * actually manages) — loaded fresh from vehicle_profiles by vehicle_id on mount, then
 * saved back via an UPDATE (see supabase/applied/vehicle_profiles_update_policy.sql
 * and vehicle_profiles_update_allow_fleetii_admin.sql for the RLS scoping:
 * admin + vehicle in one of their own departments, or FLEETii admin +
 * any vehicle).
 * Kilometerstand/Drivmiddelniveau/Status stay read-only since they're live
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
  const navigate = useNavigate();
  const location = useLocation();
  const refreshVehicles = useRefreshVehicles();
  const state = location.state as { vehicle?: Vehicle } | null;
  const vehicle = state?.vehicle ?? null;

  const [plate, setPlate] = useState("");
  /** Company-wide "Køretøj-ID" identifier — optional (unlike plate/make/model/year, not required to save). */
  const [vehicleIdent, setVehicleIdent] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [drivmiddel, setDrivmiddel] = useState<string>("Benzin");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** The vehicle's own "home" department (vehicle_profiles.department_id — see supabase/applied/add_vehicle_profiles_costumer_and_department_fk.sql), selectable via a <select> filtered to departmentOptions the vehicle is actually assigned to (selectedDepartmentIds) below. Null while still loading. */
  const [homeDepartmentId, setHomeDepartmentId] = useState<string | null>(null);
  /** The vehicle's own current costumer_id (vehicle_profiles.costumer_id), fetched alongside its other fields — the departments-loading effect and handleSave's own update both key off this, NOT the viewer's own costumer, so a FLEETii admin (no costumer of their own) can still edit a vehicle belonging to any costumer without silently reassigning it. Null while still loading. */
  const [vehicleCostumerId, setVehicleCostumerId] = useState<string | null>(null);
  /** Whether this vehicle's own home department shows the "Køretøj-ID:" row below at all — see useIdentSettings' own doc comment. */
  const { useVehicleIdent } = useIdentSettings(homeDepartmentId);
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
      .select("number_plate, vehicle_ident, brand, model, model_year, department_id, costumer_id, drivmiddel")
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
        setVehicleIdent(data?.vehicle_ident ?? "");
        setMake(data?.brand ?? "");
        setModel(data?.model ?? "");
        setYear(data?.model_year ?? "");
        setHomeDepartmentId(data?.department_id ?? null);
        setVehicleCostumerId(data?.costumer_id ?? null);
        setDrivmiddel(data?.drivmiddel ?? "Benzin");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [vehicle]);

  /** Loads the vehicle's OWN costumer's departments (the assignable options — scoped the same way UserDetailsPage.tsx's own department picker is, but keyed off vehicleCostumerId rather than the viewer's costumer) and this vehicle's current vehicle_departments rows. Waits for vehicleCostumerId to have loaded (the fetch effect above) before running. */
  useEffect(() => {
    if (!vehicle || !vehicleCostumerId) return;

    let cancelled = false;
    setDepartmentsLoading(true);
    setDepartmentsError(null);

    void Promise.all([
      supabase
        .from("departments")
        .select("department_id, name")
        .eq("costumer_id", vehicleCostumerId)
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
      setDepartmentOptions(departmentsResult.data ?? []);
      const assigned = new Set((assignedResult.data ?? []).map((row) => row.department_id));
      setSelectedDepartmentIds(assigned);
      setOriginalDepartmentIds(new Set((assignedResult.data ?? []).map((row) => row.department_id)));
      setDepartmentsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [vehicle, vehicleCostumerId]);

  // A costumer with only one department has no real choice to make for
  // either Afdeling(er) or Hjemmeafdeling — self-heal that sole department
  // into both (same reasoning as UserDetailsPage.tsx's own single-department
  // handling) so the rows below can just hide outright instead of showing a
  // locked, un-editable control.
  useEffect(() => {
    if (departmentOptions.length !== 1) return;
    const onlyDepartmentId = departmentOptions[0].department_id;
    setSelectedDepartmentIds((prev) => (prev.has(onlyDepartmentId) ? prev : new Set(prev).add(onlyDepartmentId)));
    setHomeDepartmentId((prev) => prev ?? onlyDepartmentId);
  }, [departmentOptions]);

  // When exactly one department is checked "Tilladt" in Afdeling(er), same
  // treatment even with 2+ departments in the costumer overall — auto-select
  // and lock Hjemmeafdeling to it (see soleSelectedDepartment/the rendering
  // below). Safe on load too: already-matching is a no-op. The reverse
  // direction (clearing back to unset the moment a SECOND department gets
  // checked) deliberately isn't handled here as a mirrored effect — see
  // toggleDepartment's own comment for why.
  useEffect(() => {
    if (selectedDepartmentIds.size !== 1) return;
    const [onlyId] = selectedDepartmentIds;
    setHomeDepartmentId((prev) => (prev === onlyId ? prev : onlyId));
  }, [selectedDepartmentIds]);

  if (!vehicle) {
    return null;
  }

  /** [label, value] — the UpdatedAt timestamps are shortened to "dd/mm HH:MM" (dropping the year). Just Kilometerstand — Drivmiddelniveau is rendered explicitly further down instead, appended onto the same row as the editable Drivmiddel select (it can't be folded into a [label, value] string pair since that row isn't plain text). */
  const readOnlyRows: [string, string][] = [
    [
      "Kilometerstand:",
      `${vehicle.distanceCovered ? formatKilometerstand(vehicle.distanceCovered) : "—"}${vehicle.distanceCoveredUpdatedAt ? ` (${shortSignalTimestamp(vehicle.distanceCoveredUpdatedAt)})` : ""}`,
    ],
  ];

  const canSave =
    !loading &&
    plate.trim().length > 0 &&
    make.trim().length > 0 &&
    model.trim().length > 0 &&
    year.trim().length > 0 &&
    Boolean(homeDepartmentId);

  /** The one department checked "Tilladt" in Afdeling(er), when there's exactly one — Hjemmeafdeling locks to it (see the effect above and the rendering below), same as departmentOptions.length === 1 locking it to the costumer's own sole department. */
  const soleSelectedDepartment =
    selectedDepartmentIds.size === 1
      ? departmentOptions.find((d) => d.department_id === [...selectedDepartmentIds][0])
      : undefined;

  const toggleDepartment = (department: DepartmentOption, checked: boolean) => {
    // Checking a SECOND department while exactly one was already the
    // (locked) Hjemmeafdeling means there's a real choice again — clear it
    // back to unset so the field returns to its normal, editable state
    // instead of silently keeping the old pick. Reads selectedDepartmentIds
    // directly (this render's own closure, i.e. the pre-toggle count)
    // rather than reacting to it via a useEffect — deliberately only fires
    // here, as a direct result of THIS specific 1→2 transition, not the
    // moment an already-multi-department vehicle's assignments first load.
    if (checked && selectedDepartmentIds.size === 1) {
      setHomeDepartmentId(null);
    }

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
    const trimmedVehicleIdent = vehicleIdent.trim();
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
        vehicle_ident: trimmedVehicleIdent || null,
        brand: trimmedMake,
        model: trimmedModel,
        model_year: trimmedYear,
        drivmiddel,
        department_id: homeDepartmentId,
        costumer_id: vehicleCostumerId,
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
          plate: trimmedVehicleIdent || trimmedPlate,
          version: trimmedYear,
        },
      },
    });
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

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">Køretøj detaljer</h2>

              {loading && <p className="text-sm text-brand-500">Indlæser…</p>}
              {!loading && loadError && <p className="text-sm text-red-600">{loadError}</p>}

              {!loading && !loadError && (
                <div className="overflow-hidden rounded-none border border-brand-100">
                  <div className="divide-y divide-brand-100 bg-white">
                    {useVehicleIdent && (
                      <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-sm text-brand-700">
                        <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Køretøj-ID:</label>
                        <input
                          type="text"
                          value={vehicleIdent}
                          onChange={(e) => setVehicleIdent(e.target.value)}
                          placeholder="valgfri — bruger Nummerplade hvis tom"
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      </div>
                    )}
                    <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-sm text-brand-700">
                      <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Nummerplade:</label>
                      <input
                        type="text"
                        value={plate}
                        onChange={(e) => setPlate(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-sm text-brand-700">
                      <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Mærke:</label>
                      <input
                        type="text"
                        value={make}
                        onChange={(e) => setMake(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-sm text-brand-700">
                      <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Model:</label>
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-sm text-brand-700">
                      <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Årgang:</label>
                      <input
                        type="text"
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                    {readOnlyRows.map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[0.4fr_1fr] px-1 py-0.5 text-sm text-brand-700">
                        <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">{label}</div>
                        <div className="whitespace-nowrap px-1">{value}</div>
                      </div>
                    ))}
                    {/* Drivmiddelniveau (fuel/battery %) is appended next to the select rather than shown as its own row — the two are closely related enough not to need a separate label. */}
                    <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-sm text-brand-700">
                      <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Drivmiddel:</label>
                      <div className="flex items-center gap-2">
                        <select
                          value={drivmiddel}
                          onChange={(e) => setDrivmiddel(e.target.value)}
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        >
                          {DRIVMIDDEL_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        {vehicle.autonomyPercentage && (
                          <span className="whitespace-nowrap text-brand-800">
                            {vehicle.autonomyPercentage}
                            {vehicle.autonomyPercentageUpdatedAt ? ` (${shortSignalTimestamp(vehicle.autonomyPercentageUpdatedAt)})` : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-[0.4fr_1fr] px-1 py-0.5 text-sm text-brand-700">
                      <div className="flex items-center justify-between whitespace-nowrap border-r border-brand-100 pr-1 font-medium">
                        Status:
                        {/* Same green/red online-state dot as the "Online" column elsewhere (AllBookingsPage.tsx/VehiclesPage.tsx) — right-aligned within this label field, not the value field. */}
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${vehicle.status === "Online" ? "bg-green-500" : "bg-red-500"}`}
                          title={vehicle.status}
                        />
                      </div>
                      <div className="whitespace-nowrap px-1">
                        {vehicle.status}
                        {vehicle.onlineUpdatedAt ? ` (${shortSignalTimestamp(vehicle.onlineUpdatedAt)})` : ""}
                      </div>
                    </div>
                    {/* Afdeling(er) + Hjemmeafdeling share this box rather
                        than being two separate rows in the outer field list
                        — they're tightly coupled (Hjemmeafdeling can only
                        ever be one of whichever departments are checked
                        "Tilladt" here). */}
                    <div className="rounded-none border border-brand-100 bg-brand-50/40">
                      <div>
                        {departmentOptions.length !== 1 && (
                          <div className="grid grid-cols-[0.4fr_1fr] items-start px-1 py-0.5 text-sm text-brand-700">
                            <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Afdeling(er):</label>
                            <div className="py-0.5">
                              {departmentsLoading && <span className="text-brand-500">Indlæser…</span>}
                              {!departmentsLoading && departmentsError && (
                                <span className="text-red-600">{departmentsError}</span>
                              )}
                              {!departmentsLoading && !departmentsError && (
                                <div className="max-h-32 overflow-auto rounded-none border border-brand-100">
                                  <table className="w-full border-collapse text-sm">
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
                                      {departmentOptions.map((department) => (
                                        <tr key={department.department_id}>
                                          <td className="whitespace-nowrap px-2 py-0.5 font-medium text-brand-700">
                                            {department.name}
                                          </td>
                                          <td className="px-2 py-0.5 text-center">
                                            <input
                                              type="checkbox"
                                              checked={selectedDepartmentIds.has(department.department_id)}
                                              onChange={(e) => toggleDepartment(department, e.target.checked)}
                                              className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500 disabled:cursor-not-allowed"
                                            />
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-sm text-brand-700">
                          <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Hjemmeafdeling:</div>
                          {departmentOptions.length === 1 || soleSelectedDepartment ? (
                            <input
                              type="text"
                              readOnly
                              disabled
                              value={departmentOptions.length === 1 ? departmentOptions[0].name : (soleSelectedDepartment?.name ?? "")}
                              className="cursor-not-allowed rounded-lg border border-brand-200 bg-brand-100/60 px-2 py-0.5 text-sm text-brand-800"
                            />
                          ) : (
                            <select
                              value={homeDepartmentId ?? ""}
                              onChange={(e) => setHomeDepartmentId(e.target.value || null)}
                              className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
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
                          )}
                        </div>
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
