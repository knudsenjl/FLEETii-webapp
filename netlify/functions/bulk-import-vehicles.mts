// Netlify Function: bulk-creates pending vehicle requests from a
// customer-supplied CSV or JSON file — the file-based sibling of
// send-vehicle-request.mts, inserting the exact same kind of
// costumer_orders row (order_type: "Opret") per row instead of one at a
// time from NewVehiclePage.tsx's form.
//
// Deliberately does NOT call 2hire at all. A *real*, live vehicle_profiles
// row only comes into existence via 2hire's register API, which needs a QR
// code physically scanned off the installed hardware plus a 2hire
// board-profile id — inherently a one-vehicle-at-a-time, human-in-the-loop
// step (see 2hire-register-vehicle.mts) that no customer's exported
// inventory data would ever contain. This function creates the pending
// order only; an admin still finishes each vehicle's real 2hire pairing
// afterward, one at a time, via the existing VehicleCreatePage.tsx flow —
// unchanged.
//
// Unlike send-vehicle-request.mts, this does NOT email FLEETii staff per
// row — N rows would mean N emails. Contactperson/-email/-number are also
// not per-row fields (no customer inventory export has a "who do I contact
// about this specific vehicle" column) — supplied once for the whole batch,
// defaulting to the caller's own profile, same as NewVehiclePage.tsx's own
// pre-fill.
//
// Rows are processed sequentially, not in parallel — see
// bulk-import-users.mts's identical reasoning re: findOrCreateDepartment's
// race-free-within-one-batch requirement. A failed row is recorded and
// skipped, not fatal to the batch.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "./_shared/adminClient.js";
import { asNormalizedNumberString, asTrimmedString } from "../../src/lib/requestValidation.js";
import { parseImportFile, type ImportRow } from "../../src/lib/bulkImportParsing.js";
import { DRIVMIDDEL_OPTIONS } from "../../src/lib/bookings.js";
import { isFleetiiAdminRole, requireAdmin } from "./_shared/serverAuth.js";
import { findOrCreateDepartment } from "./_shared/departmentLookup.js";

type BulkImportVehiclesBody = {
  format?: "csv" | "json";
  fileContent?: string;
  /** Only consulted for a caller with role "FLEETii admin" — a regular admin always imports into their own costumer, same as bulk-import-users.mts. */
  costumerId?: string;
  /** Whole-batch contact fields — see file header. Default to the caller's own user_profiles row if omitted. */
  contactperson?: string;
  contactemail?: string;
  contactnumber?: string;
};

type RowResult = { row: number; success: boolean; orderId?: string; error?: string };

const DRIVMIDDEL_SET = new Set<string>(DRIVMIDDEL_OPTIONS);

/**
 * POST { format: "csv"|"json", fileContent, costumerId?, contactperson?,
 * contactemail?, contactnumber? } as an authenticated admin. Parses
 * fileContent into rows (Nummerplade required; Køretøj-ID/Afdeling/Brand/
 * Mærke/Årgang/Drivmiddel/P-plads/Kilometerstand/Drivmiddelniveau optional —
 * see public/templates/bulk-import/koretojer-template.csv), resolves the batch's
 * target costumer the same way bulk-import-users.mts does, then inserts one
 * costumer_orders "Opret" row per row, continuing past individual row
 * failures.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  let body: BulkImportVehiclesBody;
  try {
    body = (await req.json()) as BulkImportVehiclesBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const format = body.format;
  const fileContent = asTrimmedString(body.fileContent);
  if ((format !== "csv" && format !== "json") || !fileContent) {
    return new Response(
      JSON.stringify({ error: 'format ("csv" eller "json") og fileContent er påkrævet.' }),
      { status: 400 },
    );
  }

  let rows: ImportRow[];
  try {
    rows = parseImportFile(fileContent, format);
  } catch (parseError) {
    return new Response(
      JSON.stringify({ error: parseError instanceof Error ? parseError.message : "Kunne ikke læse filen." }),
      { status: 400 },
    );
  }
  if (rows.length === 0) {
    return new Response(JSON.stringify({ error: "Filen indeholder ingen rækker." }), { status: 400 });
  }


  const { data: caller } = await admin
    .from("user_profiles")
    .select("costumer_id, role, full_name, email, phone")
    .eq("user_id", authResult.userId)
    .maybeSingle<{ costumer_id: string | null; role: string; full_name: string | null; email: string | null; phone: string | null }>();

  const isFleetiiAdmin = isFleetiiAdminRole(caller?.role);
  let costumerId: string;
  if (isFleetiiAdmin) {
    const requested = asTrimmedString(body.costumerId);
    if (!requested) {
      return new Response(JSON.stringify({ error: "costumerId er påkrævet for FLEETii-administratorer." }), { status: 400 });
    }
    const { data: costumerRow } = await admin
      .from("costumers")
      .select("costumer_id")
      .eq("costumer_id", requested)
      .maybeSingle<{ costumer_id: string }>();
    if (!costumerRow) {
      return new Response(JSON.stringify({ error: "Ukendt costumerId." }), { status: 400 });
    }
    costumerId = costumerRow.costumer_id;
  } else {
    if (!caller?.costumer_id) {
      return new Response(JSON.stringify({ error: "Din bruger er ikke tilknyttet en kunde." }), { status: 403 });
    }
    costumerId = caller.costumer_id;
  }

  // Whole-batch contact fields, defaulting to the caller's own profile —
  // same pre-fill NewVehiclePage.tsx does for a single request.
  const contactperson = asTrimmedString(body.contactperson) || asTrimmedString(caller?.full_name ?? undefined) || null;
  const contactemail = asTrimmedString(body.contactemail) || asTrimmedString(caller?.email ?? undefined) || null;
  const contactnumber = asNormalizedNumberString(body.contactnumber) || asNormalizedNumberString(caller?.phone ?? undefined) || null;
  if (!contactperson || !contactemail || !contactnumber) {
    return new Response(
      JSON.stringify({ error: "Kontaktperson, kontakt e-mail og kontaktnummer mangler (og kunne ikke udledes fra din egen profil)." }),
      { status: 400 },
    );
  }

  const departmentCache = new Map<string, string>();

  const results: RowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const outcome = await importVehicleRow(admin, rows[i], {
      costumerId,
      contactperson,
      contactemail,
      contactnumber,
      departmentCache,
    });
    results.push({ row: i + 1, ...outcome });
  }

  const successCount = results.filter((r) => r.success).length;
  return new Response(
    JSON.stringify({ results, successCount, failureCount: results.length - successCount }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

async function importVehicleRow(
  admin: SupabaseClient,
  row: ImportRow,
  ctx: {
    costumerId: string;
    contactperson: string;
    contactemail: string;
    contactnumber: string;
    departmentCache: Map<string, string>;
  },
): Promise<Omit<RowResult, "row">> {
  const numberPlate = asNormalizedNumberString(row.Nummerplade);
  if (!numberPlate) {
    return { success: false, error: "Nummerplade mangler." };
  }

  const rawDrivmiddel = asTrimmedString(row.Drivmiddel);
  const drivmiddel = rawDrivmiddel || "Benzin";
  if (!DRIVMIDDEL_SET.has(drivmiddel)) {
    return { success: false, error: `Drivmiddel skal være en af: ${DRIVMIDDEL_OPTIONS.join(", ")}.` };
  }

  const departmentName = asTrimmedString(row.Afdeling);
  let departmentId: string | null = null;
  if (departmentName) {
    const cached = ctx.departmentCache.get(departmentName);
    if (cached) {
      departmentId = cached;
    } else {
      const resolved = await findOrCreateDepartment(admin, { name: departmentName, costumerId: ctx.costumerId });
      if ("error" in resolved) {
        return { success: false, error: `Afdeling "${departmentName}": ${resolved.error}` };
      }
      departmentId = resolved.departmentId;
      ctx.departmentCache.set(departmentName, departmentId);
    }
  }

  const { data: insertedOrder, error: insertError } = await admin
    .from("costumer_orders")
    .insert({
      order_type: "Opret",
      costumer_id: ctx.costumerId,
      department_id: departmentId,
      vehicle_ident: asTrimmedString(row["Køretøj-ID"]) || null,
      parking: asTrimmedString(row["P-plads"]) || null,
      number_plate: numberPlate,
      brand: asTrimmedString(row.Brand) || null,
      model: asTrimmedString(row["Mærke"]) || null,
      model_year: asTrimmedString(row["Årgang"]) || null,
      fuel_level: asTrimmedString(row["Drivmiddelniveau"]) || null,
      mileage: asTrimmedString(row["Kilometerstand"]) || null,
      drivmiddel,
      needs_fleetii_device: true,
      fleetii_device_id: null,
      contactperson: ctx.contactperson,
      contactemail: ctx.contactemail,
      contactnumber: ctx.contactnumber,
    })
    .select("order_id")
    .single<{ order_id: string }>();

  if (insertError || !insertedOrder) {
    return { success: false, error: insertError?.message ?? "Kunne ikke oprette bestillingen." };
  }

  return { success: true, orderId: insertedOrder.order_id };
}
