// 2hire raw-command console ("/2hire-command", sysadm-only — see App.tsx's
// requireRole="sysadm" on this route). Lets a sysadm type an arbitrary 2hire
// Adapter API request ("METODE /sti", e.g.
// "POST /api/v1/vehicle/{AB12345}/command/generic/locate") and see the raw
// JSON response, for poking at endpoints this codebase has no dedicated
// wrapper for yet — see 2hire-raw-command.mts for the actual request/
// placeholder-substitution logic (this page is a thin form around it, no
// business logic of its own). A "{plate}" token anywhere in the command is
// resolved server-side to that vehicle's real 2hire vehicle_id, so this page
// never needs the caller to already know it. Deliberately minimal for now —
// one command line, one optional JSON body, one result panel — more
// structure (saved commands, a request-builder UI, etc.) can be layered on
// later once real usage shows what's actually needed.
import { useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";

/** The shape 2hire-raw-command.mts always resolves to on a 200 — either this or {error} (see handleExecute). */
type RawCommandResult = { requestUrl: string; status: number; ok: boolean; result: unknown };

export function TwoHireCommandPage() {
  const { session } = useAuth();
  const [command, setCommand] = useState("POST /api/v1/vehicle/{AB12345}/command/generic/locate");
  const [body, setBody] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RawCommandResult | null>(null);

  const handleExecute = async () => {
    setIsExecuting(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/.netlify/functions/2hire-raw-command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ command, body: body.trim() || undefined }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(failure?.error ?? "Kommandoen fejlede.");
        return;
      }
      setResult((await response.json()) as RawCommandResult);
    } catch {
      setError("Kunne ikke kontakte serveren. Prøv igen senere.");
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div>
              <h2 className="text-xl font-semibold text-brand-800">2hire kommando</h2>
              <p className="mt-1 text-sm text-brand-600">
                Skriv en 2hire-forespørgsel som "METODE /sti", f.eks.{" "}
                <code className="rounded bg-brand-50 px-1 py-0.5 text-xs">POST /api/v1/vehicle/{"{AB12345}"}/command/generic/locate</code>.
                Nummerplader i tuborg-klammer ({"{...}"}) slås automatisk op og erstattes med køretøjets 2hire vehicle_id.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="twohire-command" className="text-sm font-medium text-brand-700">
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
              <label htmlFor="twohire-body" className="text-sm font-medium text-brand-700">
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
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <p className="text-sm text-brand-600">
                  <span className="font-medium">{result.requestUrl}</span> →{" "}
                  <span className={result.ok ? "font-medium text-green-700" : "font-medium text-red-600"}>
                    {result.status}
                  </span>
                </p>
                <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-brand-100 bg-brand-50 p-3 text-xs text-brand-900">
                  {JSON.stringify(result.result, null, 2)}
                </pre>
              </div>
            )}
          </section>
        </motion.main>
      </div>
    </div>
  );
}
