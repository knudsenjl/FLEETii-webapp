// Netlify Function: sends one of 2hire's three generic vehicle commands
// (start/stop/locate) to a real, registered 2hire vehicle — see
// _shared/twoHireClient.ts's sendGenericCommand. Reached from
// TwoHireTestPage.tsx's own Lås/Lås op + "Blink lygterne" buttons (against
// the dedicated WB20499 test vehicle) AND, since command isn't hardcoded
// here, from BookingDetailsPage.tsx/VehicleDetailsPage.tsx's "Blink lygterne"
// (useLocateVehicle) against a real booking's real vehicle.
//
// Auth is split per command rather than one blanket check: "locate" (blink
// headlights, harmless) is available to the same audience as Lås/Lås op —
// any logged-in user, not just admins, since useVehicleLockState's own
// button-enablement rules already gate WHEN a regular user may act, not just
// whether they're an admin. "start"/"stop" (raw lock/unlock, bypassing those
// enablement rules entirely) stay admin-only — TwoHireTestPage.tsx's direct
// testing flow is the only caller of those today.
//
// Per the "per-costumer 2hire credentials" plan: which 2hire credential
// authenticates this command depends on the TARGET vehicle's costumer (not
// the caller's own costumer_id, which a FLEETii admin doesn't have) and
// whether the caller is a FLEETii admin — resolved fresh via a service-role
// lookup on every call, same as every other function touched by that plan.
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, requireUser } from "./_shared/serverAuth.js";
import { sendGenericCommand, type TwoHireGenericCommand } from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials } from "./_shared/twoHireCredentials.js";

const VALID_COMMANDS: readonly TwoHireGenericCommand[] = ["start", "stop", "locate"];

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const body = (await req.json().catch(() => null)) as { vehicleId?: string; command?: string } | null;
  const vehicleId = body?.vehicleId;
  const command = body?.command;
  if (!vehicleId || !command) {
    return new Response(JSON.stringify({ error: "vehicleId og command er påkrævet." }), { status: 400 });
  }
  if (!VALID_COMMANDS.includes(command as TwoHireGenericCommand)) {
    return new Response(
      JSON.stringify({ error: `Ugyldig command. Forventet en af: ${VALID_COMMANDS.join(", ")}.` }),
      { status: 400 },
    );
  }

  const authResult = command === "locate" ? await requireUser(req) : await requireAdmin(req);
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
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const [{ data: vehicle, error: vehicleError }, { data: caller, error: callerError }] = await Promise.all([
      admin
        .from("vehicle_profiles")
        .select("costumer_id")
        .eq("vehicle_id", vehicleId)
        .maybeSingle<{ costumer_id: string | null }>(),
      admin
        .from("user_profiles")
        .select("role")
        .eq("user_id", authResult.userId)
        .maybeSingle<{ role: string }>(),
    ]);
    if (vehicleError) throw new Error(`Kunne ikke slå køretøjet op: ${vehicleError.message}`);
    if (callerError) throw new Error(`Kunne ikke slå brugeren op: ${callerError.message}`);

    const isFleetiiAdmin = caller?.role === "FLEETii admin";
    const credentials = await resolveTwoHireCredentials(admin, {
      isFleetiiAdmin,
      costumerId: vehicle?.costumer_id ?? null,
    });

    await sendGenericCommand(vehicleId, command as TwoHireGenericCommand, credentials);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
};
