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
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./_shared/serverAuth.js";
import { escapeHtml, sendMail } from "./_shared/mailer.js";

type SendVehicleDeletionRequestBody = { vehicleId?: string };

/** Builds the HTML body of the "please delete this vehicle" email. */
function buildHtmlBody(fields: {
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
    <a href="https://fleetii-webapp.netlify.app/vehicle-delete/${fields.orderId}">https://fleetii-webapp.netlify.app/vehicle-delete/${fields.orderId}</a></p>

    <p>For at gennemføre sletningen skal du logge ind på FLEETii med en
    FLEETii admin-bruger.</p>
    `;
}

/**
 * POST { vehicleId } as an authenticated admin (see requireAdmin). Resolves
 * the caller's own costumer_id/department_id/contact info AND the target
 * vehicle's snapshot fields server-side, rejects if the vehicle doesn't
 * belong to the caller's own costumer, inserts a matching costumer_orders
 * row (order_type "Nedlæg"), then emails the request to RESEND_MAIL_RECIEVER
 * — via SMTP or Resend, see sendMail.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const mailReceiver = process.env.RESEND_MAIL_RECIEVER;
  if (!mailReceiver) {
    return new Response(JSON.stringify({ error: "Serveren mangler RESEND_MAIL_RECIEVER." }), { status: 500 });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Serveren mangler SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY." }),
      { status: 500 },
    );
  }

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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: caller } = await admin
    .from("user_profiles")
    .select("costumer_id, department_id, full_name, email, phone")
    .eq("user_id", authResult.userId)
    .maybeSingle<{
      costumer_id: string | null;
      department_id: string | null;
      full_name: string | null;
      email: string | null;
      phone: string | null;
    }>();

  if (!caller?.costumer_id) {
    return new Response(
      JSON.stringify({ error: "Din bruger er ikke tilknyttet en kunde — kan ikke oprette anmodningen." }),
      { status: 403 },
    );
  }

  const { data: vehicle } = await admin
    .from("vehicle_profiles")
    .select("number_plate, brand, model, model_year, costumer_id")
    .eq("vehicle_id", vehicleId)
    .maybeSingle<{
      number_plate: string | null;
      brand: string | null;
      model: string | null;
      model_year: string | null;
      costumer_id: string | null;
    }>();

  if (!vehicle) {
    return new Response(JSON.stringify({ error: "Køretøjet findes ikke." }), { status: 404 });
  }
  if (vehicle.costumer_id !== caller.costumer_id) {
    return new Response(
      JSON.stringify({ error: "Du kan kun anmode om sletning af køretøjer i din egen flåde." }),
      { status: 403 },
    );
  }

  const { data: customer } = await admin
    .from("costumers")
    .select("name")
    .eq("costumer_id", caller.costumer_id)
    .maybeSingle<{ name: string | null }>();
  const customerName = customer?.name ?? "—";

  let departmentName = "—";
  if (caller.department_id) {
    const { data: department } = await admin
      .from("departments")
      .select("name")
      .eq("department_id", caller.department_id)
      .maybeSingle<{ name: string | null }>();
    departmentName = department?.name ?? "—";
  }

  const contactperson = caller.full_name ?? caller.email ?? "—";

  const { data: insertedOrder, error: insertError } = await admin
    .from("costumer_orders")
    .insert({
      order_type: "Nedlæg",
      vehicle_id: vehicleId,
      costumer_id: caller.costumer_id,
      department_id: caller.department_id,
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
