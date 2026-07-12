import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";

export function NewVehiclePage() {
  const { signOut, profile, afdeling } = useAuth();
  const navigate = useNavigate();
  const [nummerplade, setNummerplade] = useState("");
  const [brand, setBrand] = useState("");
  const [maerke, setMaerke] = useState("");
  const [aargang, setAargang] = useState("");
  const [kontaktperson, setKontaktperson] = useState("");
  const [kontaktnummer, setKontaktnummer] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const canSend =
    nummerplade.trim().length > 0 &&
    brand.trim().length > 0 &&
    maerke.trim().length > 0 &&
    aargang.trim().length > 0 &&
    kontaktperson.trim().length > 0 &&
    kontaktnummer.trim().length > 0 &&
    !isSending;

  const handleSend = async () => {
    setIsSending(true);
    setSendError(null);
    setSent(false);

    try {
      const response = await fetch("/.netlify/functions/send-vehicle-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afdeling, nummerplade, brand, maerke, aargang, kontaktperson, kontaktnummer }),
      });

      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok) {
        setSendError(result.error ?? "Kunne ikke sende bestillingen.");
        setIsSending(false);
        return;
      }
    } catch {
      setSendError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsSending(false);
      return;
    }

    setIsSending(false);
    setSent(true);
  };

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
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
          <div className="mb-2 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <FleetiiLogo className="h-8 w-auto shrink-0" linkToHome />
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => void signOut()}
                  className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
                >
                  Log ud
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/about")}
                  aria-label="Om FLEETii"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-white font-serif text-base font-bold italic text-brand-700 transition hover:bg-brand-50"
                >
                  i
                </button>
              </div>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[0.7rem] font-medium text-brand-600">{formatRoleLabel(profile?.role)}: {profile?.email ?? "—"}</p>
              <p className="shrink-0 truncate text-[0.7rem] font-medium text-brand-600">Afdeling: {afdeling ?? "—"}</p>
            </div>
          </div>

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <h2 className="text-xl font-semibold text-brand-800">Opret nyt køretøj</h2>

              <p className="text-xs text-red-600">
                Denne side skal vi have snakket om. Jeg ved ikke, hvilke oplysninger, Robert har brug for, at kunne oprette en ny bil i den pågældende afdeling.
              </p>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Afdeling:</label>
                    <span className="text-sm text-brand-800">{afdeling ?? "—"}</span>
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Nummerplade: <span className="ml-0.5 text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      aria-required="true"
                      value={nummerplade}
                      onChange={(e) => setNummerplade(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Brand: <span className="ml-0.5 text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      aria-required="true"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Mærke: <span className="ml-0.5 text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      aria-required="true"
                      value={maerke}
                      onChange={(e) => setMaerke(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Årgang: <span className="ml-0.5 text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      aria-required="true"
                      value={aargang}
                      onChange={(e) => setAargang(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Kontaktperson: <span className="ml-0.5 text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      aria-required="true"
                      value={kontaktperson}
                      onChange={(e) => setKontaktperson(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Kontaktnummer: <span className="ml-0.5 text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      aria-required="true"
                      value={kontaktnummer}
                      onChange={(e) => setKontaktnummer(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                </div>
              </div>

              <p className="text-right text-xs text-brand-500">
                <span className="text-red-600">*</span> Feltet skal udfyldes
              </p>

              {sendError && <p className="text-sm text-red-600">{sendError}</p>}
              {sent && <p className="text-sm text-accent-600">Bestillingen er sendt.</p>}

              <div className="mt-auto flex flex-col gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <p className="text-xs text-brand-700">
                  Hvis du trykker på knappen herunder, sendes der besked til FLEETii, som
                  herefter vil oprette bilen i FLEETii, og kontakte dig vedr. aftale omkring
                  installering af FLEETii device i køretøjet.
                </p>
                <p className="text-xs text-brand-700">
                  Hvis du foretrækker det, er du velkommen til at kontakte FLEETii direkte på:
                </p>
                <div className="flex flex-col gap-1.5 text-sm text-brand-700">
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-brand-500">
                      <path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8Z" />
                    </svg>
                    <a href="tel:+4570608689" className="hover:underline">70 60 86 89</a>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-brand-500">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m4 7 8 6 8-6" />
                    </svg>
                    <a href="mailto:info@fleeti.dk" className="hover:underline">info@fleeti.dk</a>
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={!canSend}
                onClick={() => void handleSend()}
                className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSending ? "Sender…" : "Send bestilling til FLEETii"}
              </button>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
