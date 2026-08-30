import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useRefreshVehicles } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { QrScanButton } from "../components/QrScanButton";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { supabase } from "../lib/supabase";
import { DRIVMIDDEL_OPTIONS, formatVehicleIdentLabel } from "../lib/bookings";
import { motorApiDrivmiddel, motorApiVehicleField } from "../lib/motorApi";
import {
  boardProfileId,
  boardProfileLabel,
  narrowProfilesForVehicle,
  sortBoardProfiles,
  type TwoHireBoardProfile,
} from "../lib/twoHireProfiles";
import { stripNumberSpacing } from "../lib/textNormalization";

/** A pending "send-vehicle-request" submission — mirrors InstallationAdministrationPage.tsx's own CostumerOrder shape. Normally arrives pre-filled via router state (its table row click), but also fetchable by id alone (see the fetch-by-id effect below) so "/vehicle-create/:orderId" works as a direct link. */
type CostumerOrder = {
  order_id: string;
  costumer_id: string;
  department_id: string | null;
  /** Company-wide "Køretøj-ID" identifier — optional, see costumer_orders_add_vehicle_ident.sql. Null/empty falls back to number_plate wherever this is displayed (same convention as VehicleDetailsPage.tsx/HandleVehiclePage.tsx). */
  vehicle_ident: string | null;
  number_plate: string;
  /** Optional as of costumer_orders_brand_model_year_nullable.sql — no longer required on NewVehiclePage.tsx's "Ny bestilling" form, fillable/editable right here instead (see the "Mærke:"/"Model:"/"Årgang:" rows below, autofillable from MotorAPI via the Køretøj row's "i" button). */
  brand: string | null;
  model: string | null;
  model_year: string | null;
  /** vehicle_profiles.drivmiddel's own default ("Benzin") applies here too — see costumer_orders_add_drivmiddel.sql. Unlike brand/model/model_year, not nullable: a <select> always has a value, so there's no "not filled in yet" state to represent. */
  drivmiddel: string;
  needs_fleetii_device: boolean;
  fleetii_device_id: string | null;
  contactperson: string;
  contactemail: string | null;
  contactnumber: string;
  vehicle_registered: boolean;
  /** The real 2hire vehicleId once registered (see 2hire-register-vehicle.mts) — null until vehicle_registered is true. */
  vehicle_id: string | null;
  costumerName: string | null;
  departmentName: string | null;
};

/** Raw shape of the fetch-by-id query below, before flattening the embedded costumers(name)/departments(name) relations — mirrors InstallationAdministrationPage.tsx's own CostumerOrderQueryRow. */
type CostumerOrderQueryRow = {
  order_id: string;
  costumer_id: string;
  department_id: string | null;
  vehicle_ident: string | null;
  number_plate: string;
  /** Optional as of costumer_orders_brand_model_year_nullable.sql — no longer required on NewVehiclePage.tsx's "Ny bestilling" form, fillable/editable right here instead (see the "Mærke:"/"Model:"/"Årgang:" rows below, autofillable from MotorAPI via the Køretøj row's "i" button). */
  brand: string | null;
  model: string | null;
  model_year: string | null;
  drivmiddel: string;
  needs_fleetii_device: boolean;
  fleetii_device_id: string | null;
  contactperson: string;
  contactemail: string | null;
  contactnumber: string;
  vehicle_registered: boolean;
  vehicle_id: string | null;
  costumers: { name: string | null } | null;
  departments: { name: string | null } | null;
};

/**
 * "Opret køretøj" page — FLEETii-admin only (see ProtectedRoute
 * requireRole="FLEETii admin" in App.tsx — there's no reason for a
 * customer's own admin to see this, mirroring VehicleDeletePage.tsx's own
 * gating). Reachable at plain "/vehicle-create" (order passed via router
 * state — InstallationAdministrationPage's "Administration af installationer"
 * table row click) or "/vehicle-create/:orderId" (fetches the order by id —
 * a direct URL/refresh/bookmark with no router state, mirroring
 * UserDetailsPage.tsx's own fetch-by-id fallback). Missing both state and a
 * resolvable :orderId redirects back to "/fleetii-admin-installations". Shows everything
 * the admin submitted via NewVehiclePage.tsx's "Ny bestilling" so FLEETii
 * staff can see what needs provisioning, plus:
 *   - "Registrér køretøj i 2hire": the real action — takes the physical
 *     2hire-board device's printed QR code + a chosen 2hire profile,
 *     registers it with 2hire (2hire-register-vehicle.mts), and inserts the
 *     resulting vehicle into vehicle_profiles/vehicle_departments. This
 *     covers what used to be two separate manual-only steps ("register
 *     vehicle" and "associate IoT device") — 2hire's actual API has no
 *     separate endpoint for the second, a device's QR code IS what's being
 *     associated when it's registered. On success, this ALSO deletes this
 *     order's own costumer_orders row (its job is finished — the vehicle
 *     itself lives on in vehicle_profiles) and returns to
 *     "/fleetii-admin-installations", folding in what used to be a
 *     separate manual "Installation afsluttet - slettes" step: there was
 *     nothing left to actually confirm once registration itself succeeded.
 *     If registration succeeds but that cleanup delete itself fails, the
 *     admin stays on this page (now showing the registered-vehicle state)
 *     with the error surfaced, rather than pretending registration failed.
 */
export function VehicleCreatePage() {
  const { session } = useAuth();
  const refreshVehicles = useRefreshVehicles();
  const navigate = useNavigate();
  const location = useLocation();
  const { orderId } = useParams<{ orderId: string }>();
  const stateOrder = (location.state as { order?: CostumerOrder } | null)?.order ?? null;
  // undefined = "haven't fetched yet" (so `order` below falls back to
  // stateOrder for an instant first paint); null = "fetched, confirmed gone".
  // Same convention as CostumerDetailsPage.tsx's own fetchedCostumer —
  // fetchedOrder wins once it arrives, NOT stateOrder: browsers keep
  // history.state across a same-URL reload, so a plain browser refresh would
  // otherwise keep showing whatever was true at the moment this page was
  // first navigated to, silently ignoring any edit ("Opdater") made since —
  // confirmed live 2026-08-28 (a saved Brand edit reverted to the original
  // value after a refresh, purely because stateOrder never gets updated).
  const [fetchedOrder, setFetchedOrder] = useState<CostumerOrder | null | undefined>(undefined);
  const [orderLoading, setOrderLoading] = useState(false);
  const order = fetchedOrder !== undefined ? fetchedOrder : stateOrder;
  /** Whether this order's own department shows the "Køretøj-ID:" row below at all — see useIdentSettings' own doc comment. */
  const { useVehicleIdent } = useIdentSettings(order?.department_id ?? null);

  /** Always (re)fetches the order by id — even when router state already has one, since that state can be stale (see fetchedOrder's own comment above). stateOrder still avoids a loading flash for a normal navigation by giving the first paint something to show while this resolves. Naturally scoped to a FLEETii admin (any costumer) by costumer_orders' SELECT RLS policy — an orderId outside it just resolves to null, same as "not found". */
  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;
    setOrderLoading(true);
    void supabase
      .from("costumer_orders")
      .select(
        "order_id, costumer_id, department_id, vehicle_ident, number_plate, brand, model, model_year, drivmiddel, needs_fleetii_device, fleetii_device_id, contactperson, contactemail, contactnumber, vehicle_registered, vehicle_id, costumers(name), departments(name)",
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
                drivmiddel: data.drivmiddel,
                needs_fleetii_device: data.needs_fleetii_device,
                fleetii_device_id: data.fleetii_device_id,
                contactperson: data.contactperson,
                contactemail: data.contactemail,
                contactnumber: data.contactnumber,
                vehicle_registered: data.vehicle_registered,
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
  }, [orderId]);

  // Redirects back to the installations list once it's clear the order can't
  // be resolved: either no :orderId AND no router state at all (reached with
  // nothing to show), or a specific :orderId that came back empty (deleted,
  // or outside RLS) once the fetch has finished.
  useEffect(() => {
    if (!order && !orderLoading) {
      navigate("/fleetii-admin-installations", { replace: true });
    }
  }, [order, orderLoading, navigate]);

  const [vehicleRegistered, setVehicleRegistered] = useState(order?.vehicle_registered ?? false);
  const [registeredVehicleId, setRegisteredVehicleId] = useState(order?.vehicle_id ?? null);
  /** Editable Mærke/Model/Årgang — local state rather than reading order.brand/model/model_year directly, since these are editable inputs (see the "Mærke:"/"Model:"/"Årgang:" rows below). Only editable while isEditingOrder (see "Rediger" below) AND !vehicleRegistered: 2hire-register-vehicle.mts snapshots these onto the new vehicle_profiles row at registration time, so editing them afterward wouldn't retroactively change the already-created vehicle — misleading to allow. */
  const [brandInput, setBrandInput] = useState(order?.brand ?? "");
  const [modelInput, setModelInput] = useState(order?.model ?? "");
  const [modelYearInput, setModelYearInput] = useState(order?.model_year ?? "");
  /** Editable Drivmiddel — same local-state pattern as Mærke/Model/Årgang above, just a <select> instead of a free-text input (see the "Drivmiddel:" row below). */
  const [drivmiddelInput, setDrivmiddelInput] = useState(order?.drivmiddel ?? "Benzin");
  /** Editable Nummerplade/Kontaktperson/Kontakt e-mail/Kontakt tlf./FLEETii-device fields — same "local state, only editable while isEditingOrder" treatment as Brand/Mærke/Årgang/Drivmiddel above, added 2026-08-28 when "Rediger" was introduced to batch-edit every field on this review table together (previously only Brand/Mærke/Årgang/Drivmiddel were editable at all, and always-editable/auto-saving rather than behind a Rediger/Opdater/Fortryd toggle — see handleUpdateOrder/handleCancelEditOrder below). Køretøj-ID (vehicle_ident) and Kunde/Afdeling are deliberately NOT included: vehicle_ident is optional and rarely typed by the costumer in the first place, while Kunde/Afdeling are foreign keys with no picker on this page — reassigning either is a materially different, riskier operation than correcting a typo. */
  const [numberPlateInput, setNumberPlateInput] = useState(order?.number_plate ?? "");
  const [contactPersonInput, setContactPersonInput] = useState(order?.contactperson ?? "");
  const [contactEmailInput, setContactEmailInput] = useState(order?.contactemail ?? "");
  const [contactNumberInput, setContactNumberInput] = useState(order?.contactnumber ?? "");
  const [needsFleetiiDeviceInput, setNeedsFleetiiDeviceInput] = useState(order?.needs_fleetii_device ?? true);
  const [fleetiiDeviceIdInput, setFleetiiDeviceIdInput] = useState(order?.fleetii_device_id ?? "");
  /** Whether the review table below is in batch-edit mode — toggled by "Rediger" (only shown pre-registration, alongside "Slet"; both swap for "Fortryd"/"Opdater" while this is true). See handleUpdateOrder/handleCancelEditOrder and editSnapshotRef below. */
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [isSavingOrderEdit, setIsSavingOrderEdit] = useState(false);
  /** Snapshot of every editable *Input value taken the moment "Rediger" is pressed — NOT `order` itself, since `order` is a static, never-updated snapshot from router state/the fetch-by-id effect: after a first successful Opdater, a later Fortryd reverting to `order.*` would silently discard that already-saved edit and jump back to the ORIGINAL pre-any-edit values. Restored verbatim by handleCancelEditOrder ("Fortryd"). */
  const editSnapshotRef = useRef<{
    numberPlate: string;
    brand: string;
    model: string;
    modelYear: string;
    drivmiddel: string;
    contactPerson: string;
    contactEmail: string;
    contactNumber: string;
    needsFleetiiDevice: boolean;
    fleetiiDeviceId: string;
  } | null>(null);
  /** Whether the not-yet-registered "Slet" button's Ja/Fortryd confirmation dialog is open — see the ConfirmDialog rendered at the bottom of this component. */
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  /** Whether "Opdater"'s own Ja/Fortryd confirmation dialog is open — same guard treatment as "Slet"'s confirmDeleteOpen above. */
  const [confirmUpdateOpen, setConfirmUpdateOpen] = useState(false);
  const [orderEditError, setOrderEditError] = useState<string | null>(null);

  // Populates the step flags/vehicleId/editable fields once `order` resolves
  // asynchronously (the fetch-by-id path above) — the useState initializers
  // just above only run on the very first render, which happens before that
  // fetch can possibly have completed. Harmless no-op re-set on the (more
  // common) router-state path, where `order` is already correct on the first
  // render.
  useEffect(() => {
    if (!order) return;
    setVehicleRegistered(order.vehicle_registered);
    setRegisteredVehicleId(order.vehicle_id);
    setBrandInput(order.brand ?? "");
    setModelInput(order.model ?? "");
    setModelYearInput(order.model_year ?? "");
    setDrivmiddelInput(order.drivmiddel);
    setNumberPlateInput(order.number_plate);
    setContactPersonInput(order.contactperson);
    setContactEmailInput(order.contactemail ?? "");
    setContactNumberInput(order.contactnumber);
    setNeedsFleetiiDeviceInput(order.needs_fleetii_device);
    setFleetiiDeviceIdInput(order.fleetii_device_id ?? "");
  }, [order]);

  /** Whether every required field in the batch-edit form below is filled in — mirrors NewVehiclePage.tsx's own required-field rules for the same underlying columns (Nummerplade/Kontaktperson/Kontakt e-mail/Kontakt tlf. are all RequiredFieldRow there, so required here too; FLEETii device id required only when needsFleetiiDeviceInput is off). Gates "Opdater" below. */
  const canSubmitOrderEdit =
    numberPlateInput.trim().length > 0 &&
    contactPersonInput.trim().length > 0 &&
    contactEmailInput.trim().length > 0 &&
    contactNumberInput.trim().length > 0 &&
    (needsFleetiiDeviceInput || fleetiiDeviceIdInput.trim().length > 0);

  /** "Rediger" — snapshots the current editable values (so "Fortryd" has something correct to revert to, see editSnapshotRef above) and enters batch-edit mode. */
  const handleStartEditOrder = () => {
    editSnapshotRef.current = {
      numberPlate: numberPlateInput,
      brand: brandInput,
      model: modelInput,
      modelYear: modelYearInput,
      drivmiddel: drivmiddelInput,
      contactPerson: contactPersonInput,
      contactEmail: contactEmailInput,
      contactNumber: contactNumberInput,
      needsFleetiiDevice: needsFleetiiDeviceInput,
      fleetiiDeviceId: fleetiiDeviceIdInput,
    };
    setOrderEditError(null);
    setIsEditingOrder(true);
  };

  /** "Fortryd" (batch-edit mode) — restores every *Input back to editSnapshotRef's own values (NOT `order`, see its own doc comment above) and leaves edit mode without saving anything. */
  const handleCancelEditOrder = () => {
    const snapshot = editSnapshotRef.current;
    if (snapshot) {
      setNumberPlateInput(snapshot.numberPlate);
      setBrandInput(snapshot.brand);
      setModelInput(snapshot.model);
      setModelYearInput(snapshot.modelYear);
      setDrivmiddelInput(snapshot.drivmiddel);
      setContactPersonInput(snapshot.contactPerson);
      setContactEmailInput(snapshot.contactEmail);
      setContactNumberInput(snapshot.contactNumber);
      setNeedsFleetiiDeviceInput(snapshot.needsFleetiiDevice);
      setFleetiiDeviceIdInput(snapshot.fleetiiDeviceId);
    }
    setOrderEditError(null);
    setIsEditingOrder(false);
  };

  /** "Opdater" (batch-edit mode) — persists every editable field in ONE update, unlike the old per-field auto-save this replaced. Leaves edit mode on success; the *Input values already hold what was just saved, so nothing needs re-syncing from `order` (which never changes). */
  const handleUpdateOrder = async () => {
    if (!order || !canSubmitOrderEdit) return;

    setIsSavingOrderEdit(true);
    setOrderEditError(null);

    const { error } = await supabase
      .from("costumer_orders")
      .update({
        number_plate: numberPlateInput.trim(),
        brand: brandInput.trim() || null,
        model: modelInput.trim() || null,
        model_year: modelYearInput.trim() || null,
        drivmiddel: drivmiddelInput,
        contactperson: contactPersonInput.trim(),
        contactemail: contactEmailInput.trim() || null,
        contactnumber: contactNumberInput.trim(),
        needs_fleetii_device: needsFleetiiDeviceInput,
        fleetii_device_id: needsFleetiiDeviceInput ? null : fleetiiDeviceIdInput.trim() || null,
      })
      .eq("order_id", order.order_id);

    if (error) {
      setOrderEditError(error.message);
      setIsSavingOrderEdit(false);
      return;
    }

    setIsSavingOrderEdit(false);
    setIsEditingOrder(false);
    setConfirmUpdateOpen(false);
  };

  /** "Registrér køretøj i 2hire" form state — only relevant while !vehicleRegistered. */
  const [qrCode, setQrCode] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profiles, setProfiles] = useState<TwoHireBoardProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  /** "Slet" state (see handleDelete below) — a separate loading/error pair from isRegistering/registerError since the two actions are mutually exclusive (Slet is only ever shown alongside whichever of the register-button/registered-badge is currently rendered) but visually distinct outcomes. */
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** The maker -> model -> year hierarchy narrowing of `profiles` down to this order's own brand/model/model_year (see narrowProfilesForVehicle) — each level only actually narrows if doing so leaves at least one candidate, so this is virtually never empty once profiles have loaded. Always computed (not gated behind filterProfilesByOrder below) since it also drives the auto-select effect regardless of whether the admin has the narrowed view toggled on. */
  const narrowedProfiles = narrowProfilesForVehicle(profiles, {
    brand: brandInput,
    model: modelInput,
    model_year: modelYearInput,
  });
  /** Whether the "2hire-profil" picker's VISIBLE OPTIONS are narrowed to narrowedProfiles rather than the full catalog — on by default (see sortBoardProfiles below for the full list's own sort order); the auto-select effect below still pre-selects an unambiguous match either way. */
  const [filterProfilesByOrder, setFilterProfilesByOrder] = useState(true);
  const visibleProfiles = sortBoardProfiles(filterProfilesByOrder && order ? narrowedProfiles : profiles);
  /** The full profile object behind selectedProfileId (for the "i" JSON popup below) — null if nothing's selected, or if the id doesn't match any fetched profile. */
  const selectedProfile = profiles.find((profile) => boardProfileId(profile) === selectedProfileId) ?? null;

  /** Auto-selects a profile once narrowedProfiles pins down exactly one unambiguous match for this order's own brand/model/model_year — regardless of whether the narrowed view is actually toggled on, so the admin gets a sensible default the moment their vehicle's own fields uniquely identify a profile. Zero candidates (nothing fetched at all, or narrowing genuinely found nothing) or two-or-more candidates both leave the selection blank — a "no match" state is shown as plain text below rather than silently pre-selecting anything (previously fell back to the fixed 2hire test/simulator profile, a leftover from when this page's only usable environment WAS the test adaptor — now a real production catalog exists, silently picking that id would be actively wrong there). Only fires once profiles have actually loaded (not while loading/erroring), and only reacts to the *count* changing (not every re-render — narrowedProfiles is a fresh array each render), so a real manual selection among 2+ options is left alone as long as the candidate count doesn't change. */
  useEffect(() => {
    if (profilesLoading || profilesError) return;
    setSelectedProfileId(narrowedProfiles.length === 1 ? boardProfileId(narrowedProfiles[0]) : "");
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [narrowedProfiles.length, profilesLoading, profilesError]);

  /** Whether the "i" popup showing the selected profile's raw JSON (next to the filter button) is open — a plain click-to-toggle, not a timed notice, since this is content meant to be read/copied. */
  const [showProfileJson, setShowProfileJson] = useState(false);
  const profileJsonRef = useRef<HTMLDivElement>(null);

  /** Closes the profile-JSON popup on an outside click — same pattern as AllBookingsPage.tsx's own filter popover. */
  useEffect(() => {
    if (!showProfileJson) return;

    function handleClickOutside(event: MouseEvent) {
      if (profileJsonRef.current && !profileJsonRef.current.contains(event.target as Node)) {
        setShowProfileJson(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showProfileJson]);

  /** MotorAPI lookup (see motorapi-vehicle-lookup.mts) for the "i" button on the merged Køretøj row below — always keyed on order.number_plate (the real registration number), never vehicle_ident (MotorAPI has no notion of a company-internal identifier) — fetched lazily on first open rather than on mount, since MotorAPI usage counts against a daily quota. Combined { vehicle, environment, equipment } response, each independently either { data } or { error } (a used/older vehicle may simply have no environment/equipment data). */
  const [motorApiResult, setMotorApiResult] = useState<unknown>(null);
  const [motorApiLoading, setMotorApiLoading] = useState(false);
  const [motorApiError, setMotorApiError] = useState<string | null>(null);
  const [showMotorApiPopup, setShowMotorApiPopup] = useState(false);
  const motorApiRef = useRef<HTMLDivElement>(null);

  /** Closes the MotorAPI popup on an outside click — same pattern as the profile-JSON popup above. */
  useEffect(() => {
    if (!showMotorApiPopup) return;

    function handleClickOutside(event: MouseEvent) {
      if (motorApiRef.current && !motorApiRef.current.contains(event.target as Node)) {
        setShowMotorApiPopup(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMotorApiPopup]);

  /** Whether the "Kun mulig hvis redigering er aktiv" notice (shown when the MotorAPI button is clicked outside "Rediger" mode — see handleOpenMotorApiPopup below) is visible. Auto-hides after 3s, same timed-notice pattern as FleetManagementPage.tsx's own showEmptyNotice. */
  const [showEditRequiredNotice, setShowEditRequiredNotice] = useState(false);
  useEffect(() => {
    if (!showEditRequiredNotice) return;
    const timeout = setTimeout(() => setShowEditRequiredNotice(false), 3000);
    return () => clearTimeout(timeout);
  }, [showEditRequiredNotice]);

  /** Fills Mærke/Model/Årgang/Drivmiddel from a MotorAPI result — replaces what used to be four separate per-field "↓↙" fill buttons the admin had to click individually; now it all happens together whenever the "i" button's lookup data is (re)applied, see handleOpenMotorApiPopup below. Only while isEditingOrder ("Rediger" — these fields are only meant to change during a batch-edit, see the render branches below) AND !vehicleRegistered (once registered they're locked forever), and only overwrites a field MotorAPI actually has a value for, same as each old button's own individual behavior. Only sets local *Input state — no longer persists on its own (previously called saveOrderField immediately, comparing against order.brand/model/model_year: since those never change after the FIRST save, that comparison went stale after any Opdater and could also silently skip a real save, plus the immediate persist bypassed "Fortryd" entirely). Persisting now goes through the same handleUpdateOrder ("Opdater") batch save as every other manually-typed field. */
  const autofillFromMotorApi = (result: unknown) => {
    if (vehicleRegistered || !order || !isEditingOrder) return;

    const brandValue = motorApiVehicleField(result, ["make"]);
    if (brandValue) setBrandInput(brandValue);

    const modelValue =
      [motorApiVehicleField(result, ["model"]), motorApiVehicleField(result, ["variant"])].filter(Boolean).join(" ") || null;
    if (modelValue) setModelInput(modelValue);

    const modelYearValue = motorApiVehicleField(result, ["model_year"]);
    if (modelYearValue) setModelYearInput(modelYearValue);

    const drivmiddelValue = motorApiDrivmiddel(result);
    if (drivmiddelValue) setDrivmiddelInput(drivmiddelValue);
  };

  /** Fetches the MotorAPI lookup exactly once and caches it in motorApiResult — every caller (handleOpenMotorApiPopup below) goes through this single guarded entry point, so no combination of clicks ever triggers a second network call once a result (or an in-flight request) already exists. MotorAPI usage counts against a daily quota, so this matters beyond just avoiding redundant work. On success, also runs autofillFromMotorApi once with the fresh result — handleOpenMotorApiPopup is responsible for re-running autofillFromMotorApi against the cached result on later opens, since this function itself won't fire again once motorApiResult is populated. */
  const ensureMotorApiDataLoaded = () => {
    if (motorApiResult !== null || motorApiLoading || !order) return;

    setMotorApiLoading(true);
    setMotorApiError(null);
    // Stripped of ALL whitespace (not just trimmed) — passed on to MotorAPI,
    // which expects the plain registration number, not a spaced-out one.
    void fetch(`/.netlify/functions/motorapi-vehicle-lookup?regNo=${encodeURIComponent(stripNumberSpacing(order.number_plate))}`, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    })
      .then(async (response) => {
        const result = (await response.json()) as unknown;
        if (!response.ok) {
          const message = (result as { error?: string } | null)?.error ?? "Kunne ikke hente data fra MotorAPI.";
          setMotorApiError(message);
          setMotorApiLoading(false);
          return;
        }
        setMotorApiResult(result);
        autofillFromMotorApi(result);
        setMotorApiLoading(false);
      })
      .catch(() => {
        setMotorApiError("Kunne ikke kontakte serveren. Prøv igen senere.");
        setMotorApiLoading(false);
      });
  };

  /** Opens the MotorAPI popup — only while isEditingOrder ("Rediger"), since the whole point is autofilling Mærke/Model/Årgang/Drivmiddel, which are only editable then anyway; outside edit mode this just flashes showEditRequiredNotice instead of doing anything (button stays visible either way, unlike the old vehicleRegistered-only guard, since "not editing yet" is a much more common/expected state to click it in than "already registered"). First-ever open fetches+caches the data (ensureMotorApiDataLoaded, which also autofills once on success); every later open reuses the cached motorApiResult — no new network call (quota) — but still re-runs autofillFromMotorApi against it, so re-opening while isEditingOrder re-applies MotorAPI's values even if the admin has since typed something else in, or entered a fresh "Rediger" session after an earlier Opdater. A plain close (re-click while already open) does neither. */
  const handleOpenMotorApiPopup = () => {
    if (!isEditingOrder) {
      setShowEditRequiredNotice(true);
      return;
    }

    const opening = !showMotorApiPopup;
    setShowMotorApiPopup(opening);
    if (!opening) return;
    if (motorApiResult !== null) {
      autofillFromMotorApi(motorApiResult);
      return;
    }
    ensureMotorApiDataLoaded();
  };

  /** Loads 2hire's own board profiles for the picker above — skipped once the vehicle is already registered (no longer needed). costumerId is required by the Function since which 2hire credential answers this depends on it (see the "per-costumer 2hire credentials" plan). */
  useEffect(() => {
    if (order?.vehicle_registered || !order?.costumer_id) return;

    let cancelled = false;
    setProfilesLoading(true);
    setProfilesError(null);
    void fetch(`/.netlify/functions/2hire-board-profiles?costumerId=${encodeURIComponent(order.costumer_id)}`, {
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
  }, [session, order?.vehicle_registered, order?.costumer_id]);

  // Only while a SPECIFIC order is being fetched by id (:orderId present, no
  // router state yet) — without this guard, the page would flash-redirect
  // toward "/fleetii-admin-installations" for a moment before the fetch resolves.
  if (orderId && !order && orderLoading) {
    return (
      <div className="flex h-svh items-center justify-center bg-brand-50 text-brand-600">Indlæser bestilling…</div>
    );
  }

  if (!order) {
    return null;
  }

  /** The real fulfillment action — registers the physical device with 2hire, inserts the resulting vehicle into vehicle_profiles/vehicle_departments (see 2hire-register-vehicle.mts's own doc comment for the full sequence), then deletes this order's own costumer_orders row now that its job is finished (the vehicle itself lives on in vehicle_profiles) and returns to "/fleetii-admin-installations" — folding in what used to be a separate manual "Installation afsluttet - slettes" step, since there was nothing left to actually confirm once registration itself succeeded. If registration succeeds but that cleanup delete fails, stays on this page (now showing the registered-vehicle state below) with the error surfaced, rather than pretending registration itself failed. */
  const handleRegisterVehicle = async () => {
    setIsRegistering(true);
    setRegisterError(null);

    // Human-readable label for vehicle_profiles.twohire_profile (see
    // 2hire-register-vehicle.mts) — the profile id alone wouldn't be
    // directly displayable later on VehicleDetailsPage.tsx/HandleVehiclePage.tsx
    // without a live 2hire lookup, so the label this admin actually SAW when
    // picking it is what gets stored.
    const profileLabel = selectedProfile ? boardProfileLabel(selectedProfile) : null;

    try {
      const response = await fetch("/.netlify/functions/2hire-register-vehicle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          orderId: order.order_id,
          qrCode: qrCode.trim(),
          profileId: selectedProfileId,
          profileLabel,
        }),
      });

      const result = (await response.json()) as { ok?: boolean; vehicleId?: string; error?: string };

      if (!response.ok) {
        setRegisterError(result.error ?? "Kunne ikke registrere køretøjet.");
        setIsRegistering(false);
        return;
      }

      setVehicleRegistered(true);
      setRegisteredVehicleId(result.vehicleId ?? null);
      await refreshVehicles();
    } catch {
      setRegisterError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsRegistering(false);
      return;
    }

    const { error: deleteError } = await supabase.from("costumer_orders").delete().eq("order_id", order.order_id);
    if (deleteError) {
      setRegisterError(`Køretøjet blev registreret, men bestillingen kunne ikke ryddes op: ${deleteError.message}`);
      setIsRegistering(false);
      return;
    }

    navigate("/fleetii-admin-installations", { replace: true });
  };

  /**
   * "Slet" — cancels this order. What that actually means depends on
   * whether QR-kode/2hire-profil have already been registered
   * (vehicleRegistered, with a real registeredVehicleId): if so, there's a
   * real vehicle_profiles row and possibly a real 2hire registration now, so
   * this does exactly what VehicleDeletePage.tsx's own terminal "Slet
   * køretøj i FLEETii og 2hire" button does — deregisters from 2hire
   * (best-effort) and deletes the vehicle from our own DB via
   * delete-vehicle.mts, which also cleans up this order's own
   * costumer_orders row (the case this normally leaves for — see
   * handleRegisterVehicle's own cleanup-delete above, which can fail and
   * strand the order row here alongside an already-registered vehicle).
   * Otherwise nothing was ever created outside costumer_orders itself, so
   * deleting just removes this pending order row directly.
   */
  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);

    if (vehicleRegistered && registeredVehicleId) {
      try {
        const response = await fetch("/.netlify/functions/delete-vehicle", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ vehicleId: registeredVehicleId, orderId: order.order_id }),
        });

        const result = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok) {
          setDeleteError(result.error ?? "Kunne ikke slette køretøjet.");
          setIsDeleting(false);
          return;
        }
      } catch {
        setDeleteError("Kunne ikke kontakte serveren. Prøv igen senere.");
        setIsDeleting(false);
        return;
      }

      await refreshVehicles();
    } else {
      const { error: orderDeleteError } = await supabase.from("costumer_orders").delete().eq("order_id", order.order_id);
      if (orderDeleteError) {
        setDeleteError(orderDeleteError.message);
        setIsDeleting(false);
        return;
      }
    }

    navigate("/fleetii-admin-installations", { replace: true });
  };

  const rows: [string, string][] = [
    ["Kunde:", order.costumerName ?? "—"],
    ["Afdeling:", order.departmentName ?? "—"],
    // Single merged row (was two: "Køretøj-ID:" + "Nummerplade:") —
    // "{vehicle_ident} - {number_plate}" when this order's department shows
    // vehicle_ident AND it's actually set, else just number_plate — same
    // design as VehicleDetailsPage.tsx's own merged "Køretøj:" row, just
    // labeled "Nummerplade:" here instead (this page's own choice, not
    // matched on VehicleDetailsPage).
    ["Nummerplade:", formatVehicleIdentLabel(order.vehicle_ident, numberPlateInput, useVehicleIdent)],
    ["Mærke:", brandInput || "—"],
    ["Model:", modelInput || "—"],
    ["Årgang:", modelYearInput || "—"],
    ["Drivmiddel:", drivmiddelInput],
    ["Kontaktperson:", contactPersonInput],
    ["Kontakt e-mail:", contactEmailInput || "—"],
    ["Kontakt tlf.:", contactNumberInput],
    [
      "FLEETii device:",
      needsFleetiiDeviceInput ? "Nyt device skal installeres" : `Eksisterende device (id: ${fleetiiDeviceIdInput || "—"})`,
    ],
    ...(registeredVehicleId ? ([["2hire vehicle-id:", registeredVehicleId]] as [string, string][]) : []),
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
            <h2 className="text-xl font-semibold text-brand-800">Opret køretøj</h2>

            <div className="rounded-2xl border border-brand-100">
              <div className="divide-y divide-brand-100 rounded-2xl bg-white">
                {rows.map(([label, value]) => {
                  // Drivmiddel is a fixed choice (see DRIVMIDDEL_OPTIONS),
                  // so it gets its own <select> branch here instead of joining
                  // the generic editableField handling below — but otherwise
                  // matches Mærke/Model/Årgang's row shape exactly. Editable
                  // while isEditingOrder ("Rediger", see below) AND
                  // !vehicleRegistered — once vehicleRegistered, this falls
                  // through to the plain read-only span at the bottom of this
                  // map. MotorAPI no longer fills this via a per-field button
                  // here — see autofillFromMotorApi, run once as a whole
                  // right when the "i" button on the Nummerplade row below
                  // loads the data.
                  if (label === "Drivmiddel:" && isEditingOrder && !vehicleRegistered) {
                    return (
                      <div key={label} className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">{label}</label>
                        <select
                          value={drivmiddelInput}
                          onChange={(e) => setDrivmiddelInput(e.target.value)}
                          className="w-full min-w-0 rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        >
                          {DRIVMIDDEL_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }

                  /** Mærke/Model/Årgang/Nummerplade/Kontaktperson/Kontakt e-mail/Kontakt tlf. are all plain-text edits — editable while isEditingOrder AND !vehicleRegistered (2hire-register-vehicle.mts snapshots brand/model/model_year onto vehicle_profiles at registration time, so editing them afterward wouldn't change anything real; the whole batch-edit form is scoped to the not-yet-registered state regardless, see "Rediger" below). All saved together by handleUpdateOrder ("Opdater") — no more per-field auto-save on blur. */
                  const editableField =
                    label === "Nummerplade:"
                      ? { value: numberPlateInput, setValue: setNumberPlateInput }
                      : label === "Mærke:"
                        ? { value: brandInput, setValue: setBrandInput }
                        : label === "Model:"
                          ? { value: modelInput, setValue: setModelInput }
                          : label === "Årgang:"
                            ? { value: modelYearInput, setValue: setModelYearInput }
                            : label === "Kontaktperson:"
                              ? { value: contactPersonInput, setValue: setContactPersonInput }
                              : label === "Kontakt e-mail:"
                                ? { value: contactEmailInput, setValue: setContactEmailInput }
                                : label === "Kontakt tlf.:"
                                  ? { value: contactNumberInput, setValue: setContactNumberInput }
                                  : null;

                  // Nummerplade keeps its MotorAPI lookup button alongside the input while editing — same button/popup as the read-only branch further below, just paired with an input instead of a plain span.
                  if (editableField && label === "Nummerplade:" && isEditingOrder && !vehicleRegistered) {
                    return (
                      <div key={label} className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">{label}</label>
                        <div className="flex min-w-0 items-center gap-1">
                          <input
                            type="text"
                            value={editableField.value}
                            onChange={(e) => editableField.setValue(e.target.value)}
                            className="min-w-0 flex-1 rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                          />
                          <div className="relative shrink-0" ref={motorApiRef}>
                            <button
                              type="button"
                              onClick={handleOpenMotorApiPopup}
                              aria-label="Slå nummerplade op i MotorAPI og udfyld Mærke/Model/Årgang/Drivmiddel"
                              title="Slå op i MotorAPI"
                              className="flex h-5 w-5 items-center justify-center rounded-full border border-brand-300 text-brand-600 transition"
                            >
                              {motorApiLoading ? (
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
                            <InlinePopup
                              visible={showMotorApiPopup}
                              align="right"
                              message={
                                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[0.65rem]">
                                  {motorApiLoading
                                    ? "Henter fra MotorAPI…"
                                    : motorApiError
                                      ? motorApiError
                                      : JSON.stringify(motorApiResult, null, 2)}
                                </pre>
                              }
                            />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (editableField && isEditingOrder && !vehicleRegistered) {
                    return (
                      <div key={label} className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">{label}</label>
                        <input
                          type="text"
                          value={editableField.value}
                          onChange={(e) => editableField.setValue(e.target.value)}
                          className="w-full min-w-0 rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      </div>
                    );
                  }

                  // FLEETii device combines two columns (needs_fleetii_device/fleetii_device_id) into one displayed row — same special-casing as Drivmiddel/Nummerplade above, editable while isEditingOrder.
                  if (label === "FLEETii device:" && isEditingOrder && !vehicleRegistered) {
                    return (
                      <div key={label} className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">{label}</label>
                        <div className="flex min-w-0 items-center gap-2">
                          <label className="flex items-center gap-1 text-sm text-brand-800">
                            <input
                              type="checkbox"
                              checked={needsFleetiiDeviceInput}
                              onChange={(e) => setNeedsFleetiiDeviceInput(e.target.checked)}
                              className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500"
                            />
                            Nyt device
                          </label>
                          {!needsFleetiiDeviceInput && (
                            <input
                              type="text"
                              value={fleetiiDeviceIdInput}
                              onChange={(e) => setFleetiiDeviceIdInput(e.target.value)}
                              placeholder="device id"
                              className="min-w-0 flex-1 rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                            />
                          )}
                        </div>
                      </div>
                    );
                  }

                  return label === "Nummerplade:" ? (
                    <div key={label} className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">{label}</label>
                      <div className="flex min-w-0 items-center gap-1">
                        {/* Plain text, same transparent-border look as Kunde/Afdeling/every other genuinely non-editable row below — a bordered input-shaped box here would visually claim this field is editable when it isn't. */}
                        <span className="min-w-0 flex-1 truncate rounded-lg border border-transparent px-2 py-0.5 text-sm text-brand-800">{value}</span>
                        {/* Right-aligned in the value column, not the label column. On the transition into "open", this ALSO autofills Mærke/Model/Årgang/Drivmiddel below from the same lookup (see ensureMotorApiDataLoaded/autofillFromMotorApi) — there's no separate per-field fill button anymore. */}
                        <div className="relative shrink-0" ref={motorApiRef}>
                          {/* Same lookup-button look as CostumerNewPage.tsx's CVR lookup (magnifying glass, spinner while in flight) — replaced the old plain "i" glyph so both external-lookup buttons in the app read the same way. */}
                          <button
                            type="button"
                            onClick={handleOpenMotorApiPopup}
                            aria-label="Slå nummerplade op i MotorAPI og udfyld Mærke/Model/Årgang/Drivmiddel"
                            title="Slå op i MotorAPI"
                            className="flex h-5 w-5 items-center justify-center rounded-full border border-brand-300 text-brand-600 transition"
                          >
                            {motorApiLoading ? (
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
                          <InlinePopup
                            visible={showMotorApiPopup}
                            align="right"
                            message={
                              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[0.65rem]">
                                {motorApiLoading
                                  ? "Henter fra MotorAPI…"
                                  : motorApiError
                                    ? motorApiError
                                    : JSON.stringify(motorApiResult, null, 2)}
                              </pre>
                            }
                          />
                          <InlinePopup
                            visible={showEditRequiredNotice}
                            align="right"
                            message="Kun mulig hvis redigering er aktiv"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={label} className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">{label}</label>
                      {/* Matches the editable inputs' own border/padding (just transparent) so its text lines up with theirs instead of sitting flush left — same trick as CostumerDetailsPage's locked CVR row. */}
                      <span className="rounded-lg border border-transparent px-2 py-0.5 text-sm text-brand-800">{value}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
              {vehicleRegistered ? (
                <div className="flex flex-row gap-3">
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={isDeleting}
                    className="flex-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDeleting ? "Sletter…" : "Slet"}
                  </button>
                  <span className="flex flex-1 items-center justify-center rounded-lg bg-green-600 px-2 py-1.5 text-center text-sm font-semibold text-white">
                    ✓ Køretøj registreret i 2hire
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
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
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-sm font-medium text-brand-700">2hire-profil:</label>
                          <div className="flex items-center gap-1">
                            <div className="relative" ref={profileJsonRef}>
                              <button
                                type="button"
                                onClick={() => setShowProfileJson((prev) => !prev)}
                                aria-label="Vis valgt profil, eller hele profil-listen, som JSON"
                                className="flex h-5 w-5 items-center justify-center rounded-full border border-brand-300 font-serif text-[0.7rem] font-bold italic leading-none text-brand-600 transition hover:bg-brand-50"
                              >
                                i
                              </button>
                              <InlinePopup
                                visible={showProfileJson}
                                align="right"
                                message={
                                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[0.65rem]">
                                    {selectedProfile
                                      ? JSON.stringify(selectedProfile, null, 2)
                                      : selectedProfileId
                                        ? `Ingen profildata fundet for id: ${selectedProfileId}`
                                        : profiles.length > 0
                                          ? // No profile picked yet — dumps 2hire's ENTIRE raw fetched list instead (not just visibleProfiles, which may already be narrowed), so the actual field shapes/values 2hire returns are inspectable without needing DevTools — this is what narrowProfilesForVehicle's makerName/modelName/modelYearRange matching logic (src/lib/twoHireProfiles.ts) is keyed on, so it's the fastest way to diagnose why the narrowing isn't behaving as expected.
                                            JSON.stringify(profiles, null, 2)
                                          : "Ingen profiler indlæst."}
                                  </pre>
                                }
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setFilterProfilesByOrder((prev) => !prev);
                                setSelectedProfileId("");
                              }}
                              aria-label={filterProfilesByOrder ? "Vis alle 2hire-profiler" : "Filtrér efter køretøjets mærke/model/årgang"}
                              title={filterProfilesByOrder ? "Vis alle 2hire-profiler" : "Filtrér efter køretøjets mærke/model/årgang"}
                              className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                                filterProfilesByOrder
                                  ? "border-red-500 bg-red-50 text-red-600 hover:bg-red-100"
                                  : "border-brand-300 text-brand-600 hover:bg-brand-50"
                              }`}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                                <polygon points="4 4 20 4 14 12.5 14 19 10 21 10 12.5 4 4" />
                              </svg>
                            </button>
                            {visibleProfiles.length > 1 && (
                              <span
                                title={`${visibleProfiles.length} profiler i listen`}
                                className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-600 px-1 text-[0.65rem] font-semibold text-white"
                              >
                                {visibleProfiles.length}
                              </span>
                            )}
                          </div>
                        </div>
                        {profilesLoading ? (
                          <span className="text-sm text-brand-500">Indlæser…</span>
                        ) : profilesError ? (
                          <span className="text-sm text-red-600">{profilesError}</span>
                        ) : visibleProfiles.length === 0 ? (
                          <span className="text-sm font-medium text-red-600">Ingen profil matcher køretøjet</span>
                        ) : (
                          <select
                            value={selectedProfileId}
                            onChange={(e) => setSelectedProfileId(e.target.value)}
                            className="rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                          >
                            <option value="">Vælg profil…</option>
                            {visibleProfiles.map((profile) => (
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
                      disabled={!qrCode.trim() || !selectedProfileId || isRegistering || isDeleting || isEditingOrder}
                      onClick={() => void handleRegisterVehicle()}
                      className="w-full rounded-lg border border-brand-200 bg-white px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isRegistering ? "Registrerer…" : "Registrér køretøj i 2hire"}
                    </button>
                  </div>
                  {orderEditError && <p className="text-sm text-red-600">{orderEditError}</p>}
                  {isEditingOrder ? (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={handleCancelEditOrder}
                        disabled={isSavingOrderEdit}
                        className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Fortryd
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmUpdateOpen(true)}
                        disabled={!canSubmitOrderEdit || isSavingOrderEdit}
                        className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSavingOrderEdit ? "Opdaterer…" : "Opdater"}
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={handleStartEditOrder}
                        disabled={isRegistering}
                        className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Rediger
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteOpen(true)}
                        disabled={isDeleting || isRegistering}
                        className="rounded-lg border-2 border-red-600 bg-white px-2 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Slet
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </motion.main>
      </div>

      {confirmDeleteOpen && (
        <ConfirmDialog
          message="Er du sikker på, at du vil slette denne bestilling?"
          error={deleteError}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={() => void handleDelete()}
          isPending={isDeleting}
          confirmPendingLabel="Sletter…"
        />
      )}

      {confirmUpdateOpen && (
        <ConfirmDialog
          message="Er du sikker på, at du vil opdatere denne bestilling?"
          error={orderEditError}
          onCancel={() => setConfirmUpdateOpen(false)}
          onConfirm={() => void handleUpdateOrder()}
          isPending={isSavingOrderEdit}
          confirmPendingLabel="Opdaterer…"
        />
      )}
    </div>
  );
}
