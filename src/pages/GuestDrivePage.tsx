// The drop-in guest's page ("/gaest#‹token›", PUBLIC — no login): what the
// "Åbn køretøjet" button in the guest's email opens (see
// netlify/functions/_shared/guestAccess.ts's buildGuestEmailHtml). Looks like
// the regular user's front-page hero card (BookingPage.tsx) — vehicle,
// the big circular Lås/Lås op control, Periode/Anvendelse chips — minus
// everything that needs an account (Data Filter, Blink/Horn, map, Afslut/
// Rediger/Slet).
//
// The token lives in the URL fragment, which browsers never send to a
// server; this page reads it and POSTs it to guest-booking-status.mts /
// guest-vehicle-lock.mts, which do ALL the authorization (link window,
// revocation, the same Lås/Lås op rules as a regular user, rate limit). The
// button state here is only a mirror of what the server just said. Kept in
// the address bar on purpose so the guest can reload or bookmark the page
// for the whole reservation.
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { InfoCard } from "../components/InfoCard";
import { VehicleLockToggle } from "../components/VehicleLockToggle";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { formatBookingPeriod, splitIsoDateTime } from "../lib/bookings";
import { fadeInUp } from "../lib/motionVariants";

/** guest-booking-status.mts's response — see that function for each field. */
type GuestStatus = {
  access: "active" | "not_yet" | "expired" | "revoked";
  vehicleLabel: string;
  brand: string | null;
  model: string | null;
  plate: string | null;
  usage: string | null;
  start: string;
  end: string | null;
  accessFrom: string | null;
  accessUntil: string | null;
  serverNow: string;
  lock: { lockEnabled: boolean; unlockEnabled: boolean } | null;
  locked: boolean | null;
};

/** How often the page re-asks the server while open: keeps the button state current as the booking starts/ends. Well inside guestAccess.ts's rate limit (60 uses / 10 min). */
const REFRESH_MS = 30_000;

/** POSTs `body` to a guest Function; returns the parsed JSON or throws with the server's Danish error. */
async function postGuest<T>(fn: string, body: unknown): Promise<T> {
  const response = await fetch(`/.netlify/functions/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(json.error ?? "Der opstod en fejl. Prøv igen om lidt.");
  return json as T;
}

/** "dd/mm HH:mm - HH:mm" etc., via the same formatBookingPeriod the front page uses. */
function periodLabel(start: string, end: string | null): string {
  const s = splitIsoDateTime(start);
  const e = end ? splitIsoDateTime(end) : null;
  return formatBookingPeriod({ startDate: s.date, start: s.time, endDate: e?.date ?? null, end: e?.time ?? null }, true);
}

/** "dd.mm.yyyy HH:mm" for the not-yet/expired messages. */
function fullDateTime(iso: string): string {
  const { date, time } = splitIsoDateTime(iso);
  return `${date} kl. ${time}`;
}

export function GuestDrivePage() {
  const [token] = useState(() => window.location.hash.replace(/^#/, ""));
  const [status, setStatus] = useState<GuestStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const { activeKey: confirmationKey, trigger: triggerConfirmation } = useTimedFlag(4000);

  const refresh = useCallback(async () => {
    if (!token) {
      setLoadError("Linket er ugyldigt eller udløbet.");
      return;
    }
    try {
      setStatus(await postGuest<GuestStatus>("guest-booking-status", { token }));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Der opstod en fejl.");
    }
  }, [token]);

  // Initial load, a slow refresh while open, and an immediate one whenever
  // the guest returns to the tab (phones suspend timers in the background).
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const handleToggle = async (nextLocked: boolean): Promise<boolean> => {
    setIsSending(true);
    setActionError(null);
    try {
      await postGuest("guest-vehicle-lock", { token, locked: nextLocked });
      triggerConfirmation(nextLocked ? "locked" : "unlocked");
      await refresh();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Der opstod en fejl.");
      void refresh();
      return false;
    } finally {
      setIsSending(false);
    }
  };

  const vehicleTitle = status ? [status.brand, status.model].filter(Boolean).join(" ") || status.vehicleLabel : "";

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 text-brand-900">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />
      <motion.div {...fadeInUp} className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-4 pt-4">
        <div className="flex shrink-0 items-center pb-3">
          <FleetiiLogo className="h-6 w-auto shrink-0" />
        </div>
        <h1 className="shrink-0 pb-1 text-sm font-semibold uppercase tracking-wide text-brand-500">Din reservation</h1>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pb-4">
          {!status && !loadError && <InfoCard>Henter reservationen…</InfoCard>}

          {!status && loadError && <InfoCard>{loadError}</InfoCard>}

          {status && (
            <>
              <div className="flex flex-col items-center gap-3.5 rounded-3xl border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5">
                <div className="flex w-full min-w-0 flex-col gap-0.5">
                  <span className="truncate text-base font-semibold text-brand-800">{vehicleTitle}</span>
                  {status.plate && <span className="truncate text-xs text-brand-500">{status.plate}</span>}
                </div>

                {status.access === "active" ? (
                  <VehicleLockToggle
                    variant="circle"
                    locked={status.locked}
                    lockEnabled={status.lock?.lockEnabled ?? false}
                    unlockEnabled={status.lock?.unlockEnabled ?? false}
                    loading={isSending}
                    onToggle={handleToggle}
                    cannotUnlockMessage="Du kan først låse op, når reservationen er startet"
                    cannotLockMessage="Køretøjet kan ikke låses lige nu"
                    confirmationMessage={
                      confirmationKey === "unlocked"
                        ? "Køretøjet er nu låst op. God tur"
                        : confirmationKey === "locked"
                          ? "Køretøjet er nu låst"
                          : null
                    }
                  />
                ) : (
                  <p className="py-6 text-center text-sm text-brand-700">
                    {status.access === "not_yet"
                      ? `Reservationen starter ${fullDateTime(status.start)}. Du kan låse køretøjet op her, når den er startet.`
                      : status.access === "revoked"
                        ? "Adgangen til køretøjet er lukket. Kontakt receptionen, hvis du har brug for hjælp."
                        : "Reservationen er slut, og linket virker ikke længere."}
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <div className="shrink-0 rounded-2xl border border-brand-100 bg-white px-3.5 py-2">
                  <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-brand-300">Periode</p>
                  <p className="whitespace-nowrap text-xs font-semibold text-brand-800">{periodLabel(status.start, status.end)}</p>
                </div>
                <div className="min-w-0 flex-1 rounded-2xl border border-brand-100 bg-white px-3.5 py-2">
                  <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-brand-300">Anvendelse</p>
                  <p className="truncate text-xs font-semibold text-brand-800">{status.usage}</p>
                </div>
              </div>

              {status.access === "active" && (
                <InfoCard>Husk at låse køretøjet, når du forlader det og når du afleverer det.</InfoCard>
              )}

              {actionError && <p className="text-center text-sm text-red-600">{actionError}</p>}
              {loadError && <p className="text-center text-sm text-red-600">{loadError}</p>}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
