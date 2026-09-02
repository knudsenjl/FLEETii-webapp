// Netlify Function: the real "Registrér køretøj i 2hire" fulfillment action
// for a costumer_orders "Opret" order (VehicleCreatePage.tsx) — FLEETii-
// admin gated (same access level as the rest of that page). Registers a
// physical 2hire-board device (by its printed QR code, plus a chosen 2hire
// vehicle-configuration profile — see 2hire-board-profiles.mts) as a new
// vehicle in 2hire, then inserts the resulting vehicle into our own DB:
//   0. An atomic claim (registration_claimed_at, see
//      costumer_orders_add_registration_claimed_at.sql) — guards against two
//      CONCURRENT requests for the same order both calling registerVehicle
//      and provisioning two separate real 2hire devices for the same QR
//      code. Distinct from the vehicle_id retry-idempotency anchor below,
//      which guards against SEQUENTIAL retries after a partial failure —
//      the two together cover both races.
//   1. registerVehicle({qrCode, profileId}) -> real 2hire vehicleId, then
//      IMMEDIATELY persisted onto costumer_orders.vehicle_id before
//      anything else — the retry-idempotency anchor (see below).
//   2. vehicle_profiles upsert (vehicle_ident/number_plate/brand/model/
//      model_year/costumer_id/department_id snapshotted from the order,
//      plus iot_id (the QR code itself) and twohire_profile (the profile's
//      human-readable label, as picked in the UI — see
//      vehicle_profiles_add_twohire_profile.sql) — both sysadm-only
//      read-only info on VehicleDetailsPage.tsx, editable on
//      HandleVehiclePage.tsx)
//   3. vehicle_departments upsert (if the order has a department_id)
//   4. costumer_orders update: vehicle_registered + iot_device_associated
//      set together — 2hire's actual API has no separate "associate IoT
//      device" endpoint distinct from registration (a device's QR code IS
//      what's being associated when it's registered), so these two
//      checklist steps collapse into one real action here.
//
// Deliberately does NOT attempt to undo step 1 if a later step fails (no
// compensating deregisterVehicle call) — a partial failure here leaves a
// real 2hire vehicle without a fully-finalized vehicle_profiles row, which
// this function itself recovers from on retry rather than by silently
// deregistering something FLEETii staff may already be relying on:
// EVERY step from 2 onward is now idempotent (vehicle_profiles/
// vehicle_departments both upsert; the final update just re-sets the same
// flags), and step 1 is SKIPPED on a retry once costumer_orders.vehicle_id
// is already set — so calling this function again with the same orderId
// after a partial failure resumes from wherever it stopped instead of
// re-registering a second physical device for the same qrCode, and any
// step 2-4 failure now returns a real error (never a silent {ok:true})
// so the UI can't report completion while the order is still open.
//
// Per the "per-costumer 2hire credentials" plan: registerVehicle authenticates
// with the order's own costumer_id's sub-account credential (resolved fresh
// via resolveTwoHireCredentials, not hardcoded to global) even though this
// route is itself sysadm-gated — see delete-vehicle.mts's identical
// reasoning.
import { getAdminClient } from "./_shared/adminClient.js";
import { isSysadmRole, requireSysadm } from "./_shared/serverAuth.js";
import { registerVehicle } from "./_shared/twoHireClient.js";
import { resolveTwoHireCredentials } from "./_shared/twoHireCredentials.js";

type RegisterVehicleOrderBody = { orderId?: string; qrCode?: string; profileId?: string; profileLabel?: string | null };

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireSysadm(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  let body: RegisterVehicleOrderBody;
  try {
    body = (await req.json()) as RegisterVehicleOrderBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const orderId = body.orderId?.trim();
  const qrCode = body.qrCode?.trim();
  const profileId = body.profileId?.trim();
  const profileLabel = body.profileLabel?.trim() || null;
  if (!orderId || !qrCode || !profileId) {
    return new Response(JSON.stringify({ error: "orderId, qrCode og profileId er påkrævet." }), { status: 400 });
  }


  const { data: order } = await admin
    .from("costumer_orders")
    .select(
      "order_type, costumer_id, department_id, vehicle_ident, number_plate, brand, model, model_year, drivmiddel, parking, vehicle_id, vehicle_registered",
    )
    .eq("order_id", orderId)
    .maybeSingle<{
      order_type: string;
      costumer_id: string;
      department_id: string | null;
      vehicle_ident: string | null;
      number_plate: string;
      /** Optional as of costumer_orders_brand_model_year_nullable.sql — Brand/Mærke/Årgang are no longer required on NewVehiclePage.tsx's "Ny bestilling" form, so a vehicle can be registered before they're ever filled in (VehicleCreatePage.tsx's own editable Brand/Mærke/Årgang rows, with the MotorAPI fill button). vehicle_profiles.brand/model/model_year are nullable too, so passing null straight through below is fine. */
      brand: string | null;
      model: string | null;
      model_year: string | null;
      /** NOT NULL on both costumer_orders and vehicle_profiles (default "Benzin") — see costumer_orders_add_drivmiddel.sql / vehicle_profiles_add_drivmiddel.sql. Always a real value, unlike brand/model/model_year. */
      drivmiddel: string;
      /** Optional free text, see costumer_orders_add_parking.sql / vehicle_profiles_add_parking.sql — nullable on both sides, same as brand/model/model_year. */
      parking: string | null;
      /** Set by THIS function (see the early-persist write below) the first time registerVehicle succeeds for this order — the retry-idempotency anchor: a retry reuses this instead of calling registerVehicle again. Nullable: unset until a real 2hire registration has actually happened for this order. */
      vehicle_id: string | null;
      /** True only once every finalization step below (vehicle_profiles/vehicle_departments/this same column) has actually succeeded — see the early-return below for the "fully done, nothing to do" case. */
      vehicle_registered: boolean;
    }>();

  if (!order) {
    return new Response(JSON.stringify({ error: "Bestillingen findes ikke." }), { status: 404 });
  }
  if (order.order_type !== "Opret") {
    return new Response(JSON.stringify({ error: "Denne bestilling er ikke en oprettelse." }), { status: 400 });
  }

  // Already fully completed by an earlier call — nothing left to do. Not
  // just an optimization: re-running the writes below is harmless (they're
  // all idempotent now), but there's no reason to.
  if (order.vehicle_id && order.vehicle_registered) {
    return new Response(JSON.stringify({ ok: true, vehicleId: order.vehicle_id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let vehicleId: string;
  if (order.vehicle_id) {
    // A previous call already registered the real 2hire device and
    // persisted vehicle_id (see the early-persist write below) but didn't
    // finish finalizing (vehicle_profiles/vehicle_departments/marking the
    // order complete) — reuse it rather than registering a SECOND physical
    // device for the same qrCode. This is the actual fix for "retries
    // aren't safe": before, nothing on the order recorded that
    // registerVehicle had already succeeded, so a retry re-ran it from
    // scratch.
    vehicleId = order.vehicle_id;
  } else {
    // Atomic claim — only one concurrent request for this order may
    // proceed past this point. Without it, two requests could both read
    // vehicle_id IS NULL above, both call registerVehicle (each
    // provisioning a SEPARATE real 2hire device for the same physical QR
    // code), then race to persist their own vehicleId onto the order —
    // whichever write lands last wins, silently orphaning the other real
    // 2hire vehicle with no matching vehicle_profiles row and no way to
    // discover it again. A single UPDATE ... WHERE ... is safe here without
    // any extra locking: Postgres serializes concurrent UPDATEs against the
    // same row, so the second one to actually execute re-evaluates this
    // WHERE clause against the FIRST one's already-committed change and
    // matches zero rows — see costumer_orders_add_registration_claimed_at.sql.
    // The staleness window (registration_claimed_at older than this) lets a
    // claim self-heal if the claiming request crashed/timed out mid-flight
    // instead of locking the order out of ever being retried.
    const CLAIM_STALE_AFTER_MS = 2 * 60 * 1000;
    const staleThreshold = new Date(Date.now() - CLAIM_STALE_AFTER_MS).toISOString();
    const { data: claimed, error: claimError } = await admin
      .from("costumer_orders")
      .update({ registration_claimed_at: new Date().toISOString() })
      .eq("order_id", orderId)
      .is("vehicle_id", null)
      .or(`registration_claimed_at.is.null,registration_claimed_at.lt.${staleThreshold}`)
      .select("order_id");
    if (claimError) {
      return new Response(JSON.stringify({ error: claimError.message }), { status: 500 });
    }
    if (!claimed || claimed.length === 0) {
      // Someone else (a genuinely concurrent request, or one that hasn't
      // hit the staleness window yet) already holds the claim — report
      // in-progress rather than starting a second registration. A retry a
      // little later either finds vehicle_id already set (reuses it, see
      // above) or the claim gone stale (reclaims it).
      return new Response(
        JSON.stringify({ error: "Registrering er allerede i gang for denne bestilling. Prøv igen om lidt." }),
        { status: 409 },
      );
    }

    try {
      const { data: caller, error: callerError } = await admin
        .from("user_profiles")
        .select("role")
        .eq("user_id", authResult.userId)
        .maybeSingle<{ role: string }>();
      if (callerError) throw new Error(`Kunne ikke slå brugeren op: ${callerError.message}`);

      const isSysadm = isSysadmRole(caller?.role);
      const credentials = await resolveTwoHireCredentials(admin, { isSysadm, costumerId: order.costumer_id });

      const result = await registerVehicle({ qrCode, profileId }, credentials);
      vehicleId = result.vehicleId;
    } catch (error) {
      // Releases the claim rather than leaving it to expire on its own —
      // 2hire has already responded (with a failure), so nothing is
      // actually "in progress" anymore, and an admin fixing a bad
      // qrCode/profileId shouldn't have to wait out the staleness window
      // just to retry immediately.
      await admin.from("costumer_orders").update({ registration_claimed_at: null }).eq("order_id", orderId);
      const message = error instanceof Error ? error.message : "Ukendt fejl.";
      return new Response(JSON.stringify({ error: message }), { status: 502 });
    }

    // Persisted immediately, before any of the finalization steps below —
    // this is the anchor a retry checks (order.vehicle_id above). If this
    // write itself fails, a retry has no way to know registration already
    // happened and WOULD re-register a duplicate device — surfaced as an
    // error (not swallowed) with the real vehicleId included so staff can
    // reconcile manually rather than retry blindly.
    const { error: anchorError } = await admin
      .from("costumer_orders")
      .update({ vehicle_id: vehicleId })
      .eq("order_id", orderId);
    if (anchorError) {
      console.error("[2hire-register-vehicle] failed to persist vehicle_id anchor:", anchorError);
      return new Response(
        JSON.stringify({
          error: `Køretøjet blev registreret i 2hire (vehicleId: ${vehicleId}), men bestillingen kunne ikke opdateres: ${anchorError.message}. Kontakt en udvikler før du prøver igen.`,
        }),
        { status: 500 },
      );
    }
  }

  const { error: profileError } = await admin.from("vehicle_profiles").upsert({
    vehicle_id: vehicleId,
    vehicle_ident: order.vehicle_ident,
    number_plate: order.number_plate,
    brand: order.brand,
    model: order.model,
    model_year: order.model_year,
    drivmiddel: order.drivmiddel,
    parking: order.parking,
    costumer_id: order.costumer_id,
    department_id: order.department_id,
    iot_id: qrCode,
    twohire_profile: profileLabel,
  });
  if (profileError) {
    console.error("[2hire-register-vehicle] vehicle_profiles upsert failed:", profileError);
    return new Response(
      JSON.stringify({
        error: `Køretøjet blev registreret i 2hire (vehicleId: ${vehicleId}), men kunne ikke gemmes i FLEETii: ${profileError.message}`,
      }),
      { status: 500 },
    );
  }

  if (order.department_id) {
    // upsert + ignoreDuplicates, not a plain insert: a retry may be
    // re-running this after it already succeeded once (vehicle_id,
    // department_id is the table's own primary key — see
    // vehicle_departments_table.sql) — a plain insert would fail with a
    // duplicate-key error on that second attempt instead of being a no-op.
    const { error: departmentError } = await admin
      .from("vehicle_departments")
      .upsert({ vehicle_id: vehicleId, department_id: order.department_id }, { ignoreDuplicates: true });
    if (departmentError) {
      console.error("[2hire-register-vehicle] vehicle_departments upsert failed:", departmentError);
      return new Response(
        JSON.stringify({
          error: `Køretøjet blev registreret i 2hire (vehicleId: ${vehicleId}), men kunne ikke tilknyttes afdelingen: ${departmentError.message}. Prøv igen — registreringen i 2hire gentages ikke.`,
        }),
        { status: 500 },
      );
    }
  }

  const { error: orderError } = await admin
    .from("costumer_orders")
    .update({ vehicle_registered: true, iot_device_associated: true })
    .eq("order_id", orderId);
  if (orderError) {
    console.error("[2hire-register-vehicle] costumer_orders update failed:", orderError);
    return new Response(
      JSON.stringify({
        error: `Køretøjet blev registreret i 2hire og gemt (vehicleId: ${vehicleId}), men bestillingen kunne ikke markeres som færdig: ${orderError.message}. Prøv igen — registreringen i 2hire gentages ikke.`,
      }),
      { status: 500 },
    );
  }

  return new Response(JSON.stringify({ ok: true, vehicleId }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
