// Netlify SCHEDULED function (no HTTP callers): once a day, anonymises every
// drop-in guest whose booking ended more than 30 days ago — the retention
// rule the user decided on 2026-09-26. All the logic lives in the SQL
// function public.anonymize_expired_drop_in_guests() (see
// supabase/applied/booking_guests_anonymize.sql, which says exactly what is
// cleared and what is kept); this only calls it with the service-role client
// and logs the count. Scheduled functions can't be invoked by URL in
// production, so there's no caller to authorize.
import { getAdminClient } from "./_shared/adminClient.js";

export default async () => {
  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    console.error("[anonymize-drop-in-guests]", adminClientResult.error);
    return new Response(null, { status: 500 });
  }

  const { data, error } = await adminClientResult.admin.rpc("anonymize_expired_drop_in_guests");
  if (error) {
    console.error("[anonymize-drop-in-guests] rpc failed:", error);
    return new Response(null, { status: 500 });
  }
  console.log(`[anonymize-drop-in-guests] anonymised ${data ?? 0} drop-in guest(s)`);
  return new Response(null, { status: 200 });
};

// 03:15 UTC daily — a quiet hour; the exact time doesn't matter for a
// 30-day rule.
// A plain object (no @netlify/functions Config type — not a dependency here);
// Netlify reads `schedule` from it statically at deploy time.
export const config = { schedule: "15 3 * * *" };
