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
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";
import { formatVehicleIdentLabel } from "../lib/bookings";

/** A pending "send-vehicle-request" submission — mirrors FleetiiAdministrationPage.tsx's own CostumerOrder shape. Normally arrives pre-filled via router state (its table row click), but also fetchable by id alone (see the fetch-by-id effect below) so "/vehicle-create/:orderId" works as a direct link. */
type CostumerOrder = {
  order_id: string;
  costumer_id: string;
  department_id: string | null;
  /** Company-wide "Køretøj-ID" identifier — optional, see costumer_orders_add_vehicle_ident.sql. Null/empty falls back to number_plate wherever this is displayed (same convention as VehicleDetailsPage.tsx/HandleVehiclePage.tsx). */
  vehicle_ident: string | null;
  number_plate: string;
  /** Optional as of costumer_orders_brand_model_year_nullable.sql — no longer required on NewVehiclePage.tsx's "Ny bestilling" form, fillable/editable right here instead (see the "Brand:"/"Mærke:"/"Årgang:" rows below, incl. the MotorAPI fill button). */
  brand: string | null;
  model: string | null;
  model_year: string | null;
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
  /** Optional as of costumer_orders_brand_model_year_nullable.sql — no longer required on NewVehiclePage.tsx's "Ny bestilling" form, fillable/editable right here instead (see the "Brand:"/"Mærke:"/"Årgang:" rows below, incl. the MotorAPI fill button). */
  brand: string | null;
  model: string | null;
  model_year: string | null;
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

/** 2hire's fixed profile id for any simulated device — per 2hire's own "Guide to test..." documentation: "In order to configure simulators, the profile id 51ba5b28-28da-435a-b42e-a3931288470c need to be used." Used below as the automatic fallback selection whenever no real profile is available to pick from. */
const TWOHIRE_SIMULATOR_PROFILE_ID = "51ba5b28-28da-435a-b42e-a3931288470c";

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

/** Lowercases and strips everything but letters/digits, so "MERCEDES_BENZ" (this app's own brand spelling) and a 2hire makerName like "Mercedes-Benz" compare equal regardless of case/separator style. */
function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Extracts every 4-digit year found in a free-text "Årgang" value (e.g. "2014-2025", "2020", "ca. 2019") and returns [min, max] — null if none found, so callers can treat an unparseable year as "don't filter on year" rather than wrongly excluding every profile. */
function parseOrderYearRange(value: string): [number, number] | null {
  const years = [...value.matchAll(/\d{4}/g)].map((m) => Number(m[0]));
  if (years.length === 0) return null;
  return [Math.min(...years), Math.max(...years)];
}

/** Whether a 2hire board profile is a plausible match for this order's own brand/model/model_year — matched leniently in both directions (either string containing the other) since neither this app's free-text brand/model fields nor 2hire's makerName/modelName are guaranteed to be spelled identically. Year matches on range overlap (order.model_year is itself often a range like "2014-2025", not a single year). Missing/unparseable data on either side passes rather than excludes, so a profile is only ever filtered OUT on a genuine mismatch, never on missing info. */
function profileMatchesOrder(profile: TwoHireBoardProfile, order: { brand: string; model: string; model_year: string }): boolean {
  const maker = normalizeForMatch(typeof profile.makerName === "string" ? profile.makerName : "");
  const orderBrand = normalizeForMatch(order.brand);
  const makerMatches = !maker || !orderBrand || maker.includes(orderBrand) || orderBrand.includes(maker);

  const modelName = normalizeForMatch(typeof profile.modelName === "string" ? profile.modelName : "");
  const orderModel = normalizeForMatch(order.model);
  const modelMatches = !modelName || !orderModel || modelName.includes(orderModel) || orderModel.includes(modelName);

  const profileYearRange =
    Array.isArray(profile.modelYearRange) &&
    profile.modelYearRange.length === 2 &&
    typeof profile.modelYearRange[0] === "number" &&
    typeof profile.modelYearRange[1] === "number"
      ? (profile.modelYearRange as [number, number])
      : null;
  const orderYearRange = parseOrderYearRange(order.model_year);
  const yearMatches =
    !profileYearRange || !orderYearRange || (orderYearRange[1] >= profileYearRange[0] && orderYearRange[0] <= profileYearRange[1]);

  return makerMatches && modelMatches && yearMatches;
}

/** Pulls the first present, non-empty field (in priority order) out of the MotorAPI vehicle lookup's "vehicle" section (see motorapi-vehicle-lookup.mts — the { data } | { error } shape). Field names (make/model/variant/model_year) are confirmed real, not guessed — the "i" button's JSON popup shows the raw response if MotorAPI ever changes shape. */
function motorApiVehicleField(motorApiResult: unknown, keys: string[]): string | null {
  if (!motorApiResult || typeof motorApiResult !== "object") return null;
  const vehicleSection = (motorApiResult as { vehicle?: unknown }).vehicle;
  if (!vehicleSection || typeof vehicleSection !== "object" || !("data" in vehicleSection)) return null;
  const data = (vehicleSection as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;

  for (const key of keys) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
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
  /** Editable Brand/Mærke/Årgang — local state rather than reading order.brand/model/model_year directly, since these are now editable inputs (see the "Brand:"/"Mærke:"/"Årgang:" rows below) that persist to costumer_orders on blur (saveOrderField). Only editable while !vehicleRegistered: 2hire-register-vehicle.mts snapshots these onto the new vehicle_profiles row at registration time, so editing them afterward wouldn't retroactively change the already-created vehicle — misleading to allow. */
  const [brandInput, setBrandInput] = useState(order?.brand ?? "");
  const [modelInput, setModelInput] = useState(order?.model ?? "");
  const [modelYearInput, setModelYearInput] = useState(order?.model_year ?? "");
  const [orderFieldSaveError, setOrderFieldSaveError] = useState<string | null>(null);

  // Populates the step flags/vehicleId/editable fields once `order` resolves
  // asynchronously (the fetch-by-id path above) — the useState initializers
  // just above only run on the very first render, which happens before that
  // fetch can possibly have completed. Harmless no-op re-set on the (more
  // common) router-state path, where `order` is already correct on the first
  // render.
  useEffect(() => {
    if (!order) return;
    setVehicleRegistered(order.vehicle_registered);
    setIotDeviceAssociated(order.iot_device_associated);
    setOther2hireDone(order.other_2hire_done);
    setRegisteredVehicleId(order.vehicle_id);
    setBrandInput(order.brand ?? "");
    setModelInput(order.model ?? "");
    setModelYearInput(order.model_year ?? "");
  }, [order]);

  /** Persists a single edited Brand/Mærke/Årgang field to costumer_orders on blur — same direct-update pattern as markOtherStepDone/reactivateOtherStep below. Only called with a genuinely changed, non-empty trimmed value (see the input's onBlur handlers). */
  const saveOrderField = async (field: "brand" | "model" | "model_year", value: string) => {
    if (!order) return;
    setOrderFieldSaveError(null);
    const { error } = await supabase.from("costumer_orders").update({ [field]: value }).eq("order_id", order.order_id);
    if (error) {
      setOrderFieldSaveError(error.message);
    }
  };

  /** "Registrér køretøj i 2hire" form state — only relevant while !vehicleRegistered. */
  const [qrCode, setQrCode] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profiles, setProfiles] = useState<TwoHireBoardProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  /** Whether the "2hire-profil" picker below is narrowed to profiles matching this order's own brand/model/model_year (see profileMatchesOrder) — off by default: today's only environment (2hire's test/simulator adaptor) has exactly one profile, which never matches a real vehicle's brand/model, so defaulting to filtered would hide the only usable option on every single registration right now. Toggle it on once real production credentials expose an actual make/model catalog worth narrowing. */
  const [filterProfilesByOrder, setFilterProfilesByOrder] = useState(false);
  const visibleProfiles =
    filterProfilesByOrder && order
      ? profiles.filter((profile) =>
          profileMatchesOrder(profile, { brand: brandInput, model: modelInput, model_year: modelYearInput }),
        )
      : profiles;
  /** The full profile object behind selectedProfileId (for the "i" JSON popup below) — null if nothing's selected, or if the id doesn't match any fetched profile (e.g. TWOHIRE_SIMULATOR_PROFILE_ID auto-selected below when the real API response happens not to include it). */
  const selectedProfile = profiles.find((profile) => boardProfileId(profile) === selectedProfileId) ?? null;

  /** Auto-selects a profile whenever there's exactly one (or zero) to pick from, so the admin isn't left clicking a single-option dropdown or an empty one: zero visible profiles falls back to the fixed simulator profile (see TWOHIRE_SIMULATOR_PROFILE_ID's own doc comment — otherwise every registration under today's test/simulator 2hire environment would require manually toggling the filter off and picking the one simulator entry by hand); exactly one visible profile (filtered down to a single match, or the catalog itself only has one) is selected outright; two or more leaves selection blank for the admin to actually choose. Only fires once profiles have actually loaded (not while loading/erroring), and only reacts to the *count* changing (not every re-render — visibleProfiles is a fresh array each render), so a real manual selection among 2+ options is left alone as long as the visible list's size doesn't change. */
  useEffect(() => {
    if (profilesLoading || profilesError) return;
    if (visibleProfiles.length === 0) {
      setSelectedProfileId(TWOHIRE_SIMULATOR_PROFILE_ID);
    } else if (visibleProfiles.length === 1) {
      setSelectedProfileId(boardProfileId(visibleProfiles[0]));
    } else {
      setSelectedProfileId("");
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProfiles.length, profilesLoading, profilesError]);

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

  /** MotorAPI lookup (see motorapi-vehicle-lookup.mts) for the "i" button on the Nummerplade row below — fetched lazily on first open rather than on mount, since MotorAPI usage counts against a daily quota. Combined { vehicle, environment, equipment } response, each independently either { data } or { error } (a used/older vehicle may simply have no environment/equipment data). */
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

  /** Fetches the MotorAPI lookup exactly once and caches it in motorApiResult — every caller (the "i" popup below, and the Brand/Mærke/Årgang "↓↙" fill buttons) goes through this single guarded entry point, so no combination of clicks ever triggers a second network call once a result (or an in-flight request) already exists. MotorAPI usage counts against a daily quota, so this matters beyond just avoiding redundant work. */
  const ensureMotorApiDataLoaded = () => {
    if (motorApiResult !== null || motorApiLoading || !order) return;

    setMotorApiLoading(true);
    setMotorApiError(null);
    void fetch(`/.netlify/functions/motorapi-vehicle-lookup?regNo=${encodeURIComponent(order.number_plate)}`, {
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
        setMotorApiLoading(false);
      })
      .catch(() => {
        setMotorApiError("Kunne ikke kontakte serveren. Prøv igen senere.");
        setMotorApiLoading(false);
      });
  };

  /** Opens the MotorAPI popup, loading its data (via ensureMotorApiDataLoaded) only on the transition into "open" — a re-click just toggles visibility of what's already loaded/cached. */
  const handleOpenMotorApiPopup = () => {
    const opening = !showMotorApiPopup;
    setShowMotorApiPopup(opening);
    if (opening) ensureMotorApiDataLoaded();
  };

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
    // Single merged row (was two: "Køretøj-ID:" + "Nummerplade:") —
    // "{vehicle_ident} - {number_plate}" when this order's department shows
    // vehicle_ident AND it's actually set, else just number_plate — same
    // design as VehicleDetailsPage.tsx's own merged "Køretøj:" row.
    ["Køretøj:", formatVehicleIdentLabel(order.vehicle_ident, order.number_plate, useVehicleIdent)],
    ["Brand:", order.brand ?? "—"],
    ["Mærke:", order.model ?? "—"],
    ["Årgang:", order.model_year ?? "—"],
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
                {rows.map(([label, value]) => {
                  /** Brand/Mærke/Årgang are editable (see saveOrderField) while the vehicle isn't registered yet — 2hire-register-vehicle.mts snapshots them onto vehicle_profiles at registration time, so editing afterward wouldn't change anything real and reverts to plain text (using `value`, which the sync effect keeps equal to order.brand/model/model_year regardless). getMotorApiValue is the confirmed-real MotorAPI field(s) the corner-down-left button below pulls from (see motorApiVehicleField) — Mærke combines "model" and "variant" into one string, matching how this app's own single Mærke field conflates model+variant. */
                  const editableField =
                    label === "Brand:"
                      ? {
                          value: brandInput,
                          setValue: setBrandInput,
                          field: "brand" as const,
                          original: order.brand,
                          getMotorApiValue: () => motorApiVehicleField(motorApiResult, ["make"]),
                        }
                      : label === "Mærke:"
                        ? {
                            value: modelInput,
                            setValue: setModelInput,
                            field: "model" as const,
                            original: order.model,
                            getMotorApiValue: () =>
                              [motorApiVehicleField(motorApiResult, ["model"]), motorApiVehicleField(motorApiResult, ["variant"])]
                                .filter(Boolean)
                                .join(" ") || null,
                          }
                        : label === "Årgang:"
                          ? {
                              value: modelYearInput,
                              setValue: setModelYearInput,
                              field: "model_year" as const,
                              original: order.model_year,
                              getMotorApiValue: () => motorApiVehicleField(motorApiResult, ["model_year"]),
                            }
                          : null;

                  if (editableField && !vehicleRegistered) {
                    const motorApiValue = editableField.getMotorApiValue();
                    return (
                      <div key={label} className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">{label}</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editableField.value}
                            onChange={(e) => editableField.setValue(e.target.value)}
                            onBlur={() => {
                              const trimmed = editableField.value.trim();
                              if (trimmed && trimmed !== editableField.original) {
                                void saveOrderField(editableField.field, trimmed);
                              }
                            }}
                            className="w-full min-w-0 rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                          />
                          <button
                            type="button"
                            disabled={!motorApiValue}
                            onClick={() => {
                              if (!motorApiValue) return;
                              editableField.setValue(motorApiValue);
                              if (motorApiValue !== editableField.original) {
                                void saveOrderField(editableField.field, motorApiValue);
                              }
                            }}
                            aria-label={`Udfyld ${label} fra MotorAPI`}
                            title={motorApiValue ? `Udfyld fra MotorAPI: ${motorApiValue}` : "Ingen værdi fundet i MotorAPI endnu"}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand-300 text-brand-600 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                              <polyline points="9 10 4 15 9 20" />
                              <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return label === "Nummerplade:" ? (
                    <div key={label} className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <div className="relative flex items-center justify-between gap-2" ref={motorApiRef}>
                        <label className="text-sm font-medium text-brand-700">{label}</label>
                        <button
                          type="button"
                          onClick={handleOpenMotorApiPopup}
                          aria-label="Slå køretøj op i MotorAPI"
                          className="flex h-5 w-5 items-center justify-center rounded-full border border-brand-300 font-serif text-[0.7rem] font-bold italic leading-none text-brand-600 transition hover:bg-brand-50"
                        >
                          i
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
                      <span className="text-sm text-brand-800">{value}</span>
                    </div>
                  ) : (
                    <div key={label} className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">{label}</label>
                      <span className="text-sm text-brand-800">{value}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {orderFieldSaveError && <p className="text-sm text-red-600">{orderFieldSaveError}</p>}

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
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-sm font-medium text-brand-700">2hire-profil:</label>
                        <div className="flex items-center gap-1">
                          <div className="relative" ref={profileJsonRef}>
                            <button
                              type="button"
                              onClick={() => setShowProfileJson((prev) => !prev)}
                              aria-label="Vis valgt profil som JSON"
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
                                      : "Ingen profil valgt."}
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
                        </div>
                      </div>
                      {profilesLoading ? (
                        <span className="text-sm text-brand-500">Indlæser…</span>
                      ) : profilesError ? (
                        <span className="text-sm text-red-600">{profilesError}</span>
                      ) : visibleProfiles.length === 0 ? (
                        <select
                          value={selectedProfileId}
                          onChange={(e) => setSelectedProfileId(e.target.value)}
                          className="rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        >
                          <option value={TWOHIRE_SIMULATOR_PROFILE_ID}>
                            Testprofil (2hboard simulator) — ingen profil matcher køretøjet
                          </option>
                        </select>
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
