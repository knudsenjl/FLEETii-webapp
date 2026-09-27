// Netlify Function: sends 2hire's generic "locate" command (blink the
// headlights) to a real, registered 2hire vehicle — see
// _shared/twoHireClient.ts's sendGenericCommand. Reached from
// BookingPage.tsx/BookingDetailsPage.tsx/VehicleDetailsPage.tsx's "Blink"
// (useLocateVehicle).
//
// Only "locate" is accepted. It used to also take "start"/"stop" (raw
// unlock/lock) for admins — left over from the long-gone TwoHireTestPage —
// which physically unlocked a vehicle WITHOUT recording lock history or the
// persisted `locked` state that set-vehicle-lock.mts maintains. Every real
// Lås/Lås op goes through set-vehicle-lock.mts (code review 2026-09-26).
//
// Audience: the same as Lås/Lås op — any logged-in user, but a regular user
// ONLY for a vehicle they have a booking on that is currently inside its
// Lås/Lås op window (the same three-rule check as set-vehicle-lock.mts's
// regular-user authorization, reused via _shared/vehicleLock.ts's
// anyOwnBookingAllows, so the two can't drift apart). A regular ("admin",
// not "sysadm") caller is scoped to their OWN costumer's vehicles — same
// scoping VehiclesPage.tsx applies to what an admin can even see — since
// requireUser() alone only proves SOME caller is authenticated.
//
// Per the "per-costumer 2hire credentials" plan: which 2hire credential
// authenticates this command depends on the TARGET vehicle's costumer (not
// the caller's own costumer_id, which a sysadm doesn't have) — resolved fresh via a service-role
// lookup on every call, same as every other function touched by that plan.
import { getAdminClient } from "./_shared/adminClient.js";
import { isAnyAdminRole, isSysadmRole, requireUser } from "./_shared/serverAuth.js";
import { sendGenericCommand, type TwoHireGenericCommand } from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials, twoHireErrorStatus } from "./_shared/twoHireCredentials.js";
import { anyOwnBookingAllows, loadLockContext } from "./_shared/vehicleLock.js";
import { json } from "./_shared/http.js";

const VALID_COMMANDS: readonly TwoHireGenericCommand[] = ["locate"];

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const body = (await req.json().catch(() => null)) as { vehicleId?: string; command?: string } | null;
  const vehicleId = body?.vehicleId;
  const command = body?.command;
  if (!vehicleId || !command) {
    return json({ error: "vehicleId og command er påkrævet." }, 400);
  }
  if (!VALID_COMMANDS.includes(command as TwoHireGenericCommand)) {
    return new Response(
      JSON.stringify({ error: `Ugyldig command. Forventet en af: ${VALID_COMMANDS.join(", ")}.` }),
      { status: 400 },
    );
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) {
    return json({ error: authResult.error }, authResult.status);
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return json({ error: adminClientResult.error }, adminClientResult.status);
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
        .select("role, costumer_id, deleted_at")
        .eq("user_id", authResult.userId)
        .maybeSingle<{ role: string; costumer_id: string | null; deleted_at: string | null }>(),
    ]);
    if (vehicleError) {
      return json({ error: `Kunne ikke slå køretøjet op: ${vehicleError.message}` }, 500);
    }
    if (callerError) {
      return json({ error: `Kunne ikke slå brugeren op: ${callerError.message}` }, 500);
    }
    // Same 404 as set-vehicle-lock.mts — otherwise a stale/mistyped id from a
    // sysadm (who skips the costumer check below) surfaced as a misleading
    // "can't determine costumer" 502 from resolveTwoHireCredentials.
    if (!vehicle) {
      return json({ error: "Køretøjet blev ikke fundet." }, 404);
    }

    // An archived user (delete-user.mts bans the login AND sets deleted_at)
    // can still hold a valid access token until it expires (up to ~1 hour) —
    // requireUser alone only proves the token is valid, so refuse them here.
    if (!caller || caller.deleted_at) {
      return json({ error: "Din bruger er ikke længere aktiv." }, 403);
    }

    const isSysadm = isSysadmRole(caller.role);
    const isAdmin = isAnyAdminRole(caller.role);

    if (!isSysadm) {
      // Every non-sysadm caller — admin or regular user — is scoped to their
      // own costumer's vehicles; for a regular user this is checked before
      // trusting any booking row (see set-vehicle-lock.mts's identical check).
      if (!caller?.costumer_id || caller.costumer_id !== vehicle?.costumer_id) {
        return json({ error: "Du har ikke adgang til dette køretøj." }, 403);
      }
      if (!isAdmin) {
        // Same audience as Lås/Lås op: allowed
        // only if one of the caller's own bookings on this vehicle currently
        // has lock or unlock enabled (see set-vehicle-lock.mts's identical
        // check for why the raw rules, not just "has a booking", are reused).
        const context = await loadLockContext(admin, vehicleId);
        const authorized = anyOwnBookingAllows(
          context,
          (b) => b.user_id === authResult.userId,
          (state) => state.lockEnabled || state.unlockEnabled,
        );
        if (!authorized) {
          return json({ error: "Du har ikke adgang til dette køretøj lige nu." }, 403);
        }
      }
    }

    const credentials = await resolveTwoHireCredentials(admin, {
      costumerId: vehicle.costumer_id,
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
        return json({ error: "Dette køretøj tillader ikke remote blink." }, 400);
      }
      throw error;
    }

    return json({ ok: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return json({ error: message }, twoHireErrorStatus(error));
  }
};
