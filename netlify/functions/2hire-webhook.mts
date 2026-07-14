// Netlify Function: public webhook callback for 2hire's generic vehicle
// signals (online, position, distance_covered, autonomy_percentage),
// subscribed to via 2hire-subscribe.mts. Persists the latest value of each
// signal into the `vehicle_signals` Supabase table (service-role write —
// there is no SQL INSERT/UPDATE policy for this table, see
// supabase/vehicle_signals_table.sql), which liveVehicleDataSource.ts then
// reads (RLS-gated, authenticated users only) to serve VehicleGPS2Hire data.
//
// Docs: https://developer.2hire.io/docs/receiving-signals
import { createClient } from "@supabase/supabase-js";
import { isWebhookSignatureValid } from "./_shared/webhookSignature.js";

const TOPIC_PATTERN = /^vehicle:([^:]+):generic:([a-z_]+)$/;

type SignalPayload = { timestamp: number; data: Record<string, unknown> };
type WebhookBody = { topic: string; payload: SignalPayload };

/** Maps one recognized 2hire generic signal to the `vehicle_signals` columns it updates. Unrecognized signals return null (ignored, not an error — the wildcard subscription may deliver signals we don't track). */
function toColumnUpdate(
  signal: string,
  payload: SignalPayload,
): Record<string, string | number | boolean> | null {
  const updatedAt = new Date(payload.timestamp).toISOString();

  switch (signal) {
    case "online":
      return { online: Boolean(payload.data.online), online_updated_at: updatedAt };
    case "position":
      return {
        lat: Number(payload.data.latitude),
        lng: Number(payload.data.longitude),
        position_updated_at: updatedAt,
      };
    case "distance_covered":
      return { distance_covered_meters: Number(payload.data.meters), distance_covered_updated_at: updatedAt };
    case "autonomy_percentage":
      return { autonomy_percentage: Number(payload.data.percentage), autonomy_percentage_updated_at: updatedAt };
    default:
      return null;
  }
}

export default async (req: Request) => {
  const url = new URL(req.url);

  // WebSub-style subscription confirmation: 2hire GETs the callback once
  // with hub.challenge and expects it echoed back verbatim.
  if (req.method === "GET") {
    const challenge = url.searchParams.get("hub.challenge");
    if (!challenge) {
      return new Response("Missing hub.challenge", { status: 400 });
    }
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const secret = process.env.TWOHIRE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Serveren mangler TWOHIRE_WEBHOOK_SECRET/SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY." }),
      { status: 500 },
    );
  }

  // Signature validation needs the exact raw bytes 2hire signed, so read the
  // body as text once — never JSON.parse first and re-stringify.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-hub-signature") ?? "";
  if (!isWebhookSignatureValid(rawBody, secret, signatureHeader)) {
    return new Response(JSON.stringify({ error: "Ugyldig signatur." }), { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const topicMatch = TOPIC_PATTERN.exec(body.topic);
  if (!topicMatch) {
    // Not a shape we recognize (e.g. a "specific" signal) — acknowledge so
    // 2hire doesn't retry, but do nothing with it.
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const [, vehicleId, signal] = topicMatch;
  const columnUpdate = toColumnUpdate(signal, body.payload);
  if (!columnUpdate) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin.from("vehicle_signals").upsert({ vehicle_id: vehicleId, ...columnUpdate });
  if (error) {
    console.error("[2hire-webhook] failed to persist signal:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
