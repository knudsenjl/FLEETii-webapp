// Shared between CostumerNewPage.tsx and CostumerDetailsPage.tsx — both
// write to costumers.cvr, both need the same friendly translation of a
// unique-constraint violation.

/** Maps a Postgres unique_violation (23505) on the costumers_cvr_unique constraint (see supabase/applied/costumers_cvr_unique.sql) to a Danish message a sysadm can act on, instead of the raw driver error. */
export function friendlyCostumerError(error: { code?: string; message: string } | null, fallback: string): string {
  if (error?.code === "23505") {
    return "Der findes allerede en kunde med dette CVR-nummer.";
  }
  return error?.message ?? fallback;
}
