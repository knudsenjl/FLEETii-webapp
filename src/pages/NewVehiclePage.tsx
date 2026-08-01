import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { InlinePopup } from "../components/InlinePopup";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { EMAIL_PATTERN, PHONE_PATTERN } from "../lib/validation";

/**
 * Admin "Opret nyt køretøj" page ("/new-vehicle"): rather than creating the
 * vehicle directly (FLEETii doesn't have a device-provisioning API), this
 * form emails the request to FLEETii staff via the send-vehicle-request
 * Netlify Function (which itself requires the caller to be a logged-in
 * admin — see netlify/functions/_shared/serverAuth.ts), who create the
 * vehicle and arrange device installation manually.
 */
export function NewVehiclePage() {
  const { afdeling, afdelingId, session, profile } = useAuth();
  /** Whether afdelingId's department shows the "Køretøj-ID:" row below at all — see useIdentSettings' own doc comment. */
  const { useVehicleIdent } = useIdentSettings(afdelingId);
  /** Company-wide "Køretøj-ID" identifier — optional (unlike Nummerplade, not required to send), see costumer_orders_add_vehicle_ident.sql. Carried straight onto the created vehicle_profiles row once FLEETii fulfils the request (2hire-register-vehicle.mts), so it doesn't have to be re-entered later. */
  const [vehicleIdent, setVehicleIdent] = useState("");
  const [nummerplade, setNummerplade] = useState("");
  const [brand, setBrand] = useState("");
  const [maerke, setMaerke] = useState("");
  const [aargang, setAargang] = useState("");
  /** Fuel level/mileage at the time of the request — optional (not always known, e.g. a genuinely new vehicle), free-text same as the other fields here (see costumer_orders_add_fuel_level_and_mileage.sql). */
  const [fuelLevel, setFuelLevel] = useState("");
  const [mileage, setMileage] = useState("");
  /** Whether a NEW FLEETii device needs to be installed — unticked when the vehicle already has one (an existing IoT device moved from elsewhere, or pre-installed), in which case fleetiiDeviceId identifies it instead. */
  const [needsFleetiiDevice, setNeedsFleetiiDevice] = useState(true);
  const [fleetiiDeviceId, setFleetiiDeviceId] = useState("");
  const [kontaktperson, setKontaktperson] = useState("");
  const [kontaktemail, setKontaktemail] = useState("");
  const [kontaktnummer, setKontaktnummer] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  /** Which (if either) of the FLEETii-device "?" info popovers is open — mirrors UserDetailsPage.tsx's own Afdeling(er)/Hjemmeafdeling popover pattern. */
  const [openInfoPopover, setOpenInfoPopover] = useState<"device" | "deviceId" | null>(null);

  /** Pre-fills Kontaktperson/Kontakt e-mail/Kontakt tlf. from the logged-in user's own profile once it's loaded (profile is null until AuthContext's async fetch resolves) — seeded once via this ref rather than on every profile change, so it doesn't clobber anything the user has already typed/edited (e.g. after a "Skift afdeling" refresh). */
  const contactSeededRef = useRef(false);
  useEffect(() => {
    if (contactSeededRef.current || !profile) return;
    contactSeededRef.current = true;
    setKontaktperson(profile.full_name ?? "");
    setKontaktemail(profile.email ?? "");
    setKontaktnummer(profile.phone ?? "");
  }, [profile]);

  const emailFormatInvalid = kontaktemail.trim().length > 0 && !EMAIL_PATTERN.test(kontaktemail.trim());
  const phoneFormatInvalid = kontaktnummer.trim().length > 0 && !PHONE_PATTERN.test(kontaktnummer.trim());

  const canSend =
    nummerplade.trim().length > 0 &&
    brand.trim().length > 0 &&
    maerke.trim().length > 0 &&
    aargang.trim().length > 0 &&
    (needsFleetiiDevice || fleetiiDeviceId.trim().length > 0) &&
    kontaktperson.trim().length > 0 &&
    EMAIL_PATTERN.test(kontaktemail.trim()) &&
    PHONE_PATTERN.test(kontaktnummer.trim()) &&
    !isSending;

  /** Posts the vehicle-request form to send-vehicle-request, authenticated with the current session's access token. Shows a server-supplied error message (or a generic connection-failure one) inline on failure. */
  const handleSend = async () => {
    setIsSending(true);
    setSendError(null);
    setSent(false);

    try {
      const response = await fetch("/.netlify/functions/send-vehicle-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          afdeling,
          vehicleIdent: vehicleIdent.trim() || null,
          nummerplade,
          brand,
          maerke,
          aargang,
          fuelLevel,
          mileage,
          needsFleetiiDevice,
          fleetiiDeviceId: needsFleetiiDevice ? null : fleetiiDeviceId,
          kontaktperson,
          kontaktemail,
          kontaktnummer,
        }),
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
          <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <h2 className="text-xl font-semibold text-brand-800">Opret nyt køretøj</h2>

              <p className="text-xs text-red-600">
                Denne side skal vi have snakket om. Jeg ved ikke, hvilke oplysninger, Robert har brug for, at kunne oprette en ny bil i den pågældende afdeling.
              </p>

              <div className="rounded-2xl border border-brand-100">
                {/* rounded-2xl lives here too (not just on the outer border,
                    with no overflow-hidden at all) so the FLEETii-device "?"
                    popovers below — absolutely positioned descendants —
                    aren't clipped when they overflow this box's edge (same
                    fix as RettighederSettings.tsx/UserDetailsPage.tsx). */}
                <div className="divide-y divide-brand-100 rounded-2xl bg-white">
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Afdeling:</label>
                    <span className="text-sm text-brand-800">{afdeling ?? "—"}</span>
                  </div>
                  {useVehicleIdent && (
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <label className="flex items-center text-sm font-medium text-brand-700">Køretøj-ID:</label>
                      <input
                        type="text"
                        value={vehicleIdent}
                        onChange={(e) => setVehicleIdent(e.target.value)}
                        placeholder="valgfri — bruger Nummerplade hvis tom"
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                  )}
                  <RequiredFieldRow label="Nummerplade:" value={nummerplade} onChange={setNummerplade} />
                  <RequiredFieldRow label="Brand:" value={brand} onChange={setBrand} />
                  <RequiredFieldRow label="Mærke:" value={maerke} onChange={setMaerke} />
                  <RequiredFieldRow label="Årgang:" value={aargang} onChange={setAargang} />
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Kilometerstand:</label>
                    <input
                      type="text"
                      value={mileage}
                      onChange={(e) => setMileage(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <label className="flex items-center text-sm font-medium text-brand-700">Brændstofniveau:</label>
                    <input
                      type="text"
                      value={fuelLevel}
                      onChange={(e) => setFuelLevel(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                    <div className="relative flex items-center justify-between gap-2">
                      <label htmlFor="needs-fleetii-device" className="text-sm font-medium text-brand-700">
                        FLEETii device skal installeres:
                      </label>
                      <button
                        type="button"
                        onClick={() => setOpenInfoPopover((key) => (key === "device" ? null : "device"))}
                        aria-label="Mere information"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand-300 text-[0.65rem] font-bold leading-none text-brand-600 transition hover:bg-brand-50"
                      >
                        ?
                      </button>
                      {openInfoPopover === "device" && (
                        <div className="fixed inset-0 z-10" onClick={() => setOpenInfoPopover(null)} />
                      )}
                      <InlinePopup
                        visible={openInfoPopover === "device"}
                        message="Hvis der ikke er et FLEETii device installeret i køretøjet, skal du tikke denne af"
                        align="right"
                      />
                    </div>
                    <input
                      id="needs-fleetii-device"
                      type="checkbox"
                      checked={needsFleetiiDevice}
                      onChange={(e) => setNeedsFleetiiDevice(e.target.checked)}
                      className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500"
                    />
                  </div>
                  {!needsFleetiiDevice && (
                    <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                      <div className="relative flex items-center justify-between gap-2">
                        <label htmlFor="fleetii-device-id" className="flex-1 text-right text-sm font-medium text-brand-700">
                          FLEETii device id: <span className="text-red-600">*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setOpenInfoPopover((key) => (key === "deviceId" ? null : "deviceId"))}
                          aria-label="Mere information"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand-300 text-[0.65rem] font-bold leading-none text-brand-600 transition hover:bg-brand-50"
                        >
                          ?
                        </button>
                        {openInfoPopover === "deviceId" && (
                          <div className="fixed inset-0 z-10" onClick={() => setOpenInfoPopover(null)} />
                        )}
                        <InlinePopup
                          visible={openInfoPopover === "deviceId"}
                          message="Angiv id-nummeret på det eksisterende IoT device i køretøjet"
                          align="right"
                        />
                      </div>
                      <input
                        id="fleetii-device-id"
                        type="text"
                        required
                        aria-required="true"
                        value={fleetiiDeviceId}
                        onChange={(e) => setFleetiiDeviceId(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                  )}
                  <RequiredFieldRow label="Kontaktperson:" value={kontaktperson} onChange={setKontaktperson} />
                  <RequiredFieldRow label="Kontakt e-mail:" value={kontaktemail} onChange={setKontaktemail} type="email" />
                  <RequiredFieldRow label="Kontakt tlf.:" value={kontaktnummer} onChange={setKontaktnummer} type="tel" />
                </div>
              </div>

              {emailFormatInvalid && <p className="text-xs text-red-600">Ugyldig e-mailadresse.</p>}
              {phoneFormatInvalid && <p className="text-xs text-red-600">Ugyldigt telefonnummer.</p>}

              <p className="text-right text-xs text-brand-500">
                <span className="text-red-600">*</span> Feltet skal udfyldes
              </p>

              {sendError && <p className="text-sm text-red-600">{sendError}</p>}

              <div className="mt-auto flex flex-col gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <p className="text-xs text-brand-700">
                  Hvis du trykker på knappen herunder, sendes der besked til FLEETii, som
                  herefter vil vi oprette bilen i FLEETii, og kontakte dig vedr. aftale omkring evt.
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

              {sent ? (
                <span className="flex w-full items-center justify-center rounded-lg bg-accent-50 px-2 py-1.5 text-center text-sm font-semibold text-accent-700">
                  Bestillingen er sendt
                </span>
              ) : (
                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => void handleSend()}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSending ? "Sender…" : "Send bestilling til FLEETii"}
                </button>
              )}
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
