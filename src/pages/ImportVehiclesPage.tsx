// Bulk vehicle-import page ("/import-vehicles" — reached via
// VehiclesPage.tsx's "Registrer nye køretøjer fra fil" button). Intro text
// links out to the format templates under public/templates/bulk-import/
// (self-hosted static files, same convention as public/manualer/*.html),
// then two buttons trigger a native file picker (filtered to .json/.csv)
// and POST the chosen file's content straight to
// netlify/functions/bulk-import-vehicles.mts — same shape as
// ImportUsersPage.tsx's user import, adapted for vehicles' extra
// "this only creates a pending order, not a live vehicle" caveat (see that
// function's own doc comment — a real vehicle needs a QR code physically
// scanned off the installed 2hire hardware, which can't come from a bulk
// file).
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";

/**
 * Opens `url` in a new tab as plain text instead of letting the browser
 * download it — see ImportUsersPage.tsx's identical helper for the full
 * reasoning (browsers have no built-in renderer for text/csv, and netlify
 * dev doesn't apply netlify.toml's header override locally).
 */
async function openAsPlainText(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  const blobUrl = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  window.open(blobUrl, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}

/** One row's outcome, matching bulk-import-vehicles.mts's response shape. */
type ImportRowResult = { row: number; success: boolean; orderId?: string; error?: string };
type ImportSummary = { results: ImportRowResult[]; successCount: number; failureCount: number };

export function ImportVehiclesPage() {
  const { session, profile, costumerId } = useAuth();
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  /** A FLEETii admin has no costumerId of their own (platform-wide role) — bulk-import-vehicles.mts requires one to be chosen explicitly for them, same "Kunde" picker pattern as ImportUsersPage.tsx/UserDetailsPage.tsx's "Ny bruger" form. Not shown for a regular admin, who always imports into their own costumerId. */
  const isFleetiiAdmin = profile?.role === "FLEETii admin";
  const [filterCostumerId, setFilterCostumerId] = useState("");
  const [costumerOptions, setCostumerOptions] = useState<{ costumer_id: string; name: string }[]>([]);

  /** Loads every costumer for the Kunde picker — FLEETii admin only. */
  useEffect(() => {
    if (!isFleetiiAdmin) return;
    void supabase
      .from("costumers")
      .select("costumer_id, name")
      .order("name", { ascending: true })
      .returns<{ costumer_id: string; name: string }[]>()
      .then(({ data }) => setCostumerOptions(data ?? []));
  }, [isFleetiiAdmin]);

  /** The costumer this import actually targets — the chosen Kunde for a FLEETii admin (null until one's picked), otherwise the viewing admin's own costumerId. */
  const targetCostumerId = isFleetiiAdmin ? filterCostumerId || null : costumerId;

  /**
   * Reads `file` and POSTs it to bulk-import-vehicles.mts. costumerId is
   * only consulted server-side for a "FLEETii admin" caller (a regular
   * admin always imports into their own costumer regardless of what's
   * sent). contactperson/-email/-number aren't collected here at all —
   * the function defaults them to the caller's own profile, same as
   * NewVehiclePage.tsx's single-request form pre-fills from profile.
   */
  const handleFileChosen = async (file: File, format: "csv" | "json") => {
    setImporting(true);
    setRequestError(null);
    setSummary(null);

    try {
      const fileContent = await file.text();
      const response = await fetch("/.netlify/functions/bulk-import-vehicles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ format, fileContent, costumerId: targetCostumerId ?? undefined }),
      });

      const result = (await response.json()) as ImportSummary & { error?: string };
      if (!response.ok) {
        setRequestError(result.error ?? "Kunne ikke importere køretøjer.");
        return;
      }
      setSummary(result);
    } catch {
      setRequestError("Kunne ikke kontakte serveren. Prøv igen senere.");
    } finally {
      setImporting(false);
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

          <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">Opret nye køretøjer fra fil</h2>
            <p className="text-sm text-brand-800">
              Her kan du oprette en række køretøjer på én gang ved at give oplysninger om de nye køretøjer i en fil,
              enten i{" "}
              <button
                type="button"
                onClick={() => void openAsPlainText("/templates/bulk-import/koretojer-template.csv")}
                className="font-medium text-accent-600 underline hover:text-accent-800"
              >
                CSV-format
              </button>{" "}
              eller{" "}
              <a
                href="/templates/bulk-import/koretojer-template.json"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent-600 underline hover:text-accent-800"
              >
                JSON-format
              </a>{" "}
              (ved at klikke på disse formater, kan du se et eksempel på de to formater). Detaljer om formaterne kan
              ses i{" "}
              <a
                href="/templates/bulk-import/README.md"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent-600 underline hover:text-accent-800"
              >
                README.md
              </a>
              .
            </p>
            <p className="text-sm text-brand-800">
              Hvert køretøj oprettes som en afventende bestilling, ligesom "Registrer nyt køretøj" — en FLEETii
              administrator skal stadig registrere hvert køretøj enkeltvis, da det kræver speciel konfigurering af
              hvert køretøj.
            </p>

            {isFleetiiAdmin && (
              // FLEETii-admin-only Kunde picker — the two import buttons
              // below stay disabled until one's chosen, same reasoning as
              // ImportUsersPage.tsx/UserDetailsPage.tsx's "Ny bruger" form.
              <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                <label className="flex items-center text-sm font-medium text-brand-700">
                  Kunde: <span className="ml-0.5 text-red-600">*</span>
                </label>
                <select
                  required
                  aria-required="true"
                  value={filterCostumerId}
                  onChange={(e) => setFilterCostumerId(e.target.value)}
                  className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                >
                  <option value="" className="bg-brand-100">Vælg kunde:</option>
                  {costumerOptions.map((costumer) => (
                    <option key={costumer.costumer_id} value={costumer.costumer_id}>
                      {costumer.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                disabled={importing || !targetCostumerId}
                onClick={() => jsonInputRef.current?.click()}
                className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Køretøjer i JSON format
              </button>
              <button
                type="button"
                disabled={importing || !targetCostumerId}
                onClick={() => csvInputRef.current?.click()}
                className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Køretøjer i CSV format
              </button>
            </div>

            {/* Hidden native file pickers — see ImportUsersPage.tsx's
                identical comment on why .value is reset synchronously in
                onChange rather than after the (async) handler. */}
            <input
              ref={jsonInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleFileChosen(file, "json");
              }}
            />
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleFileChosen(file, "csv");
              }}
            />

            {importing && <p className="text-sm text-brand-600">Importerer køretøjer…</p>}
            {requestError && <p className="text-sm text-red-600">{requestError}</p>}
            {summary && (
              <div className="text-sm text-brand-800">
                <p>
                  {summary.successCount} af {summary.results.length} køretøjsbestilling
                  {summary.results.length === 1 ? "" : "er"} oprettet.
                </p>
                {summary.failureCount > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-red-600">
                    {summary.results
                      .filter((r) => !r.success)
                      .map((r) => (
                        <li key={r.row}>
                          Række {r.row}: {r.error}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </motion.main>
      </div>
    </div>
  );
}
