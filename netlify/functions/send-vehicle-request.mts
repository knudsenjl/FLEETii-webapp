// Netlify Function: records a "please create/provision this vehicle"
// request as a costumer_orders row, then emails FLEETii staff about it (no
// vehicle-provisioning API to call directly — a human sets the device up).
// Reached from NewVehiclePage.tsx. The row is inserted BEFORE the email is
// sent — deliberately, so the request survives as real data even if the
// email later fails or gets lost, rather than existing only as a mail FLEETii
// staff has to remember to act on.
//
// Uses the service-role key for the insert — costumer_orders' own INSERT RLS
// policy (see supabase/applied/costumer_orders_table.sql) would already
// allow this for a regular admin acting within their own costumer, but
// costumer_id/department_id are resolved from the CALLER'S OWN profile here
// (not trusted from the request body) so a hand-crafted request can't
// attribute an order to a different costumer — same reasoning as
// create-user.mts's own costumer scoping.
//
// Mail transport (SMTP) lives in _shared/mailer.ts, shared with
// create-user.mts's welcome email. MAIL_RECIEVER is this function's own
// recipient (FLEETii staff) — unrelated to who create-user.mts emails.
import { getAdminClient } from "./_shared/adminClient.js";
import { asNormalizedNumberString, asTrimmedString } from "../../src/lib/requestValidation.js";
import { isFleetiiAdminRole, requireAdmin } from "./_shared/serverAuth.js";
import { escapeHtml, sendMail } from "./_shared/mailer.js";

type SendVehicleRequestBody = {
  afdeling?: string | null;
  /** FLEETii-admin-only (see NewVehiclePage.tsx's Kunde/Afdeling picker, isFleetiiAdmin branch) — a regular admin has no need for this (their own profile's department_id is used instead, same as before this field existed) and it's IGNORED unless the caller's own role is genuinely "FLEETii admin" (checked server-side below, never trusted from the body alone). When present, this — not afdeling's display name, nor the caller's own profile — is what actually determines the inserted row's costumer_id/department_id (departments.costumer_id is looked up from it). */
  departmentId?: string | null;
  /** Company-wide "Køretøj-ID" identifier — optional, see costumer_orders_add_vehicle_ident.sql. */
  vehicleIdent?: string | null;
  /** Parking spot — optional free text, see costumer_orders_add_parking.sql. */
  parking?: string | null;
  nummerplade?: string;
  /** Optional as of costumer_orders_brand_model_year_nullable.sql — no longer required on NewVehiclePage.tsx, fillable later on VehicleCreatePage.tsx (incl. its MotorAPI fill button). */
  brand?: string | null;
  maerke?: string | null;
  aargang?: string | null;
  /** Optional — not always known (e.g. a genuinely new vehicle), free-text same as the other fields. */
  fuelLevel?: string | null;
  mileage?: string | null;
  /** One of vehicle_profiles.drivmiddel's allowed values (see NewVehiclePage.tsx's <select>) — falls back to the column's own "Benzin" default (see costumer_orders_add_drivmiddel.sql) if somehow missing, same as an omitted insert column would. */
  drivmiddel?: string | null;
  /** Whether a NEW FLEETii device needs to be installed — false means the vehicle already has one, identified by fleetiiDeviceId instead (see NewVehiclePage.tsx's own doc comment). Defaults true if omitted, matching the client's own default. */
  needsFleetiiDevice?: boolean;
  fleetiiDeviceId?: string | null;
  kontaktperson?: string;
  kontaktemail?: string;
  kontaktnummer?: string;
};

/** Builds the HTML table of vehicle-request fields that becomes the email body. */
function buildHtmlBody(fields: {
  /** This deploy's own origin (process.env.URL, set automatically by Netlify — same fallback convention as create-user.mts's loginUrl), so the emailed link follows the site wherever it's hosted instead of a domain baked in at write-time. */
  baseUrl: string;
  orderId: string;
  customerName: string;
  afdeling: string;
  vehicleIdent: string;
  parking: string;
  nummerplade: string;
  brand: string;
  maerke: string;
  aargang: string;
  fuelLevel: string;
  mileage: string;
  drivmiddel: string;
  fleetiiDevice: string;
  kontaktperson: string;
  kontaktemail: string;
  kontaktnummer: string;
}): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="border:1px solid #d6dce2;padding:6px 12px;font-weight:600;background:#f3f5f7;">${escapeHtml(label)}</td>
      <td style="border:1px solid #d6dce2;padding:6px 12px;">${escapeHtml(value)}</td>
    </tr>`;

  return `
    <h1>Ny bestilling af køretøj i FLEETii</h1>

    <p>En administrator hos ${escapeHtml(fields.customerName)} har anmodet om, at der
    oprettes et nyt køretøj i FLEETii. Se nedenstående detaljer.</p>
  
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
      ${row("Kunde", fields.customerName)}
      ${row("Afdeling", fields.afdeling)}
      ${row("P-plads", fields.parking || "—")}
      ${row("Køretøj-ID", fields.vehicleIdent || "—")}
      ${row("Nummerplade", fields.nummerplade)}
      ${row("Brand", fields.brand || "—")}
      ${row("Mærke", fields.maerke || "—")}
      ${row("Årgang", fields.aargang || "—")}
      ${row("Kilometerstand", fields.mileage || "—")}
      ${row("Drivmiddel", fields.drivmiddel)}
      ${row("Drivmiddelniveau", fields.fuelLevel || "—")}
      ${row("FLEETii device", fields.fleetiiDevice)}
      ${row("Kontaktperson", fields.kontaktperson)}
      ${row("Kontakt e-mail", fields.kontaktemail)}
      ${row("Kontakt tlf.", fields.kontaktnummer)}
    </table>
    
    <p>Du kan oprette køretøjet og registrere det i 2hire og FLEETii gennem flg. link:
    <a href="${fields.baseUrl}/vehicle-create/${fields.orderId}">${fields.baseUrl}/vehicle-create</a></p>

    <p>For at oprette køretøjet i FLEETii skal du logge ind på FLEETii med en
    FLEETii admin-bruger.</p>
    `;
}

/**
 * POST { afdeling?, departmentId?, vehicleIdent?, parking?, nummerplade, brand?, maerke?, aargang?, fuelLevel?, mileage?,
 * drivmiddel?, needsFleetiiDevice?, fleetiiDeviceId?, kontaktperson, kontaktemail,
 * kontaktnummer } as an authenticated admin (see requireAdmin). Validates every REQUIRED text field
 * is non-empty (plus fleetiiDeviceId when needsFleetiiDevice is false, plus
 * departmentId when the caller is a FLEETii admin — see the departmentId
 * resolution below) — brand/maerke/aargang/fuelLevel/mileage are all
 * optional, not always known at request time (brand/model/model_year can be
 * filled in later on VehicleCreatePage.tsx, see
 * costumer_orders_brand_model_year_nullable.sql). Inserts a matching
 * costumer_orders row (costumer_id/department_id from the caller's own
 * profile, or from the resolved departmentId for a FLEETii admin — see
 * below), then emails the request to MAIL_RECIEVER — via SMTP or Resend, see
 * sendMail.
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

  let body: SendVehicleRequestBody;
  try {
    body = (await req.json()) as SendVehicleRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const vehicleIdent = asTrimmedString(body.vehicleIdent);
  const parking = asTrimmedString(body.parking);
  const nummerplade = asNormalizedNumberString(body.nummerplade);
  const brand = asTrimmedString(body.brand);
  const maerke = asTrimmedString(body.maerke);
  const aargang = asTrimmedString(body.aargang);
  const fuelLevel = asTrimmedString(body.fuelLevel);
  const mileage = asTrimmedString(body.mileage);
  const drivmiddel = asTrimmedString(body.drivmiddel) || "Benzin";
  const kontaktperson = asTrimmedString(body.kontaktperson);
  const kontaktemail = asTrimmedString(body.kontaktemail);
  const kontaktnummer = asNormalizedNumberString(body.kontaktnummer);
  if (!nummerplade || !kontaktperson || !kontaktemail || !kontaktnummer) {
    return new Response(
      JSON.stringify({
        error: "Nummerplade, kontaktperson, kontakt e-mail og kontaktnummer er påkrævet.",
      }),
      { status: 400 },
    );
  }

  const needsFleetiiDevice = body.needsFleetiiDevice ?? true;
  const fleetiiDeviceId = asTrimmedString(body.fleetiiDeviceId);
  if (!needsFleetiiDevice && !fleetiiDeviceId) {
    return new Response(
      JSON.stringify({ error: "FLEETii device id er påkrævet, når der ikke skal installeres et nyt device." }),
      { status: 400 },
    );
  }
  const fleetiiDevice = needsFleetiiDevice ? "Nyt device skal installeres" : `Eksisterende device (id: ${fleetiiDeviceId})`;

  let afdeling = asTrimmedString(body.afdeling) || "—";


  const { data: caller } = await admin
    .from("user_profiles")
    .select("role, costumer_id, department_id")
    .eq("user_id", authResult.userId)
    .maybeSingle<{ role: string; costumer_id: string | null; department_id: string | null }>();

  // A FLEETii admin isn't scoped to one costumer (platform-wide role — same
  // exception as create-user.mts's own isFleetiiAdmin branch), so their own
  // profile's costumer_id/department_id can't be relied on here — the
  // Kunde/Afdeling picker they used (NewVehiclePage.tsx) supplies
  // departmentId instead, resolved to its OWN costumer_id below rather than
  // trusted as-is, same "don't trust the body directly" reasoning as the
  // module comment up top.
  let costumerId: string | null;
  let departmentId: string | null;
  if (isFleetiiAdminRole(caller?.role)) {
    const requestedDepartmentId = asTrimmedString(body.departmentId);
    if (!requestedDepartmentId) {
      return new Response(JSON.stringify({ error: "Kunde og afdeling er påkrævet." }), { status: 400 });
    }
    const { data: requestedDepartment } = await admin
      .from("departments")
      .select("department_id, name, costumer_id")
      .eq("department_id", requestedDepartmentId)
      .maybeSingle<{ department_id: string; name: string; costumer_id: string | null }>();
    if (!requestedDepartment?.costumer_id) {
      return new Response(JSON.stringify({ error: "Ugyldig afdeling." }), { status: 400 });
    }
    costumerId = requestedDepartment.costumer_id;
    departmentId = requestedDepartment.department_id;
    // Authoritative, not the client's own afdeling text — see the type's
    // own doc comment on departmentId.
    afdeling = requestedDepartment.name;
  } else {
    costumerId = caller?.costumer_id ?? null;
    departmentId = caller?.department_id ?? null;
  }

  if (!costumerId) {
    return new Response(
      JSON.stringify({ error: "Din bruger er ikke tilknyttet en kunde — kan ikke oprette bestillingen." }),
      { status: 403 },
    );
  }

  // The costumer name is only needed for the email built further below
  // (alongside insertedOrder.order_id), never by the insert itself — so this
  // read and the costumer_orders write run concurrently rather than one
  // after the other.
  const [{ data: customer }, { data: insertedOrder, error: insertError }] = await Promise.all([
    admin.from("costumers").select("name").eq("costumer_id", costumerId).maybeSingle<{ name: string | null }>(),
    admin
      .from("costumer_orders")
      .insert({
        order_type: "Opret",
        costumer_id: costumerId,
        department_id: departmentId,
        vehicle_ident: vehicleIdent || null,
        parking: parking || null,
        number_plate: nummerplade,
        brand: brand || null,
        model: maerke || null,
        model_year: aargang || null,
        fuel_level: fuelLevel || null,
        mileage: mileage || null,
        drivmiddel,
        needs_fleetii_device: needsFleetiiDevice,
        fleetii_device_id: needsFleetiiDevice ? null : fleetiiDeviceId,
        contactperson: kontaktperson,
        contactemail: kontaktemail,
        contactnumber: kontaktnummer,
      })
      .select("order_id")
      .single<{ order_id: string }>(),
  ]);
  const customerName = customer?.name ?? "—";

  if (insertError || !insertedOrder) {
    // Raw Postgres error logged server-side only — NewVehiclePage.tsx
    // already surfaces whatever `error` comes back here via its own
    // sendError state (the same path every other failure in this function
    // uses), so a clean Danish message is what the admin actually sees.
    console.error("[send-vehicle-request] costumer_orders insert failed:", insertError);
    return new Response(
      JSON.stringify({ error: "Kunne ikke oprette bestillingen. Prøv igen senere eller kontakt FLEETII direkte." }),
      { status: 500 },
    );
  }

  const result = await sendMail({
    to: mailReceiver,
    subject: `${customerName} - Oprettelse af nyt køretøj (${nummerplade}) i FLEETii`,
    html: buildHtmlBody({
      baseUrl: process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? "https://fleetii-webapp-staging.netlify.app",
      orderId: insertedOrder.order_id,
      customerName,
      afdeling,
      vehicleIdent: vehicleIdent ?? "",
      parking: parking ?? "",
      nummerplade,
      brand: brand ?? "",
      maerke: maerke ?? "",
      aargang: aargang ?? "",
      fuelLevel: fuelLevel ?? "",
      mileage: mileage ?? "",
      drivmiddel,
      fleetiiDevice,
      kontaktperson,
      kontaktemail,
      kontaktnummer,
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
