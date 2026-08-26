// Shared helpers for working with 2hire's own vehicle-configuration
// profiles (see netlify/functions/2hire-board-profiles.mts) — used by both
// VehicleCreatePage.tsx (picking a profile as part of a REAL 2hire
// registration call) and HandleVehiclePage.tsx (picking one to correct/
// update the already-registered vehicle's OWN stored twohire_profile label,
// with no live 2hire effect) so the two pages' picker behavior — id/label
// extraction, brand/model/year matching — stays identical rather than two
// copies drifting apart.

/** One of 2hire's own vehicle-configuration profiles — confirmed real shape { id, title, description, makerName, modelName, modelYearRange } (developer.2hire.io/reference/getpublicprofilelist-1's own example response); still loosely typed since only id/title/makerName/modelName/modelYearRange are actually used here. */
export type TwoHireBoardProfile = Record<string, unknown>;

/** 2hire's fixed profile id for any simulated device — per 2hire's own "Guide to test..." documentation: "In order to configure simulators, the profile id 51ba5b28-28da-435a-b42e-a3931288470c need to be used." Used as the automatic fallback selection whenever no real profile is available to pick from. */
export const TWOHIRE_SIMULATOR_PROFILE_ID = "51ba5b28-28da-435a-b42e-a3931288470c";

/** id extraction for a profile — "id" is the confirmed real field; "profileId" kept as a defensive fallback. Falls back to an empty string (which a picker then can't submit, rather than silently using a wrong value) if neither is present. */
export function boardProfileId(profile: TwoHireBoardProfile): string {
  const raw = profile.id ?? profile.profileId;
  return typeof raw === "string" ? raw : "";
}

/** Human-readable label for a profile — "title" is the confirmed real field (e.g. "Fiat 500 2019-2020"); "name"/"profileName" kept as defensive fallbacks, then the id, then the raw JSON as a last resort so a picker never shows a blank option. This is also the exact string persisted as vehicle_profiles.twohire_profile (see vehicle_profiles_add_twohire_profile.sql) — the profile's id alone wouldn't be directly displayable later without another live 2hire lookup. */
export function boardProfileLabel(profile: TwoHireBoardProfile): string {
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
function parseYearRange(value: string): [number, number] | null {
  const years = [...value.matchAll(/\d{4}/g)].map((m) => Number(m[0]));
  if (years.length === 0) return null;
  return [Math.min(...years), Math.max(...years)];
}

/** Whether a 2hire board profile is a plausible match for a vehicle's own brand/model/model_year — matched leniently in both directions (either string containing the other) since neither this app's free-text brand/model fields nor 2hire's makerName/modelName are guaranteed to be spelled identically. Year matches on range overlap (the vehicle's own year field is itself often a range like "2014-2025", not a single year). Missing/unparseable data on either side passes rather than excludes, so a profile is only ever filtered OUT on a genuine mismatch, never on missing info. */
export function profileMatchesVehicle(profile: TwoHireBoardProfile, vehicle: { brand: string; model: string; model_year: string }): boolean {
  const maker = normalizeForMatch(typeof profile.makerName === "string" ? profile.makerName : "");
  const vehicleBrand = normalizeForMatch(vehicle.brand);
  const makerMatches = !maker || !vehicleBrand || maker.includes(vehicleBrand) || vehicleBrand.includes(maker);

  const modelName = normalizeForMatch(typeof profile.modelName === "string" ? profile.modelName : "");
  const vehicleModel = normalizeForMatch(vehicle.model);
  const modelMatches = !modelName || !vehicleModel || modelName.includes(vehicleModel) || vehicleModel.includes(modelName);

  const profileYearRange =
    Array.isArray(profile.modelYearRange) &&
    profile.modelYearRange.length === 2 &&
    typeof profile.modelYearRange[0] === "number" &&
    typeof profile.modelYearRange[1] === "number"
      ? (profile.modelYearRange as [number, number])
      : null;
  const vehicleYearRange = parseYearRange(vehicle.model_year);
  const yearMatches =
    !profileYearRange || !vehicleYearRange || (vehicleYearRange[1] >= profileYearRange[0] && vehicleYearRange[0] <= profileYearRange[1]);

  return makerMatches && modelMatches && yearMatches;
}
