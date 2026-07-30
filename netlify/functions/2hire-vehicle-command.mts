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
import { requireAdmin, requireUser } from "./_shared/serverAuth.js";
import { sendGenericCommand, type TwoHireGenericCommand } from "./_shared/twoHireClient.js";

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

  try {
    await sendGenericCommand(vehicleId, command as TwoHireGenericCommand);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
};
