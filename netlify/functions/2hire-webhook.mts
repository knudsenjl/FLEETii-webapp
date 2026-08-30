// Netlify Function: public webhook callback for 2hire's generic vehicle
// signals, subscribed to via 2hire-subscribe.mts. Every delivery — known or
// not — is recorded into `vehicle_signal_history` (append-only, service-
// role write, see vehicle_signal_history_table.sql), so nothing 2hire sends
// is ever silently lost. On top of that, the four signals this app actually
// tracks live (online, position, distance_covered, autonomy_percentage)
// ALSO update the `vehicle_signals` "current state" table (service-role
// write — there is no SQL INSERT/UPDATE policy for this table, see
// vehicle_signals_table.sql), which liveVehicleDataSource.ts then reads
// (RLS-gated, authenticated users only) to serve VehicleGPS2Hire data. These
// two writes are deliberately independent: an unrecognized signal still
// gets a history row even though it has no live-state column to update yet.
// A "position" signal additionally pushes a Realtime Broadcast message
// (see the bottom of the handler below) straight to any browser currently
// watching FleetManagementPage.tsx's "Live" toggle — see
// VehicleContext.tsx's own "fleet-positions" broadcast listener — so the
// map marker moves the instant 2hire reports it, instead of that page
// having to poll for changes.
//
// Docs: https://developer.2hire.io/docs/receiving-signals
import { getAdminClient } from "./_shared/adminClient.js";
import { isWebhookSignatureValid } from "./_shared/webhookSignature.js";

const TOPIC_PATTERN = /^vehicle:([^:]+):generic:([a-z_]+)$/;

type SignalPayload = { timestamp: number; data: Record<string, unknown> };
type WebhookBody = { topic: string; payload: SignalPayload };

/** Maps one recognized 2hire generic signal to the `vehicle_signals` columns it updates. Unrecognized signals return null — that's fine for LIVE state (nothing in the UI has anywhere to show it yet), but it's still recorded into vehicle_signal_history regardless, see the handler below. */
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
    // See vehicle_signals_add_trip_detected.sql. The payload.data key is
    // inferred as "trip_detected" (self-named, same convention as "online"'s
    // own payload.data.online) — 2hire's docs for this specific signal
    // weren't available while wiring this up; every delivery is preserved
    // verbatim in vehicle_signal_history.signal_value regardless, so a wrong
    // guess here is recoverable/verifiable from real delivered payloads
    // without losing any data.
    case "trip_detected":
      return { trip_detected: Boolean(payload.data.trip_detected), trip_detected_updated_at: updatedAt };
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
  if (!secret) {
    return new Response(JSON.stringify({ error: "Serveren mangler TWOHIRE_WEBHOOK_SECRET." }), { status: 500 });
  }
  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

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
    // 2hire doesn't retry, but do nothing with it. Unlike an unrecognized
    // GENERIC signal below, there's no vehicle_id/signal name to record
    // here at all, so there's nothing meaningful to put in the history
    // table either.
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const [, vehicleId, signal] = topicMatch;


  // Every generic signal gets a history row — known or not, see this
  // file's own header comment and vehicle_signal_history_table.sql.
  const { error: historyError } = await admin.from("vehicle_signal_history").insert({
    vehicle_id: vehicleId,
    signal_type: signal,
    signal_value: body.payload.data,
    signal_timestamp: new Date(body.payload.timestamp).toISOString(),
  });
  if (historyError) {
    console.error("[2hire-webhook] failed to record signal history:", historyError);
    return new Response(JSON.stringify({ error: historyError.message }), { status: 500 });
  }

  // Only the signals this app actually tracks live update vehicle_signals —
  // an unrecognized one is already preserved in the history insert above,
  // so there's nothing lost by leaving it out of "current state" here.
  const columnUpdate = toColumnUpdate(signal, body.payload);
  if (columnUpdate) {
    const { error } = await admin.from("vehicle_signals").upsert({ vehicle_id: vehicleId, ...columnUpdate });
    if (error) {
      console.error("[2hire-webhook] failed to persist signal:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  }

  // Pushes the new position straight to any browser currently watching
  // FleetManagementPage.tsx's "Live" toggle (see VehicleContext.tsx's own
  // "fleet-positions" broadcast listener) — a plain Realtime Broadcast
  // message, not tied to any table, so this needs no RLS/publication setup
  // at all (unlike a postgres_changes subscription, which was considered
  // and rejected as overbuilt for this). httpSend() posts over REST without
  // holding a WebSocket open, which is what makes this safe to call from a
  // single, short-lived function invocation. Scoped to "position" only —
  // the map marker is the only thing this drives; online/trip_detected/etc.
  // stay on the existing once-per-session fetch. Best-effort: a failure
  // here is logged, never turned into a failed response to 2hire — the
  // vehicle_signals write above already persisted the real state, so a
  // missed broadcast just means the map isn't live-updated until the next
  // page load/refresh, not a data loss.
  if (signal === "position") {
    try {
      const channel = admin.channel("fleet-positions");
      await channel.httpSend("position", {
        vehicleId,
        lat: Number(body.payload.data.latitude),
        lng: Number(body.payload.data.longitude),
      });
      await admin.removeChannel(channel);
    } catch (broadcastError) {
      console.error("[2hire-webhook] failed to broadcast live position:", broadcastError);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
