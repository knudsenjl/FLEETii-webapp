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
// any logged-in user, not just admins, but ONLY for a vehicle they actually
// have a relevant booking on (same three-rule "in the Lås/Lås op window"
// check as set-vehicle-lock.mts's own regular-user authorization — reused,
// not reimplemented, via computeLockButtonState/findAdjacentBookings, so the
// two can't drift apart). "start"/"stop" (raw lock/unlock, bypassing those
// enablement rules entirely) stay admin-only — TwoHireTestPage.tsx's direct
// testing flow is the only caller of those today. A regular ("admin", not
// "FLEETii admin") caller is additionally scoped to their OWN costumer's
// vehicles for every command — same scoping VehiclesPage.tsx already applies
// to what an admin can even see — since requireAdmin()/requireUser() on
// their own only prove SOME caller is authenticated, not that they
// administer or have a booking on the TARGET vehicle.
//
// Per the "per-costumer 2hire credentials" plan: which 2hire credential
// authenticates this command depends on the TARGET vehicle's costumer (not
// the caller's own costumer_id, which a FLEETii admin doesn't have) and
// whether the caller is a FLEETii admin — resolved fresh via a service-role
// lookup on every call, same as every other function touched by that plan.
import { computeLockButtonState, findAdjacentBookings, nowIsoString } from "../../src/lib/bookings.js";
import { getAdminClient } from "./_shared/adminClient.js";
import { isAnyAdminRole, isFleetiiAdminRole, requireAdmin, requireUser } from "./_shared/serverAuth.js";
import { sendGenericCommand, type TwoHireGenericCommand } from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials } from "./_shared/twoHireCredentials.js";

const VALID_COMMANDS: readonly TwoHireGenericCommand[] = ["start", "stop", "locate"];

/** A vehicle's booking, as needed to re-run computeLockButtonState/findAdjacentBookings server-side — see set-vehicle-lock.mts's identical type. */
type VehicleBooking = { booking_id: string; start: string; end: string | null; user_id: string | null };

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

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  try {
    const [{ data: vehicle, error: vehicleError }, { data: caller, error: callerError }] = await Promise.all([
      admin
        .from("vehicle_profiles")
        .select("costumer_id")
        .eq("vehicle_id", vehicleId)
        .maybeSingle<{ costumer_id: string | null }>(),
      admin
        .from("user_profiles")
        .select("role, costumer_id")
        .eq("user_id", authResult.userId)
        .maybeSingle<{ role: string; costumer_id: string | null }>(),
    ]);
    if (vehicleError) throw new Error(`Kunne ikke slå køretøjet op: ${vehicleError.message}`);
    if (callerError) throw new Error(`Kunne ikke slå brugeren op: ${callerError.message}`);

    const isFleetiiAdmin = isFleetiiAdminRole(caller?.role);
    const isAdmin = isAnyAdminRole(caller?.role);

    if (!isFleetiiAdmin) {
      if (isAdmin) {
        if (!caller?.costumer_id || caller.costumer_id !== vehicle?.costumer_id) {
          return new Response(JSON.stringify({ error: "Du har ikke adgang til dette køretøj." }), { status: 403 });
        }
      } else {
        // Only "locate" reaches here as a regular user — "start"/"stop" already
        // required requireAdmin() above. Same audience as Lås/Lås op: allowed
        // only if one of the caller's own bookings on this vehicle currently
        // has lock or unlock enabled (see set-vehicle-lock.mts's identical
        // check for why the raw rules, not just "has a booking", are reused).
        const [{ data: signal, error: signalError }, { data: bookings, error: bookingsError }] = await Promise.all([
          admin.from("vehicle_signals").select("locked").eq("vehicle_id", vehicleId).maybeSingle<{ locked: boolean }>(),
          admin
            .from("bookings")
            .select("booking_id, start, end, user_id")
            .eq("vehicle_id", vehicleId)
            .returns<VehicleBooking[]>(),
        ]);
        if (signalError) throw new Error(`Kunne ikke slå lås-status op: ${signalError.message}`);
        if (bookingsError) throw new Error(`Kunne ikke slå reservationer op: ${bookingsError.message}`);

        const currentLocked = signal?.locked ?? true;
        const ownBookings = (bookings ?? []).filter((b) => b.user_id === authResult.userId);
        const authorized = ownBookings.some((booking) => {
          const { previous, next } = findAdjacentBookings(bookings ?? [], booking.booking_id);
          const state = computeLockButtonState(
            nowIsoString(),
            { start: booking.start, end: booking.end },
            previous ? { end: previous.end } : null,
            next ? { start: next.start } : null,
            currentLocked,
          );
          return state.lockEnabled || state.unlockEnabled;
        });
        if (!authorized) {
          return new Response(JSON.stringify({ error: "Du har ikke adgang til dette køretøj lige nu." }), { status: 403 });
        }
      }
    }

    const credentials = await resolveTwoHireCredentials(admin, {
      isFleetiiAdmin,
      costumerId: vehicle?.costumer_id ?? null,
    });

    try {
      await sendGenericCommand(vehicleId, command as TwoHireGenericCommand, credentials);
    } catch (error) {
      // 2hire's own error for "locate" is a raw MISSING_CONFIGURATION cause
      // (see sendGenericCommand) — it means this specific vehicle's 2hire
      // device isn't configured to support remote locate/blink at all, not
      // a transient failure worth retrying. Only intercepted for "locate":
      // "start"/"stop" surface whatever cause 2hire returns unchanged, since
      // that limitation hasn't been observed for those commands.
      if (command === "locate" && error instanceof Error && error.message.includes("MISSING_CONFIGURATION")) {
        return new Response(JSON.stringify({ error: "Dette køretøj tillader ikke remote blink." }), { status: 400 });
      }
      throw error;
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
};
