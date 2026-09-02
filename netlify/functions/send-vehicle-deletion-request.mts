// Netlify Function: records a "please delete this vehicle" request as a
// costumer_orders row (order_type "Nedlæg"), then emails FLEETii staff about
// it — the reverse of send-vehicle-request.mts's "please create this
// vehicle" ("Opret") flow; both write to the same table now (see
// costumer_orders_merge_deletion_requests.sql — costumer_orders used to have
// a dedicated vehicle_deletion_requests counterpart, merged away since the
// two were nearly identical in shape). Reached from VehicleDetailsPage.tsx's
// "Slet køretøj" button. A customer admin can't delete a vehicle
// unilaterally: the physical 2hire board installed in it has to be removed
// and the vehicle deregistered from 2hire, both FLEETii's job, not the
// customer's — so this only records the request; the real deletion happens
// later via delete-vehicle.mts, once FLEETii staff confirm the device is out
// (see VehicleDeletePage.tsx).
//
// Unlike send-vehicle-request.mts, there's no client-supplied form here —
// the requester's own user_profiles row (full_name/email, phone) supplies
// "who to contact", and the vehicle's own vehicle_profiles row supplies the
// snapshot fields, both resolved server-side rather than trusted from the
// request body.
import { getAdminClient } from "./_shared/adminClient.js";
import { isSysadmRole, requireAdmin } from "./_shared/serverAuth.js";
import { escapeHtml, sendMail } from "./_shared/mailer.js";

type SendVehicleDeletionRequestBody = { vehicleId?: string };

/** Builds the HTML body of the "please delete this vehicle" email. */
function buildHtmlBody(fields: {
  /** This deploy's own origin (process.env.URL, set automatically by Netlify — same fallback convention as create-user.mts's loginUrl), so the emailed link follows the site wherever it's hosted instead of a domain baked in at write-time. */
  baseUrl: string;
  orderId: string;
  customerName: string;
  departmentName: string;
  numberPlate: string;
  brand: string;
  model: string;
  modelYear: string;
  contactperson: string;
  contactemail: string;
  contactnumber: string;
}): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="border:1px solid #d6dce2;padding:6px 12px;font-weight:600;background:#f3f5f7;">${escapeHtml(label)}</td>
      <td style="border:1px solid #d6dce2;padding:6px 12px;">${escapeHtml(value)}</td>
    </tr>`;

  return `
    <h1>Anmodning om sletning af køretøj i FLEETii</h1>

    <p>En administrator hos ${escapeHtml(fields.customerName)} har anmodet om, at et
    køretøj slettes fra FLEETii. Se nedenstående detaljer.</p>

    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
      ${row("Kunde", fields.customerName)}
      ${row("Afdeling", fields.departmentName)}
      ${row("Nummerplade", fields.numberPlate)}
      ${row("Brand", fields.brand)}
      ${row("Mærke", fields.model)}
      ${row("Årgang", fields.modelYear)}
      ${row("Kontaktperson", fields.contactperson)}
      ${row("Kontakt e-mail", fields.contactemail)}
      ${row("Kontakt tlf.", fields.contactnumber)}
    </table>

    <p>Når det fysiske 2hire-device er afmonteret, kan køretøjet slettes i FLEETii og
    afregistreres i 2hire gennem flg. link:
    <a href="${fields.baseUrl}/vehicle-delete/${fields.orderId}">${fields.baseUrl}/vehicle-delete/${fields.orderId}</a></p>

    <p>For at gennemføre sletningen skal du logge ind på FLEETii med en
    sysadm-bruger.</p>
    `;
}

/**
 * POST { vehicleId } as an authenticated admin (see requireAdmin). Resolves
 * the caller's own contact info AND the target vehicle's own costumer_id/
 * department_id/snapshot fields server-side; a regular admin is rejected if
 * the vehicle doesn't belong to their own costumer, a sysadm (no
 * "home" costumer of their own) may request deletion for any costumer's
 * vehicle. Inserts a matching costumer_orders row (order_type "Nedlæg"),
 * then emails the request to MAIL_RECIEVER — via SMTP, see sendMail.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const mailReceiver = process.env.MAIL_RECIEVER;
  if (!mailReceiver) {
    return new Response(JSON.stringify({ error: "Serveren mangler MAIL_RECIEVER." }), { status: 500 });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  let body: SendVehicleDeletionRequestBody;
  try {
    body = (await req.json()) as SendVehicleDeletionRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const vehicleId = body.vehicleId?.trim();
  if (!vehicleId) {
    return new Response(JSON.stringify({ error: "vehicleId er påkrævet." }), { status: 400 });
  }


  // caller/vehicle are independent lookups (neither reads the other's
  // result), so they're fetched together rather than one after another.
  const [{ data: caller }, { data: vehicle }] = await Promise.all([
    admin
      .from("user_profiles")
      .select("role, costumer_id, department_id, full_name, email, phone")
      .eq("user_id", authResult.userId)
      .maybeSingle<{
        role: string;
        costumer_id: string | null;
        department_id: string | null;
        full_name: string | null;
        email: string | null;
        phone: string | null;
      }>(),
    admin
      .from("vehicle_profiles")
      .select("number_plate, brand, model, model_year, costumer_id, department_id")
      .eq("vehicle_id", vehicleId)
      .maybeSingle<{
        number_plate: string | null;
        brand: string | null;
        model: string | null;
        model_year: string | null;
        costumer_id: string | null;
        department_id: string | null;
      }>(),
  ]);

  if (!caller) {
    return new Response(JSON.stringify({ error: "Kunne ikke slå din brugerprofil op." }), { status: 500 });
  }
  if (!vehicle) {
    return new Response(JSON.stringify({ error: "Køretøjet findes ikke." }), { status: 404 });
  }

  // A sysadm has no "home" costumer of their own (see isSysadm
  // elsewhere in this codebase) — unlike a regular admin, who's always
  // scoped to their own costumer's vehicles, they may request deletion for
  // ANY costumer's vehicle, so neither of the two checks below applies to
  // them. The costumer_id/department_id used for the request itself always
  // come from the VEHICLE's own row (not the caller's), which is correct
  // either way: for a regular admin those already match their own costumer/
  // department (enforced by the check below), and for a sysadm
  // they're the only correct source at all.
  const callerIsSysadm = isSysadmRole(caller.role);
  if (!callerIsSysadm) {
    if (!caller.costumer_id) {
      return new Response(
        JSON.stringify({ error: "Din bruger er ikke tilknyttet en kunde — kan ikke oprette anmodningen." }),
        { status: 403 },
      );
    }
    if (vehicle.costumer_id !== caller.costumer_id) {
      return new Response(
        JSON.stringify({ error: "Du kan kun anmode om sletning af køretøjer i din egen flåde." }),
        { status: 403 },
      );
    }
  }
  if (!vehicle.costumer_id) {
    return new Response(JSON.stringify({ error: "Køretøjet er ikke tilknyttet en kunde." }), { status: 400 });
  }

  // customer/department are likewise independent of each other.
  const [{ data: customer }, { data: department }] = await Promise.all([
    admin.from("costumers").select("name").eq("costumer_id", vehicle.costumer_id).maybeSingle<{ name: string | null }>(),
    vehicle.department_id
      ? admin.from("departments").select("name").eq("department_id", vehicle.department_id).maybeSingle<{ name: string | null }>()
      : Promise.resolve({ data: null }),
  ]);
  const customerName = customer?.name ?? "—";
  const departmentName = department?.name ?? "—";

  const contactperson = caller.full_name ?? caller.email ?? "—";

  const { data: insertedOrder, error: insertError } = await admin
    .from("costumer_orders")
    .insert({
      order_type: "Nedlæg",
      vehicle_id: vehicleId,
      costumer_id: vehicle.costumer_id,
      department_id: vehicle.department_id,
      number_plate: vehicle.number_plate ?? "—",
      brand: vehicle.brand ?? "—",
      model: vehicle.model ?? "—",
      model_year: vehicle.model_year ?? "—",
      // Opret-only fields, forced to inert values on a Nedlæg row.
      needs_fleetii_device: false,
      contactperson,
      contactemail: caller.email,
      contactnumber: caller.phone,
    })
    .select("order_id")
    .single<{ order_id: string }>();

  if (insertError || !insertedOrder) {
    // Raw Postgres error logged server-side only — VehicleDetailsPage.tsx
    // already surfaces whatever `error` comes back here, so a clean Danish
    // message is what the admin actually sees.
    console.error("[send-vehicle-deletion-request] costumer_orders insert failed:", insertError);
    return new Response(
      JSON.stringify({ error: "Kunne ikke oprette anmodningen. Prøv igen senere eller kontakt FLEETII direkte." }),
      { status: 500 },
    );
  }

  const result = await sendMail({
    to: mailReceiver,
    subject: `${customerName} - Anmodning om sletning af køretøj (${vehicle.number_plate ?? "—"}) i FLEETii`,
    html: buildHtmlBody({
      baseUrl: process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? "https://fleetii-webapp-staging.netlify.app",
      orderId: insertedOrder.order_id,
      customerName,
      departmentName,
      numberPlate: vehicle.number_plate ?? "—",
      brand: vehicle.brand ?? "—",
      model: vehicle.model ?? "—",
      modelYear: vehicle.model_year ?? "—",
      contactperson,
      contactemail: caller.email ?? "—",
      contactnumber: caller.phone ?? "—",
    }),
  });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: `Kunne ikke sende mail: ${result.error}` }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
