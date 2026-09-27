// Netlify Function: "test mode" utility that seeds departments (every
// department system-wide for a sysadm, or just the caller's own
// costumer's for a regular admin — see the costumerId scoping below) with a
// handful of realistic-looking bookings, so a manual
// interface test isn't staring at empty tables. Reached from the
// "Seed Test Reservations" button on the sysadm-only /test-center page
// (TestCenterPage.tsx). What stops it from ever writing fabricated bookings
// into real production data is testDataGuard.ts's three independent
// server-side checks (not the production site; connected to the staging
// database by an allowlist; the database itself marked as staging), plus a
// required { confirmed: true } body from the page's confirmation dialog.
//
// For each department — every costumer's for a sysadm, or only the
// caller's OWN costumer's for a regular admin (see the costumerId scoping
// below; requireAdmin() lets either role trigger this at all, once the two
// env checks above have already allowed it to run): picks a random count in
// [3, 7], creates that many bookings using a random vehicle (from
// vehicle_departments) and a random user (from user_departments) belonging
// to that department, with a random start within the next 72 hours and a
// random 30min-4h duration, PLUS one more booking with no end time
// (open-ended). A department with no vehicles or no users is skipped
// (nothing meaningful to book) rather than fabricating either.
//
// Uses the service-role client throughout rather than the caller's own
// session — bookings_insert_own_department.sql's RLS policy only allows
// inserting into the CALLER's own current department, which would make
// seeding every department impossible without switching department
// repeatedly. Since the service-role client bypasses RLS entirely, the
// costumerId scoping below is what stands in for it here: a regular admin
// must never be able to fabricate bookings in another costumer's
// departments just because this route doesn't run under their own session.
//
// Bookings has a genuine EXCLUDE USING gist (vehicle_id WITH =,
// tstzrange(start, "end") WITH &&) constraint (see
// bookings_end_nullable.sql) — random picks WILL occasionally collide,
// especially for small fleets or the open-ended booking (which excludes the
// rest of time for that vehicle) — so each insert retries with a fresh
// random pick on a 23P01 (exclusion_violation) error rather than treating
// one collision as fatal. Overlapping bookings for DIFFERENT vehicles are
// fine (and expected, at this booking density) — only the same vehicle can't
// be double-booked.
import { getAdminClient } from "./_shared/adminClient.js";
import { randomInt } from "node:crypto";
import { isSysadmRole, requireAdmin } from "./_shared/serverAuth.js";
import { json } from "./_shared/http.js";
import { isConfirmedSeedRequest, testDataDatabaseBlocked, testDataEnvironmentBlocked } from "./_shared/testDataGuard.js";

const MIN_BOOKINGS_PER_DEPARTMENT = 3;
const MAX_BOOKINGS_PER_DEPARTMENT = 7;
const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 240;
const WINDOW_HOURS = 72;
const MAX_INSERT_ATTEMPTS = 20;
/** Postgres error code for an exclusion-constraint violation (the booking-overlap guard). */
const EXCLUSION_VIOLATION = "23P01";

type DepartmentRow = { department_id: string; name: string | null };
type VehicleDepartmentRow = { vehicle_id: string; department_id: string };
type UserDepartmentRow = { user_id: string; department_id: string };
type AnvendelseRow = { department_id: string; value: string[] | null };

function pick<T>(items: T[]): T {
  return items[randomInt(items.length)];
}

/** A random Date within [now, now + WINDOW_HOURS). */
function randomStart(now: number): Date {
  return new Date(now + randomInt(0, WINDOW_HOURS * 60 * 60 * 1000));
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const environmentBlocked = testDataEnvironmentBlocked();
  if (environmentBlocked) return environmentBlocked;

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return json({ error: authResult.error }, authResult.status);
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return json({ error: adminClientResult.error }, adminClientResult.status);
  }
  const { admin } = adminClientResult;

  const body = await req.json().catch(() => null);
  if (!isConfirmedSeedRequest(body)) {
    return json({ error: "Handlingen skal bekræftes." }, 400);
  }

  const databaseBlocked = await testDataDatabaseBlocked(admin);
  if (databaseBlocked) return databaseBlocked;

  const { data: caller, error: callerError } = await admin
    .from("user_profiles")
    .select("role, costumer_id")
    .eq("user_id", authResult.userId)
    .maybeSingle<{ role: string; costumer_id: string | null }>();
  if (callerError) {
    return json({ error: callerError.message }, 500);
  }

  const isSysadm = isSysadmRole(caller?.role);
  // A regular admin only seeds their OWN costumer's departments — a
  // sysadm (no costumer of their own) still seeds every department
  // system-wide, unchanged from before this scoping was added.
  if (!isSysadm && !caller?.costumer_id) {
    return json({ error: "Din bruger er ikke tilknyttet en kunde." }, 403);
  }

  // .eq() (a PostgrestFilterBuilder method) has to be applied before
  // .returns<>() (which narrows to a PostgrestTransformBuilder that no
  // longer has .eq()) — so the conditional lives inside the query
  // construction itself rather than reassigning a .returns()-typed variable.
  const departmentsQuery = (
    !isSysadm && caller?.costumer_id
      ? admin.from("departments").select("department_id, name").eq("costumer_id", caller.costumer_id)
      : admin.from("departments").select("department_id, name")
  ).returns<DepartmentRow[]>();

  const [departmentsResult, vehicleDepartmentsResult, userDepartmentsResult, anvendelseResult] = await Promise.all([
    departmentsQuery,
    admin.from("vehicle_departments").select("vehicle_id, department_id").returns<VehicleDepartmentRow[]>(),
    admin.from("user_departments").select("user_id, department_id").returns<UserDepartmentRow[]>(),
    admin
      .from("department_settings")
      .select("department_id, value")
      .eq("name", "Anvendelse")
      .returns<AnvendelseRow[]>(),
  ]);

  for (const result of [departmentsResult, vehicleDepartmentsResult, userDepartmentsResult, anvendelseResult]) {
    if (result.error) {
      return json({ error: result.error.message }, 500);
    }
  }

  const vehiclesByDepartment = new Map<string, string[]>();
  for (const row of vehicleDepartmentsResult.data ?? []) {
    const list = vehiclesByDepartment.get(row.department_id);
    if (list) list.push(row.vehicle_id);
    else vehiclesByDepartment.set(row.department_id, [row.vehicle_id]);
  }

  const usersByDepartment = new Map<string, string[]>();
  for (const row of userDepartmentsResult.data ?? []) {
    const list = usersByDepartment.get(row.department_id);
    if (list) list.push(row.user_id);
    else usersByDepartment.set(row.department_id, [row.user_id]);
  }

  const anvendelseByDepartment = new Map<string, string[]>();
  for (const row of anvendelseResult.data ?? []) {
    anvendelseByDepartment.set(row.department_id, row.value ?? []);
  }

  const now = Date.now();
  const created: { department: string; count: number }[] = [];
  const skipped: { department: string; reason: string }[] = [];

  for (const department of departmentsResult.data ?? []) {
    const vehicles = vehiclesByDepartment.get(department.department_id) ?? [];
    const users = usersByDepartment.get(department.department_id) ?? [];
    const departmentLabel = department.name ?? department.department_id;

    if (vehicles.length === 0) {
      skipped.push({ department: departmentLabel, reason: "Ingen køretøjer i afdelingen." });
      continue;
    }
    if (users.length === 0) {
      skipped.push({ department: departmentLabel, reason: "Ingen brugere i afdelingen." });
      continue;
    }

    const anvendelser = anvendelseByDepartment.get(department.department_id);
    const usageOptions = anvendelser && anvendelser.length > 0 ? anvendelser : ["Erhverv"];
    const bookingCount = randomInt(MIN_BOOKINGS_PER_DEPARTMENT, MAX_BOOKINGS_PER_DEPARTMENT + 1);

    let insertedForDepartment = 0;
    // bookingCount random-duration bookings, plus one final open-ended one.
    for (let i = 0; i < bookingCount + 1; i++) {
      const openEnded = i === bookingCount;

      for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
        const start = randomStart(now);
        const end = openEnded
          ? null
          : new Date(start.getTime() + randomInt(MIN_DURATION_MINUTES, MAX_DURATION_MINUTES + 1) * 60 * 1000);

        const { error } = await admin.from("bookings").insert({
          vehicle_id: pick(vehicles),
          user_id: pick(users),
          department_id: department.department_id,
          usage: pick(usageOptions),
          start: start.toISOString(),
          end: end ? end.toISOString() : null,
        });

        if (!error) {
          insertedForDepartment++;
          break;
        }
        if (error.code !== EXCLUSION_VIOLATION) {
          return json({ error: error.message }, 500);
        }
        // Overlapping booking for that vehicle — retry with a fresh random pick.
      }
    }
    created.push({ department: departmentLabel, count: insertedForDepartment });
  }

  return json({ ok: true, created, skipped }, 200);
};
