// Shared helpers for reading MotorAPI vehicle-lookup results (see
// netlify/functions/motorapi-vehicle-lookup.mts — the { vehicle: { data } |
// { error }, ... } shape). Used by both VehicleCreatePage.tsx (looking up
// an already-saved order's fixed number plate) and NewVehiclePage.tsx
// (looking up whatever plate is currently being typed into "Ny
// bestilling") so the two pages' autofill behavior stays identical rather
// than drifting apart as separate copies.
import { DRIVMIDDEL_OPTIONS } from "./bookings";

/** Pulls the first present, non-empty field (in priority order) out of the MotorAPI vehicle lookup's "vehicle" section. Field names (make/model/variant/model_year/fuel_type) are confirmed real, not guessed — a page's own "i"/lookup button JSON popup (where it has one) shows the raw response if MotorAPI ever changes shape. */
export function motorApiVehicleField(motorApiResult: unknown, keys: string[]): string | null {
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

/** Maps MotorAPI's free-text "fuel_type" value onto one of DRIVMIDDEL_OPTIONS's fixed five — unlike Brand/Mærke/Årgang, Drivmiddel is a <select> constrained by vehicle_profiles/costumer_orders' shared CHECK constraint, so MotorAPI's raw string (whatever exact wording it uses — not documented, and not worth hardcoding a guess for) can't be written straight through. Keyword match on a lowercased substring, checked in this specific order so "diesel" isn't mistaken for "el" (it contains that substring) — null (leave Drivmiddel untouched) if nothing recognizable matches, rather than guessing wrong. */
export function motorApiDrivmiddel(motorApiResult: unknown): (typeof DRIVMIDDEL_OPTIONS)[number] | null {
  const raw = motorApiVehicleField(motorApiResult, ["fuel_type"]);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized.includes("hybrid")) return "Hybrid";
  if (normalized.includes("brint") || normalized.includes("hydrogen")) return "Brint";
  if (normalized.includes("diesel")) return "Diesel";
  if (normalized.includes("benzin") || normalized.includes("petrol") || normalized.includes("gasoline")) return "Benzin";
  if (normalized.includes("el") || normalized.includes("electric")) return "El";
  return null;
}
