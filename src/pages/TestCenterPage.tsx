// Test center ("/test-center", sysadm-only — see App.tsx's requireRole=
// "sysadm" on this route; formerly "/2hire-command"). Collects the tools used
// for testing, top to bottom:
//   - Testdata: "Seed Test Reservations" (seed-test-bookings.mts — moved here
//     2026-09-27 from the round flask icon that used to sit in PageHeader's
//     top pane) and "Seed Vehicle Health Data" (seed-vehicle-health.mts —
//     fake 2hire signals showing every vehicle-health outcome). Both are
//     shown only in test mode (isTestMode below) and ask for confirmation
//     first (SEED_CONFIRM_MESSAGE); the real boundary against writing test
//     data into production is server-side, see
//     netlify/functions/_shared/testDataGuard.ts.
//   - 2hire kommando: type an arbitrary 2hire Adapter API request ("METODE
//     /sti", e.g. "POST /api/v1/vehicle/{AB12345}/command/generic/locate")
//     and see the raw JSON response — see 2hire-raw-command.mts for the
//     request/placeholder-substitution logic. A "{plate}" token anywhere in
//     the command is resolved server-side to that vehicle's real 2hire
//     vehicle_id.
//   - Signalværdi: read the current value of one generic/specific signal
//     for one vehicle (by number plate) straight from 2hire — see
//     2hire-read-signal.mts. Read-only, nothing is saved.
//   - Signal-backfill: see 2hire-backfill-vehicle-signals.mts.
// This page is a thin form around those Functions, no business logic of its
// own.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { PageShell } from "../components/PageShell";
import { PageSection } from "../components/PageSection";
import { SectionHeading } from "../components/SectionHeading";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { callFunction } from "../lib/callFunction";
import { formatDanishDateTime } from "../lib/time";

/** True unless VITE_DATA_SOURCE is explicitly the real production adaptor — same "anything else is the safe/test default" convention as twoHireClient.ts's own reading of this var server-side. Only decides whether the Testdata buttons are shown; the Functions re-check server-side. */
const isTestMode =
  import.meta.env.VITE_DATA_SOURCE !== "2hire-production-adaptor";

/** The confirmation every seed button asks for before writing simulated data (user wording, 2026-09-27). Confirming sends { confirmed: true }, which the seed Functions require. */
const SEED_CONFIRM_MESSAGE =
  "Denne funktion vil generere simulerede data i databasen. Er du sikker på, at du ønsker at tilføje simulerede data til databasen?";

/** One vehicle's fake-signal scenario, as returned by seed-vehicle-health.mts. */
type SeededScenario = {
  vehicle: string;
  costumer: string;
  scenario: string;
  expected: string;
};

/** The shape 2hire-raw-command.mts always resolves to on a 200 — either this or {error} (see handleExecute). */
type RawCommandResult = {
  requestUrl: string;
  status: number;
  ok: boolean;
  result: unknown;
};

/** The shape 2hire-read-signal.mts resolves to on a 200 — either this or {error} (see handleReadSignal). */
type SignalReadResult = {
  vehicleId: string;
  numberPlate: string | null;
  kind: "generic" | "specific";
  signal: string;
  found: boolean;
  data: Record<string, unknown> | null;
  timestamp: string | null;
};

/** Signal names offered as suggestions in the Signalværdi form — the ones this app already tracks (see 2hire-backfill-vehicle-signals.mts). Any other name can still be typed. */
const SIGNAL_SUGGESTIONS = {
  generic: ["distance_covered", "autonomy_percentage", "autonomy_meters", "position", "online"],
  specific: ["trip_detected"],
} as const;

/** The shape 2hire-backfill-vehicle-signals.mts always resolves to on a 200 — either this or {error} (see handleBackfill). */
type BackfillResult = {
  dryRun: boolean;
  totalVehicles: number;
  signalsChecked: string[];
  missingCount: number;
  applied: number;
  noData: number;
  failedCount: number;
  failures: {
    vehicleId: string;
    numberPlate: string | null;
    signal: string;
    error: string;
  }[];
};

export function TestCenterPage() {
  const navigate = useNavigate();
  const [command, setCommand] = useState(
    "POST /api/v1/vehicle/{AB12345}/command/generic/locate",
  );
  const [body, setBody] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RawCommandResult | null>(null);

  const [signalPlate, setSignalPlate] = useState("");
  const [signalKind, setSignalKind] = useState<"generic" | "specific">(
    "generic",
  );
  const [signalName, setSignalName] = useState("distance_covered");
  const [isReadingSignal, setIsReadingSignal] = useState(false);
  const [signalError, setSignalError] = useState<string | null>(null);
  const [signalResult, setSignalResult] = useState<SignalReadResult | null>(
    null,
  );

  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(
    null,
  );

  /** Which seed is waiting for the user's answer in the confirmation dialog, or null when none is open. */
  const [confirmingSeed, setConfirmingSeed] = useState<"bookings" | "health" | null>(null);
  const [seedingBookings, setSeedingBookings] = useState(false);
  const [bookingSeedMessage, setBookingSeedMessage] = useState<string | null>(
    null,
  );
  const [seedingHealth, setSeedingHealth] = useState(false);
  const [healthSeedError, setHealthSeedError] = useState<string | null>(null);
  const [healthScenarios, setHealthScenarios] = useState<
    SeededScenario[] | null
  >(null);

  /** Calls seed-test-bookings.mts to give every department a handful of realistic bookings (a sysadm seeds every costumer's departments), then shows a one-line summary. */
  const handleSeedTestBookings = async () => {
    setSeedingBookings(true);
    setBookingSeedMessage(null);
    try {
      const response = await callFunction<{
        created?: { department: string; count: number }[];
        skipped?: { department: string; reason: string }[];
      }>("seed-test-bookings", { body: { confirmed: true } });
      if (!response.ok) {
        setBookingSeedMessage(
          response.data.error ?? "Kunne ikke oprette testreservationer.",
        );
        return;
      }
      const { created = [], skipped = [] } = response.data;
      const total = created.reduce((sum, d) => sum + d.count, 0);
      setBookingSeedMessage(
        `${total} testreservationer oprettet i ${created.length} afdelinger` +
          (skipped.length > 0
            ? ` (${skipped.length} afdeling(er) sprunget over).`
            : "."),
      );
    } catch {
      setBookingSeedMessage("Kunne ikke kontakte serveren. Prøv igen senere.");
    } finally {
      setSeedingBookings(false);
    }
  };

  /** Calls seed-vehicle-health.mts, which gives every vehicle one of 10 fake-signal scenarios, and lists which vehicle got which. */
  const handleSeedVehicleHealth = async () => {
    setSeedingHealth(true);
    setHealthSeedError(null);
    setHealthScenarios(null);
    try {
      const response = await callFunction<{ scenarios: SeededScenario[] }>(
        "seed-vehicle-health",
        { body: { confirmed: true } },
      );
      if (!response.ok) {
        setHealthSeedError(
          response.data.error ?? "Kunne ikke oprette testdata.",
        );
        return;
      }
      setHealthScenarios(response.data.scenarios);
    } catch {
      setHealthSeedError("Kunne ikke kontakte serveren. Prøv igen senere.");
    } finally {
      setSeedingHealth(false);
    }
  };

  const handleExecute = async () => {
    setIsExecuting(true);
    setError(null);
    setResult(null);

    try {
      const response = await callFunction("2hire-raw-command", {
        body: { command, body: body.trim() || undefined },
      });
      if (!response.ok) {
        const failure = response.data as { error?: string } | null;
        setError(failure?.error ?? "Kommandoen fejlede.");
        return;
      }
      setResult(response.data as RawCommandResult);
    } catch {
      setError("Kunne ikke kontakte serveren. Prøv igen senere.");
    } finally {
      setIsExecuting(false);
    }
  };

  /** Reads one signal's current value for one vehicle via 2hire-read-signal.mts (read-only — nothing is saved). */
  const handleReadSignal = async () => {
    setIsReadingSignal(true);
    setSignalError(null);
    setSignalResult(null);

    try {
      const response = await callFunction<SignalReadResult>(
        "2hire-read-signal",
        {
          body: { plate: signalPlate, kind: signalKind, signal: signalName },
        },
      );
      if (!response.ok) {
        setSignalError(response.data.error ?? "Signalopslaget fejlede.");
        return;
      }
      setSignalResult(response.data);
    } catch {
      setSignalError("Kunne ikke kontakte serveren. Prøv igen senere.");
    } finally {
      setIsReadingSignal(false);
    }
  };

  /** Triggers the one-off signal-backfill Function (see 2hire-backfill-vehicle-signals.mts's own doc comment) — dryRun previews without writing, an explicit real run does. */
  const handleBackfill = async (dryRun: boolean) => {
    if (
      !dryRun &&
      !window.confirm(
        "Dette skriver rigtige signal-værdier for HELE flåden. Fortsæt?",
      )
    )
      return;

    setIsBackfilling(true);
    setBackfillError(null);
    setBackfillResult(null);

    try {
      const response = await callFunction("2hire-backfill-vehicle-signals", {
        body: { dryRun },
      });
      if (!response.ok) {
        const failure = response.data as { error?: string } | null;
        setBackfillError(failure?.error ?? "Backfill fejlede.");
        return;
      }
      setBackfillResult(response.data as BackfillResult);
    } catch {
      setBackfillError("Kunne ikke kontakte serveren. Prøv igen senere.");
    } finally {
      setIsBackfilling(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        hideAfdeling
        kundeNavigate={{
          onSelect: (costumerId) => navigate(`/costumer-details/${costumerId}`),
        }}
      />

      {/* Separate cards (Testcenter, 2hire kommando, Signalværdi, Signal-backfill), each only as tall as its content, in one scrolling column. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {isTestMode && (
          <PageSection grow={false} className="gap-4">
            <div>
              <SectionHeading>Testcenter (kun testmiljø)</SectionHeading>
              <p className="mt-1 text-sm text-brand-600">
                "Seed Test Reservations" opretter 3-7 tilfældige reservationer i
                hver afdeling (plus én uden sluttidspunkt).
                <br />
                "Seed Vehicle Health Data" giver hvert køretøj falske 2hire-signaler, så alle udfald
                af køretøjets sundhedsmærke (intet, gult, rødt) kan ses i
                køretøjsoversigten. Tiderne regnes fra nu — kør igen for at
                opfriske dem.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setConfirmingSeed("bookings")}
                disabled={seedingBookings}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {seedingBookings ? "Opretter…" : "Seed Test Reservations"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingSeed("health")}
                disabled={seedingHealth}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {seedingHealth ? "Opretter…" : "Seed Vehicle Health Data"}
              </button>
            </div>

            {bookingSeedMessage && (
              <p className="text-sm text-brand-700">{bookingSeedMessage}</p>
            )}
            {healthSeedError && (
              <p className="text-sm text-red-600">{healthSeedError}</p>
            )}
            {healthScenarios && (
              <div className="max-h-72 overflow-auto rounded-lg border border-brand-100">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-brand-50 text-brand-700">
                    <tr>
                      <th className="px-2 py-1 font-semibold">Kunde</th>
                      <th className="px-2 py-1 font-semibold">Køretøj</th>
                      <th className="px-2 py-1 font-semibold">Scenarie</th>
                      <th className="px-2 py-1 font-semibold">
                        Forventet mærke
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 text-brand-900">
                    {healthScenarios.map((row) => (
                      <tr key={`${row.costumer}-${row.vehicle}`}>
                        <td className="px-2 py-1">{row.costumer}</td>
                        <td className="px-2 py-1">{row.vehicle}</td>
                        <td className="px-2 py-1">{row.scenario}</td>
                        <td className="px-2 py-1">{row.expected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PageSection>
        )}

        <PageSection grow={false} className="gap-4">
          <div>
            <SectionHeading>
              2hire kommando (Kun til testformål - fjernes når test er
              overstået)
            </SectionHeading>
            <p className="mt-1 text-sm text-brand-600">
              Skriv en 2hire-forespørgsel som "METODE /sti", f.eks.{" "}
              <code className="rounded bg-brand-50 px-1 py-0.5 text-xs">
                POST /api/v1/vehicle/{"{AB12345}"}/command/generic/locate
              </code>
              . Nummerplader i tuborg-klammer ({"{...}"}) slås automatisk op og
              erstattes med køretøjets 2hire vehicle_id. Stien behøver ikke
              starte med "/" — den lægges så oveni 2hires normale adapter-host.
              Skriv i stedet en fuld URL (f.eks.{" "}
              <code className="rounded bg-brand-50 px-1 py-0.5 text-xs">
                https://e2e.adapter.2hire.io/devices
              </code>
              ) for at ramme et andet 2hire-host, f.eks. e2e/simulations-hosten.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="twohire-command"
              className="text-sm font-medium text-brand-700"
            >
              Kommando
            </label>
            <input
              id="twohire-command"
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              spellCheck={false}
              className="rounded-lg border border-brand-200 px-3 py-2 font-mono text-sm text-brand-900 focus:border-brand-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="twohire-body"
              className="text-sm font-medium text-brand-700"
            >
              Body (JSON, valgfri)
            </label>
            <textarea
              id="twohire-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="{}"
              className="rounded-lg border border-brand-200 px-3 py-2 font-mono text-sm text-brand-900 focus:border-brand-500 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleExecute()}
            disabled={isExecuting || !command.trim()}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isExecuting ? "Udfører…" : "Udfør"}
          </button>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {result && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-brand-600">
                <span className="font-medium">{result.requestUrl}</span> →{" "}
                <span
                  className={
                    result.ok
                      ? "font-medium text-green-700"
                      : "font-medium text-red-600"
                  }
                >
                  {result.status}
                </span>
              </p>
              <pre className="max-h-96 overflow-auto rounded-lg border border-brand-100 bg-brand-50 p-3 text-xs text-brand-900">
                {JSON.stringify(result.result, null, 2)}
              </pre>
            </div>
          )}
        </PageSection>

        <PageSection grow={false} className="gap-4">
          <div>
            <SectionHeading>Signalværdi</SectionHeading>
            <p className="mt-1 text-sm text-brand-600">
              Henter den aktuelle værdi af ét generic- eller specific-signal for
              ét køretøj direkte fra 2hire (med kundens egen 2hire-adgang).
              Intet gemmes i databasen.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="signal-plate"
                className="text-sm font-medium text-brand-700"
              >
                Nummerplade
              </label>
              <input
                id="signal-plate"
                type="text"
                value={signalPlate}
                onChange={(e) => setSignalPlate(e.target.value)}
                placeholder="AB12345"
                spellCheck={false}
                className="rounded-lg border border-brand-200 px-3 py-2 font-mono text-sm text-brand-900 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="signal-kind"
                className="text-sm font-medium text-brand-700"
              >
                Type
              </label>
              <select
                id="signal-kind"
                value={signalKind}
                onChange={(e) =>
                  setSignalKind(e.target.value as "generic" | "specific")
                }
                className="rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900 focus:border-brand-500 focus:outline-none"
              >
                <option value="generic">generic</option>
                <option value="specific">specific</option>
              </select>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label
                htmlFor="signal-name"
                className="text-sm font-medium text-brand-700"
              >
                Signal
              </label>
              <input
                id="signal-name"
                type="text"
                list="signal-suggestions"
                value={signalName}
                onChange={(e) => setSignalName(e.target.value)}
                spellCheck={false}
                className="rounded-lg border border-brand-200 px-3 py-2 font-mono text-sm text-brand-900 focus:border-brand-500 focus:outline-none"
              />
              <datalist id="signal-suggestions">
                {SIGNAL_SUGGESTIONS[signalKind].map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <button
              type="button"
              onClick={() => void handleReadSignal()}
              disabled={
                isReadingSignal || !signalPlate.trim() || !signalName.trim()
              }
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isReadingSignal ? "Henter…" : "Hent værdi"}
            </button>
          </div>

          {signalError && <p className="text-sm text-red-600">{signalError}</p>}

          {signalResult && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-brand-600">
                <span className="font-medium">
                  {signalResult.numberPlate ?? signalResult.vehicleId}
                </span>{" "}
                · {signalResult.kind}/{signalResult.signal} ·{" "}
                {signalResult.found && signalResult.timestamp ? (
                  <span className="font-medium text-green-700">
                    {formatDanishDateTime(signalResult.timestamp)}
                  </span>
                ) : (
                  <span className="font-medium text-red-600">
                    Ingen værdi hos 2hire
                  </span>
                )}
              </p>
              {signalResult.found && (
                <pre className="max-h-96 overflow-auto rounded-lg border border-brand-100 bg-brand-50 p-3 text-xs text-brand-900">
                  {JSON.stringify(signalResult.data, null, 2)}
                </pre>
              )}
            </div>
          )}
        </PageSection>

        <PageSection grow={false} className="gap-4">
          <div>
            <SectionHeading>Signal-backfill</SectionHeading>
            <p className="mt-1 text-sm text-brand-600">
              Engangsopgave: henter
              distance_covered/autonomy_percentage/autonomy_meters/position/online
              (generic) og trip_detected (specific) direkte fra 2hire for
              ethvert køretøj, der endnu ikke har en
              vehicle_signals_latest-række for det pågældende signal, og gemmer
              i både vehicle_signal_history og vehicle_signals_latest. Kør altid
              "Preview" først.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleBackfill(true)}
              disabled={isBackfilling}
              className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBackfilling ? "Kører…" : "Preview (dry run)"}
            </button>
            <button
              type="button"
              onClick={() => void handleBackfill(false)}
              disabled={isBackfilling}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBackfilling ? "Kører…" : "Kør for virkelig"}
            </button>
          </div>

          {backfillError && (
            <p className="text-sm text-red-600">{backfillError}</p>
          )}

          {backfillResult && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-brand-600">
                <span
                  className={
                    backfillResult.dryRun
                      ? "font-medium text-brand-700"
                      : "font-medium text-green-700"
                  }
                >
                  {backfillResult.dryRun
                    ? "DRY RUN — intet skrevet"
                    : "Skrevet"}
                </span>{" "}
                · {backfillResult.totalVehicles} køretøjer ·{" "}
                {backfillResult.missingCount} manglende signaler ·{" "}
                {backfillResult.applied} fundet · {backfillResult.noData} ingen
                data hos 2hire · {backfillResult.failedCount} fejlede
              </p>
              {backfillResult.failures.length > 0 && (
                <pre className="max-h-64 overflow-auto rounded-lg border border-brand-100 bg-brand-50 p-3 text-xs text-brand-900">
                  {JSON.stringify(backfillResult.failures, null, 2)}
                </pre>
              )}
            </div>
          )}
        </PageSection>
      </div>

      {confirmingSeed && (
        <ConfirmDialog
          message={SEED_CONFIRM_MESSAGE}
          onCancel={() => setConfirmingSeed(null)}
          onConfirm={() => {
            const seed = confirmingSeed;
            setConfirmingSeed(null);
            void (seed === "bookings" ? handleSeedTestBookings() : handleSeedVehicleHealth());
          }}
        />
      )}
    </PageShell>
  );
}
