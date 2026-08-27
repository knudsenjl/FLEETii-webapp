// Shared helpers for working with 2hire's own vehicle-configuration
// profiles (see netlify/functions/2hire-board-profiles.mts) — used by both
// VehicleCreatePage.tsx (picking a profile as part of a REAL 2hire
// registration call) and HandleVehiclePage.tsx (picking one to correct/
// update the already-registered vehicle's OWN stored twohire_profile label,
// with no live 2hire effect) so the two pages' picker behavior — id/label
// extraction, sorting, and maker/model/year narrowing — stays identical
// rather than two copies drifting apart.

/** One of 2hire's own vehicle-configuration profiles — confirmed real shape { id, title, description, makerName, modelName, modelYearRange } (developer.2hire.io/reference/getpublicprofilelist-1's own example response, cross-checked against a real production catalog dump 2026-08-27); still loosely typed since only id/title/makerName/modelName/modelYearRange are actually used here. */
export type TwoHireBoardProfile = Record<string, unknown>;

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

/** Strips 2hire's own bracketed "(...)" annotations from a maker/model name — e.g. "(Breakout)", "(GPS)", "(44L)"/"(58L)" — describing the physical device/board variant or a size option, never the vehicle's actual make/model, and never something this app's own free-text brand/model fields would contain. Left as plain text (not yet lowercased/tokenized) so callers can still see the un-annotated name if they need to. */
function stripAnnotations(value: string): string {
  return value.replace(/\([^)]*\)/g, " ");
}

/** Splits a maker/model name into its significant lowercase word tokens: strips bracketed annotations first (see stripAnnotations), then splits on any run of non-alphanumeric characters — spaces, hyphens, AND underscores all count as word boundaries here, since 2hire spells multi-word names with underscores (e.g. makerName "MERCEDES_BENZ") where this app's own free text would use a space or hyphen ("Mercedes-Benz", "Mercedes Benz") — the exact separator character never matters, only the words themselves do. "MERCEDES_BENZ" and "Mercedes-Benz" both tokenize to ["mercedes", "benz"]; "GLE (Breakout)" and "Qashqai (GPS)(Breakout)" tokenize to ["gle"] and ["qashqai"] respectively, the annotation dropped entirely rather than merged into a garbled word. */
function tokenize(value: string): string[] {
  return stripAnnotations(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Whether two word-token lists are a plausible match: every token of the SHORTER list must appear somewhere in the longer one (order-independent) — so a single-word vehicle model ("Golf") matches a multi-word profile modelName ("Golf GTI") and vice versa, without requiring an exact word-for-word match either way. An empty list on either side (nothing meaningful left to compare, e.g. a blank field or one that was ONLY a bracketed annotation) always counts as matching — missing/unparseable data passes rather than excludes. */
function tokensOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.every((token) => longer.includes(token));
}

function profileMakerTokens(profile: TwoHireBoardProfile): string[] {
  return tokenize(typeof profile.makerName === "string" ? profile.makerName : "");
}

function profileModelTokens(profile: TwoHireBoardProfile): string[] {
  return tokenize(typeof profile.modelName === "string" ? profile.modelName : "");
}

/** Extracts every 4-digit year found in a free-text "Årgang" value (e.g. "2014-2025", "2020", "ca. 2019") and returns [min, max] — null if none found, so callers can treat an unparseable year as "don't filter on year" rather than wrongly excluding every profile. */
function parseYearRange(value: string): [number, number] | null {
  const years = [...value.matchAll(/\d{4}/g)].map((m) => Number(m[0]));
  if (years.length === 0) return null;
  return [Math.min(...years), Math.max(...years)];
}

function profileYearRange(profile: TwoHireBoardProfile): [number, number] | null {
  return Array.isArray(profile.modelYearRange) &&
    profile.modelYearRange.length === 2 &&
    typeof profile.modelYearRange[0] === "number" &&
    typeof profile.modelYearRange[1] === "number"
    ? (profile.modelYearRange as [number, number])
    : null;
}

/** Whether two [min, max] year ranges overlap at all — null on either side (missing/unparseable) passes rather than excludes, same philosophy as tokensOverlap. */
function yearRangesOverlap(a: [number, number] | null, b: [number, number] | null): boolean {
  if (!a || !b) return true;
  return a[0] <= b[1] && b[0] <= a[1];
}

/** Whether a profile's makerName plausibly matches a vehicle's own free-text brand — see tokensOverlap/tokenize for what "plausibly" means (annotation-stripped, underscore/hyphen/space-insensitive word overlap). */
export function profileMakerMatches(profile: TwoHireBoardProfile, vehicleBrand: string): boolean {
  return tokensOverlap(profileMakerTokens(profile), tokenize(vehicleBrand));
}

/** Whether a profile's modelName plausibly matches a vehicle's own free-text model — see profileMakerMatches' own doc comment, same reasoning. */
export function profileModelMatches(profile: TwoHireBoardProfile, vehicleModel: string): boolean {
  return tokensOverlap(profileModelTokens(profile), tokenize(vehicleModel));
}

/** Whether a profile's modelYearRange overlaps a vehicle's own free-text "Årgang" value (itself often a range, e.g. "2014-2025", not a single year — see parseYearRange). */
export function profileYearMatches(profile: TwoHireBoardProfile, vehicleModelYear: string): boolean {
  return yearRangesOverlap(profileYearRange(profile), parseYearRange(vehicleModelYear));
}

/** Whether a 2hire board profile matches a vehicle's own brand/model/model_year on ALL three axes simultaneously (strict AND — see profileMakerMatches/profileModelMatches/profileYearMatches). Prefer narrowProfilesForVehicle for a picker's own default candidate list: real profile catalogs don't always align cleanly on all three axes for the same vehicle (e.g. a profile with no year data at all), so a strict simultaneous match can land on zero candidates where a hierarchical narrowing would still surface something useful. Kept for the (rarer) case where an exact simultaneous match specifically matters. */
export function profileMatchesVehicle(
  profile: TwoHireBoardProfile,
  vehicle: { brand: string; model: string; model_year: string },
): boolean {
  return (
    profileMakerMatches(profile, vehicle.brand) &&
    profileModelMatches(profile, vehicle.model) &&
    profileYearMatches(profile, vehicle.model_year)
  );
}

/**
 * Progressively narrows `profiles` down to the best candidates for a
 * vehicle's own brand/model/model_year — hierarchy maker -> model -> year,
 * each level only actually narrowing the running candidate set if doing so
 * leaves at least one profile. So a vehicle whose year doesn't cleanly
 * align with any maker+model-matched profile still returns that
 * maker+model-matched set rather than nothing, and a vehicle with no
 * maker-matching profile at all falls back to the full input list (nothing
 * to narrow from). This is what VehicleCreatePage.tsx/HandleVehiclePage.tsx
 * actually use for their picker's default selection/narrowed view;
 * profileMatchesVehicle's strict simultaneous AND-match is the stricter
 * alternative, kept separately since it's easy to land on zero results with
 * against a real, messy profile catalog.
 */
export function narrowProfilesForVehicle(
  profiles: TwoHireBoardProfile[],
  vehicle: { brand: string; model: string; model_year: string },
): TwoHireBoardProfile[] {
  const byMaker = profiles.filter((profile) => profileMakerMatches(profile, vehicle.brand));
  const afterMaker = byMaker.length > 0 ? byMaker : profiles;

  const byModel = afterMaker.filter((profile) => profileModelMatches(profile, vehicle.model));
  const afterModel = byModel.length > 0 ? byModel : afterMaker;

  const byYear = afterModel.filter((profile) => profileYearMatches(profile, vehicle.model_year));
  return byYear.length > 0 ? byYear : afterModel;
}

/** Sorts profiles by makerName, then modelName (bracketed annotations ignored, see tokenize), then the first year of modelYearRange — 2hire's own API returns them in no particular order, and an unsorted <select> is hard to scan. A profile with no parseable year sorts after ones that do, within the same maker+model group. Returns a new array (doesn't mutate the input), so callers can call this directly on a `profiles`/narrowed value without worrying about in-place effects on state. */
export function sortBoardProfiles(profiles: TwoHireBoardProfile[]): TwoHireBoardProfile[] {
  return [...profiles].sort((a, b) => {
    const makerCompare = profileMakerTokens(a).join(" ").localeCompare(profileMakerTokens(b).join(" "), "da");
    if (makerCompare !== 0) return makerCompare;

    const modelCompare = profileModelTokens(a).join(" ").localeCompare(profileModelTokens(b).join(" "), "da");
    if (modelCompare !== 0) return modelCompare;

    const yearA = profileYearRange(a)?.[0] ?? null;
    const yearB = profileYearRange(b)?.[0] ?? null;
    if (yearA === yearB) return 0;
    if (yearA === null) return 1;
    if (yearB === null) return -1;
    return yearA - yearB;
  });
}
