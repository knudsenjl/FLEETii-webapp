// Netlify Function: persists the FLEETii-internal virtual "locked" flag on
// vehicle_signals (see supabase/vehicle_signals_add_locked.sql for why this
// is virtual, not a real 2hire signal/command — that's deferred). Reached
// from useVehicleLockState.ts, used by the Lås/Lås op buttons on
// BookingDetailsPage.tsx and VehicleDetailsPage.tsx.
//
// requireUser-gated, not admin-only — a regular user needs to toggle the
// lock on their own reservation. Uses the service-role key, since
// vehicle_signals deliberately has no client-side INSERT/UPDATE RLS policy
// (see vehicle_signals_table.sql) — same "service-role writes only" pattern
// as netlify/functions/2hire-webhook.mts.
//
// Does NOT re-validate the three button-activation rules server-side (see
// src/lib/bookings.ts's computeLockButtonState) — it trusts the calling UI's
// disabled-button state, matching this codebase's existing trust level
// elsewhere (e.g. booking deletion's permission check is also client-side
// only).
import { createClient } from "@supabase/supabase-js";
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { requireUser } from "./_shared/serverAuth.js";

type SetVehicleLockBody = { vehicleId?: string; locked?: boolean };

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Serveren mangler SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY." }),
      { status: 500 },
    );
  }

  let body: SetVehicleLockBody;
  try {
    body = (await req.json()) as SetVehicleLockBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const vehicleId = asTrimmedString(body.vehicleId);
  if (!vehicleId) {
    return new Response(JSON.stringify({ error: "vehicleId er påkrævet." }), { status: 400 });
  }
  if (typeof body.locked !== "boolean") {
    return new Response(JSON.stringify({ error: "locked skal være true eller false." }), { status: 400 });
  }
  const locked = body.locked;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Upsert, not update: a vehicle may not have a vehicle_signals row yet
  // (today only created by the 2hire webhook on its first signal) — a plain
  // update would silently no-op in that case.
  const { error } = await admin.from("vehicle_signals").upsert({ vehicle_id: vehicleId, locked });

  if (error) {
    console.error("[set-vehicle-lock] upsert failed:", error);
    return new Response(JSON.stringify({ error: "Kunne ikke gemme lås-status. Prøv igen." }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, locked }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
