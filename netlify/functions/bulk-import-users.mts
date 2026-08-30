// Netlify Function: bulk-creates Brugere from a customer-supplied CSV or
// JSON file — the file-based sibling of create-user.mts, reusing the exact
// same account-creation mechanics (_shared/userAccount.ts: shared
// DEFAULT_USER_PASSWORD, must_change_password, retried auth-user creation,
// welcome email) but processing many rows in one request instead of one
// form submission. Unlike create-user.mts, this ALSO inserts into
// user_departments itself (see UserDetailsPage.tsx's own comment on that
// gap) — there's no client-side follow-up step here to do it afterward like
// the single-user admin UI has. An unrecognized "Afdeling" name just
// creates that department (see _shared/departmentLookup.ts), same as the
// vehicle import.
//
// Rows are processed sequentially, not in parallel — partly to keep
// findOrCreateDepartment's read-then-maybe-insert race-free within one
// batch (two rows naming the same brand-new department can't both "miss"
// the SELECT if they run one after another), and partly to avoid hammering
// Supabase's Auth API with a burst of concurrent createUser calls. A failed
// row is recorded and skipped — it does not abort the rest of the batch,
// matching 2hire-register-vehicle.mts's own "report per-row, don't abort"
// precedent for a similarly non-transactional multi-step write.
import type { SupabaseClient } from "@supabase/supabase-js";
import { asNormalizedNumberString, asTrimmedString } from "../../src/lib/requestValidation.js";
import { parseImportFile, type ImportRow } from "../../src/lib/bulkImportParsing.js";
import { getAdminClient } from "./_shared/adminClient.js";
import { isFleetiiAdminRole, requireAdmin } from "./_shared/serverAuth.js";
import { sendMail } from "./_shared/mailer.js";
import { findOrCreateDepartment } from "./_shared/departmentLookup.js";
import { buildWelcomeEmailHtml, createAuthUserWithRetry, type Role } from "./_shared/userAccount.js";

type BulkImportUsersBody = {
  format?: "csv" | "json";
  fileContent?: string;
  /** Only consulted for a caller with role "FLEETii admin" — a regular admin always imports into their own costumer (see below), same anti-tampering reasoning as create-user.mts's department check. */
  costumerId?: string;
};

type RowResult = { row: number; success: boolean; userId?: string; error?: string };

/** "user"/"admin" case-insensitively, or the Danish UI labels "Bruger"/"Administrator" — the template accepts either. Blank defaults to "user", matching create-user.mts's own default. Anything else is invalid. */
function normalizeRole(value: string | undefined): Role | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "") return "user";
  if (normalized === "user" || normalized === "bruger") return "user";
  if (normalized === "admin" || normalized === "administrator") return "admin";
  return null;
}

/**
 * POST { format: "csv"|"json", fileContent, costumerId? } as an
 * authenticated admin (see requireAdmin). Parses fileContent into rows
 * (Email required; Navn/Telefon/Bruger-ID/Afdeling/Rolle optional — see
 * public/templates/bulk-import/brugere-template.csv, also linked from
 * ImportUsersPage.tsx), resolves the batch's target
 * costumer (own costumer for a regular admin, required costumerId for a
 * FLEETii admin), then creates one auth user + user_profiles row +
 * user_departments grant per row, continuing past individual row failures.
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

  const defaultPassword = process.env.DEFAULT_USER_PASSWORD;
  if (!defaultPassword) {
    return new Response(JSON.stringify({ error: "Serveren mangler DEFAULT_USER_PASSWORD." }), { status: 500 });
  }

  let body: BulkImportUsersBody;
  try {
    body = (await req.json()) as BulkImportUsersBody;
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
    .select("costumer_id, role")
    .eq("user_id", authResult.userId)
    .maybeSingle<{ costumer_id: string | null; role: string }>();

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

  const loginUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? null;
  const manualUrl = loginUrl && process.env.VITE_BRUGERMANUAL_URL ? `${loginUrl}${process.env.VITE_BRUGERMANUAL_URL}` : null;

  // Caches a department name → id within this batch, so N rows in the same
  // department only look it up (or create it) once instead of N times.
  const departmentCache = new Map<string, string>();

  const results: RowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const outcome = await importUserRow(admin, rows[i], { costumerId, defaultPassword, departmentCache, loginUrl, manualUrl });
    results.push({ row: i + 1, ...outcome });
  }

  const successCount = results.filter((r) => r.success).length;
  return new Response(
    JSON.stringify({ results, successCount, failureCount: results.length - successCount }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

async function importUserRow(
  admin: SupabaseClient,
  row: ImportRow,
  ctx: { costumerId: string; defaultPassword: string; departmentCache: Map<string, string>; loginUrl: string | null; manualUrl: string | null },
): Promise<Omit<RowResult, "row">> {
  const email = asTrimmedString(row.Email);
  if (!email) {
    return { success: false, error: "Email mangler." };
  }

  const role = normalizeRole(asTrimmedString(row.Rolle));
  if (!role) {
    return { success: false, error: 'Rolle skal være "Bruger"/"user" eller "Administrator"/"admin".' };
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

  const { data: created, error: createError } = await createAuthUserWithRetry(
    admin,
    { email, password: ctx.defaultPassword },
    "bulk-import-users",
  );
  if (createError || !created?.user) {
    return { success: false, error: createError?.message ?? "Kunne ikke oprette bruger." };
  }

  const { error: profileError } = await admin.from("user_profiles").upsert({
    user_id: created.user.id,
    email,
    full_name: asTrimmedString(row.Navn) || null,
    phone: asNormalizedNumberString(row.Telefon) || null,
    user_ident: asTrimmedString(row["Bruger-ID"]) || null,
    department_id: departmentId,
    costumer_id: ctx.costumerId,
    role,
  });
  if (profileError) {
    // Same rollback as create-user.mts — don't leave an auth account with
    // no matching profile and no way to retry under the same email.
    const { error: rollbackError } = await admin.auth.admin.deleteUser(created.user.id);
    if (rollbackError) {
      console.error("[bulk-import-users] rollback of created user failed:", rollbackError);
    }
    return { success: false, error: profileError.message };
  }

  if (departmentId) {
    const { error: grantError } = await admin
      .from("user_departments")
      .insert({ user_id: created.user.id, department_id: departmentId });
    if (grantError) {
      // Not fatal to the row — the account and profile are already good;
      // surface it so the caller knows this one grant needs a manual
      // follow-up, rather than silently losing it.
      return {
        success: true,
        userId: created.user.id,
        error: `Bruger oprettet, men tildeling af afdeling fejlede: ${grantError.message}`,
      };
    }
  }

  const emailResult = await sendMail({
    to: email,
    subject: "Din FLEETii-konto er oprettet",
    html: buildWelcomeEmailHtml({ role, email, password: ctx.defaultPassword, loginUrl: ctx.loginUrl, manualUrl: ctx.manualUrl }),
  });
  if (!emailResult.ok) {
    console.error(`[bulk-import-users] welcome email failed for ${email} (account was still created):`, emailResult.error);
  }

  return { success: true, userId: created.user.id };
}
