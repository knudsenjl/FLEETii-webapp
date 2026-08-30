// Netlify Function: "test mode" utility that seeds every department in the
// system with a handful of realistic-looking bookings, so a manual
// interface test isn't staring at empty tables. Reached from the round test
// icon in PageHeader.tsx, which only shows when VITE_DATA_SOURCE isn't
// "2hire-production-adaptor" (see twoHireClient.ts's own reading of the same
// var for the same reasoning) — this function refuses outright if it is,
// as defense-in-depth against ever writing fabricated bookings into a real
// production fleet.
//
// For each department (system-wide — every costumer, not just the caller's
// own): picks a random count in [3, 7], creates that many bookings using a
// random vehicle (from vehicle_departments) and a random user (from
// user_departments) belonging to that department, with a random start
// within the next 72 hours and a random 30min-4h duration, PLUS one more
// booking with no end time (open-ended). A department with no vehicles or
// no users is skipped (nothing meaningful to book) rather than fabricating
// either.
//
// Uses the service-role client throughout rather than the caller's own
// session — bookings_insert_own_department.sql's RLS policy only allows
// inserting into the CALLER's own current department, which would make
// seeding every department impossible without switching department
// repeatedly; requireUser() below still verifies the caller is a real
// logged-in user first.
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
import { requireUser } from "./_shared/serverAuth.js";

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
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  if (process.env.VITE_DATA_SOURCE === "2hire-production-adaptor") {
    return new Response(
      JSON.stringify({ error: "Denne funktion kan ikke køre mod produktionsdata." }),
      { status: 403 },
    );
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  const [departmentsResult, vehicleDepartmentsResult, userDepartmentsResult, anvendelseResult] = await Promise.all([
    admin.from("departments").select("department_id, name").returns<DepartmentRow[]>(),
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
      return new Response(JSON.stringify({ error: result.error.message }), { status: 500 });
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
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }
        // Overlapping booking for that vehicle — retry with a fresh random pick.
      }
    }
    created.push({ department: departmentLabel, count: insertedForDepartment });
  }

  return new Response(JSON.stringify({ ok: true, created, skipped }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
