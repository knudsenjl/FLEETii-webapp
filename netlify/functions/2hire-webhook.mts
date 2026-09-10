// Netlify Function: public webhook callback for 2hire's generic AND
// specific vehicle signals (both topic kinds, subscribed to via
// 2hire-subscribe.mts). Every delivery — known or not — is recorded into
// `vehicle_signal_history` (append-only, service-role write, see
// vehicle_signal_history_table.sql), so nothing 2hire sends is ever
// silently lost. On top of that, the GENERIC signals this app actually
// tracks live (online, position, distance_covered, autonomy_percentage, ...)
// ALSO update the `vehicle_signals` "current state" table (service-role
// write — there is no SQL INSERT/UPDATE policy for this table, see
// vehicle_signals_table.sql), which liveVehicleDataSource.ts then reads
// (RLS-gated, authenticated users only) to serve VehicleGPS2Hire data. These
// two writes are deliberately independent: an unrecognized signal still
// gets a history row even though it has no live-state column to update yet.
// "Specific" signals (model/OEM-specific — names and payload shapes vary by
// vehicle profile, unlike the fixed generic vocabulary) only get the
// history row UNLESS explicitly allowlisted in
// SPECIFIC_SIGNALS_APPLIED_TO_CURRENT_STATE below — an arbitrary specific
// name isn't safe to run through upsert_vehicle_signal_if_newer()'s generic
// mapping (see vehicle_signals_upsert_if_newer_function.sql) since a
// different OEM's own signal name could coincidentally collide with a real
// generic one, but a deliberately named, known-safe exception (like
// "trip_detected" — confirmed by 2hire to genuinely be a "specific" signal,
// not generic as vehicle_signals_add_trip_detected.sql originally assumed)
// is fine to apply the same way a generic signal would be.
// A "position" signal additionally pushes a Realtime Broadcast message
// (see the bottom of the handler below) straight to any browser currently
// watching FleetManagementPage.tsx's "Live" toggle — see
// VehicleContext.tsx's own "fleet-positions:*" broadcast listener — so the
// map marker moves the instant 2hire reports it, instead of that page
// having to poll for changes. Sent to TWO topics: the vehicle's own
// "fleet-positions:<costumerId>" (what that costumer's own users/admins
// subscribe to) AND the fixed "fleet-positions:sysadm" (what a
// sysadm subscribes to instead, since they need every costumer's
// positions at once, e.g. FleetManagementPage's "Alle" filter) — see
// fleet_positions_realtime_authorization.sql's RLS policy on
// realtime.messages, which is what actually restricts who may receive each
// topic; sending to both here is just picking the right addressees, not the
// security boundary itself.
//
// Docs: https://developer.2hire.io/docs/receiving-signals
import { getAdminClient } from "./_shared/adminClient.js";
import { isWebhookSignatureValid } from "./_shared/webhookSignature.js";

const TOPIC_PATTERN = /^vehicle:([^:]+):(generic|specific):([a-z_]+)$/;

/** "Specific" signal names that ARE applied to vehicle_signals "current state" despite arriving under the "specific" topic kind — see this file's own header comment for why this needs to be an explicit, known-safe allowlist rather than every specific signal. */
const SPECIFIC_SIGNALS_APPLIED_TO_CURRENT_STATE = new Set(["trip_detected"]);

type SignalPayload = { timestamp: number; data: Record<string, unknown> };
type WebhookBody = { topic: string; payload: SignalPayload };

export default async (req: Request) => {
  const url = new URL(req.url);

  // WebSub-style subscription confirmation: 2hire GETs the callback once
  // with hub.challenge and expects it echoed back verbatim.
  if (req.method === "GET") {
    const challenge = url.searchParams.get("hub.challenge");
    if (!challenge) {
      console.warn("[2hire-webhook] GET with no hub.challenge — not a subscription confirmation we recognize.");
      return new Response("Missing hub.challenge", { status: 400 });
    }
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  if (req.method !== "POST") {
    console.warn(`[2hire-webhook] rejected method: ${req.method}`);
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const secret = process.env.TWOHIRE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[2hire-webhook] TWOHIRE_WEBHOOK_SECRET is not set — cannot validate any delivery.");
    return new Response(JSON.stringify({ error: "Serveren mangler TWOHIRE_WEBHOOK_SECRET." }), { status: 500 });
  }
  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    console.error("[2hire-webhook] getAdminClient() failed:", adminClientResult.error);
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  // Signature validation needs the exact raw bytes 2hire signed, so read the
  // body as text once — never JSON.parse first and re-stringify.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-hub-signature") ?? "";
  if (!isWebhookSignatureValid(rawBody, secret, signatureHeader)) {
    // Diagnostic-only: never logs the secret or the computed/expected
    // signature, just enough to tell a genuinely bad/missing signature
    // apart from e.g. 2hire silently changing their signing scheme — header
    // PRESENCE and body LENGTH, nothing that could help forge one. The
    // topic itself isn't secret (it's just "vehicle:<id>:generic:<name>",
    // no different from what a valid delivery's history row already
    // records), so it's safe to best-effort peek at it here PURELY for
    // logging — this does NOT mean the body is trusted or processed, the
    // request is still rejected with 401 either way; this is only here to
    // tell whether failures cluster on one vehicle/costumer/signal type or
    // are spread evenly (see 2026-09-10 intermittent-GPS-gap investigation).
    let unverifiedTopic = "unparseable";
    try {
      unverifiedTopic = (JSON.parse(rawBody) as { topic?: string }).topic ?? "(no topic field)";
    } catch {
      // leave as "unparseable" — not valid JSON either
    }
    console.warn(
      `[2hire-webhook] signature validation failed — x-hub-signature ${signatureHeader ? "present" : "MISSING"}, body length ${rawBody.length}, unverified topic: "${unverifiedTopic}".`,
    );
    return new Response(JSON.stringify({ error: "Ugyldig signatur." }), { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    console.warn(`[2hire-webhook] body was not valid JSON (length ${rawBody.length}): ${rawBody.slice(0, 500)}`);
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const topicMatch = TOPIC_PATTERN.exec(body.topic);
  if (!topicMatch) {
    // Not a shape we recognize at all — acknowledge so 2hire doesn't retry,
    // but do nothing with it. There's no vehicle_id/signal name to record
    // here, so there's nothing meaningful to put in the history table
    // either. Still worth a log line: this is otherwise a completely silent
    // drop, and the exact raw topic string is the one thing that can tell
    // us whether 2hire is sending something this regex just doesn't expect.
    console.warn(`[2hire-webhook] topic did not match TOPIC_PATTERN, dropped: "${body.topic}"`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const [, vehicleId, topicKind, signal] = topicMatch;
  console.log(`[2hire-webhook] received ${topicKind}/${signal} for vehicle ${vehicleId}, signal_timestamp ${new Date(body.payload.timestamp).toISOString()}`);

  // Every signal delivery gets a history row — generic or specific, known
  // or not, see this file's own header comment and
  // vehicle_signal_history_table.sql.
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

  // GENERIC signals, plus the small explicit allowlist of "specific"
  // signals in SPECIFIC_SIGNALS_APPLIED_TO_CURRENT_STATE above, update
  // vehicle_signals "current state" — every OTHER "specific" signal's name
  // varies by vehicle profile and could coincidentally collide with a
  // generic one (e.g. some OEM's own "online"), so those are never passed
  // here at all. Already preserved in the history insert above either way,
  // so there's nothing lost by leaving an unlisted specific signal out of
  // "current state".
  //
  // upsert_vehicle_signal_if_newer() (see
  // vehicle_signals_upsert_if_newer_function.sql) is both the column
  // mapping for every currently-recognized generic signal AND a guard
  // against a stale, out-of-order delivery clobbering a fresher one already
  // stored — a plain `.upsert()` here had neither check, so two concurrent
  // deliveries for the same vehicle+signal could let whichever one
  // committed LAST silently win regardless of which payload was actually
  // newer. An unrecognized generic signal is still passed through — the
  // function's own ELSE branch just does nothing for it, same as before.
  // `signalApplied` (false for a rejected-as-stale or unrecognized signal)
  // also gates the live position broadcast below, so a discarded stale
  // delivery can't flash the map to a wrong position on its way to being
  // correctly ignored here.
  let signalApplied = false;
  if (topicKind === "generic" || SPECIFIC_SIGNALS_APPLIED_TO_CURRENT_STATE.has(signal)) {
    const { data, error } = await admin.rpc("upsert_vehicle_signal_if_newer", {
      p_vehicle_id: vehicleId,
      p_signal: signal,
      p_timestamp: new Date(body.payload.timestamp).toISOString(),
      p_data: body.payload.data,
    });
    if (error) {
      console.error("[2hire-webhook] failed to persist signal:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    signalApplied = Boolean(data);
    if (!signalApplied) {
      console.log(`[2hire-webhook] ${signal} for vehicle ${vehicleId} was NOT applied to current state (stale/out-of-order delivery, per upsert_vehicle_signal_if_newer).`);
    }
  }

  // Pushes the new position straight to any browser currently watching
  // FleetManagementPage.tsx's "Live" toggle (see VehicleContext.tsx's own
  // "fleet-positions:*" broadcast listener) — a plain Realtime Broadcast
  // message, not tied to any table, so this needs no table
  // publication/postgres_changes setup (unlike a postgres_changes
  // subscription, which was considered and rejected as overbuilt for this)
  // — it DOES need the realtime.messages RLS policy in
  // fleet_positions_realtime_authorization.sql, since these are now private,
  // authorized channels rather than one open global one. httpSend() posts
  // over REST without holding a WebSocket open, which is what makes this
  // safe to call from a single, short-lived function invocation. Scoped to
  // "position" only — the map marker is the only thing this drives;
  // online/trip_detected/etc. stay on the existing once-per-session fetch.
  // Best-effort: a failure here is logged, never turned into a failed
  // response to 2hire — the vehicle_signals write above already persisted
  // the real state, so a missed broadcast just means the map isn't
  // live-updated until the next page load/refresh, not a data loss.
  if (topicKind === "generic" && signal === "position" && signalApplied) {
    try {
      const { data: vehicle, error: vehicleError } = await admin
        .from("vehicle_profiles")
        .select("costumer_id")
        .eq("vehicle_id", vehicleId)
        .maybeSingle<{ costumer_id: string | null }>();
      if (vehicleError) throw new Error(`Kunne ikke slå køretøjets kunde op: ${vehicleError.message}`);

      const positionPayload = {
        vehicleId,
        lat: Number(body.payload.data.latitude),
        lng: Number(body.payload.data.longitude),
      };

      // Every costumer's own topic, plus the fixed sysadm one (always
      // sent regardless of costumer_id, so a sysadm keeps seeing
      // every vehicle move) — see this function's own header comment.
      const topics = ["fleet-positions:sysadm"];
      if (vehicle?.costumer_id) topics.push(`fleet-positions:${vehicle.costumer_id}`);

      for (const topic of topics) {
        const channel = admin.channel(topic);
        await channel.httpSend("position", positionPayload);
        await admin.removeChannel(channel);
      }
    } catch (broadcastError) {
      console.error("[2hire-webhook] failed to broadcast live position:", broadcastError);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
