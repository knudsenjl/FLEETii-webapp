import { createClient } from "@supabase/supabase-js";
import { asTrimmedString } from "../../src/lib/requestValidation.js";

type CreateUserBody = {
  email?: string;
  full_name?: string | null;
  phone?: string | null;
  department?: string | null;
  role?: string;
};

const ALLOWED_ROLES = ["user", "admin"] as const;
type Role = (typeof ALLOWED_ROLES)[number];

function isAllowedRole(value: string): value is Role {
  return (ALLOWED_ROLES as readonly string[]).includes(value);
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Serveren mangler SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY." }),
      { status: 500 },
    );
  }

  let body: CreateUserBody;
  try {
    body = (await req.json()) as CreateUserBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const email = asTrimmedString(body.email);
  if (!email) {
    return new Response(JSON.stringify({ error: "E-mail er påkrævet." }), { status: 400 });
  }

  const rawRole = asTrimmedString(body.role) || "user";
  if (!isAllowedRole(rawRole)) {
    return new Response(JSON.stringify({ error: 'Rolle skal være "user" eller "admin".' }), { status: 400 });
  }
  const role = rawRole;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Creates the auth.users row and emails the person a link to set their
  // own password — safer than generating one server-side and passing it
  // back through the client.
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);

  if (inviteError || !invited.user) {
    return new Response(JSON.stringify({ error: inviteError?.message ?? "Kunne ikke oprette bruger." }), {
      status: 400,
    });
  }

  // Upsert rather than update: covers both the case where a DB trigger
  // already created the profiles row from auth.users, and the case where
  // it didn't.
  const { error: profileError } = await admin.from("profiles").upsert({
    id: invited.user.id,
    email,
    full_name: body.full_name ?? null,
    phone: body.phone ?? null,
    department: body.department ?? null,
    role,
  });

  if (profileError) {
    // Roll back the invite so the email isn't permanently stuck as "already
    // registered" with no matching profile and no way to retry.
    const { error: rollbackError } = await admin.auth.admin.deleteUser(invited.user.id);
    if (rollbackError) {
      console.error("[create-user] rollback of invited user failed:", rollbackError);
    }
    return new Response(JSON.stringify({ error: profileError.message }), { status: 400 });
  }

  return new Response(JSON.stringify({ id: invited.user.id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
