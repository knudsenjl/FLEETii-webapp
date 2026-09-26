// The drop-in guest's page ("/gaest#‹token›", PUBLIC — no login): what the
// "Åbn køretøjet" button in the guest's email opens (see
// netlify/functions/_shared/guestAccess.ts's buildGuestEmailHtml). Looks like
// the regular user's front-page hero card (BookingPage.tsx) — a
// "Kunde/Afdeling" line, vehicle + the guest's name, the big circular Lås/Lås op control,
// Periode/Anvendelse chips and (while the link is active) the vehicle's map —
// minus everything that needs an account (Data Filter, Blink/Horn, Afslut/
// Rediger/Slet). Before the reservation starts the lock control is shown but
// disabled, and it switches on by itself at the start time (see the
// refresh-at-boundary effect below).
//
// The token lives in the URL fragment, which browsers never send to a
// server; this page reads it and POSTs it to guest-booking-status.mts /
// guest-vehicle-lock.mts, which do ALL the authorization (link window,
// revocation, the same Lås/Lås op rules as a regular user, rate limit). The
// button state here is only a mirror of what the server just said. Kept in
// the address bar on purpose so the guest can reload or bookmark the page
// for the whole reservation.
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { InfoCard } from "../components/InfoCard";
import { LeafletMap } from "../components/LeafletMap";
import { MapOverlayMessage } from "../components/MapOverlayMessage";
import { VehicleLockToggle } from "../components/VehicleLockToggle";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { formatBookingPeriod, splitIsoDateTime } from "../lib/bookings";
import { fadeInUp } from "../lib/motionVariants";
import { toUtcMs } from "../lib/time";

/** guest-booking-status.mts's response — see that function for each field. */
type GuestStatus = {
  access: "active" | "not_yet" | "expired" | "revoked";
  guestName: string | null;
  costumerName: string | null;
  departmentName: string | null;
  /** The vehicle's last GPS fix — only while access is active, null without one. */
  position: { lat: number; lng: number; updatedAt: string | null } | null;
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

/** How far ahead the refresh-at-boundary effect schedules an exact refresh; see that effect. */
const BOUNDARY_REFRESH_HORIZON_MS = 60 * 60_000;

/** Fallback map center when the vehicle has no GPS fix — same as BookingPage.tsx. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

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

  // Refresh exactly when something changes on its own clock — the link
  // opening (start -15 min) and the reservation starting (the lock control
  // switching on) — instead of waiting up to REFRESH_MS for the next poll.
  // Measured against the server's clock (serverNow), not the phone's.
  useEffect(() => {
    if (!status) return;
    const skewMs = toUtcMs(status.serverNow) - Date.now();
    const serverNowMs = Date.now() + skewMs;
    const delays = [status.accessFrom, status.start]
      .filter((iso): iso is string => Boolean(iso))
      .map((iso) => toUtcMs(iso) - serverNowMs)
      // Only boundaries within the next hour: the 30 s poll covers anything
      // later anyway, and a delay beyond setTimeout's ~24.8-day maximum
      // overflows and fires IMMEDIATELY — which re-renders, re-runs this
      // effect and loops straight into the server's rate limit.
      .filter((delay) => delay > 0 && delay <= BOUNDARY_REFRESH_HORIZON_MS);
    if (delays.length === 0) return;
    const timer = window.setTimeout(() => void refresh(), Math.min(...delays) + 1000);
    return () => window.clearTimeout(timer);
  }, [status, refresh]);

  /** The map's initial center — the first position seen, kept stable so later GPS updates only move the marker (followMarker) instead of rebuilding the map. */
  const mapCenter = useRef<{ lat: number; lng: number } | null>(null);
  if (status?.position && !mapCenter.current) mapCenter.current = { lat: status.position.lat, lng: status.position.lng };

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
  /** "Kunde/Afdeling", same slash style as PageHeader's "Afdeling: Kunde/Afdeling" line. The guest's own name goes under the vehicle instead. */
  const scopeLine = status ? [status.costumerName, status.departmentName].filter(Boolean).join("/") : "";
  /** The lock control is shown before start too (disabled), so the guest sees what they'll use; only a revoked/expired link hides it. */
  const showLockControl = status?.access === "active" || status?.access === "not_yet";

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
        <h1 className="shrink-0 truncate pb-1 text-sm font-semibold text-brand-600">{scopeLine || "Din reservation"}</h1>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pb-4">
          {!status && !loadError && <InfoCard>Henter reservationen…</InfoCard>}

          {!status && loadError && <InfoCard>{loadError}</InfoCard>}

          {status && (
            <>
              <div className="flex flex-col items-center gap-3.5 rounded-3xl border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5">
                <div className="flex w-full min-w-0 flex-col gap-0.5">
                  <span className="truncate text-base font-semibold text-brand-800">{vehicleTitle}</span>
                  {status.guestName && <span className="truncate text-xs text-brand-500">{status.guestName}</span>}
                </div>

                {showLockControl ? (
                  <VehicleLockToggle
                    variant="circle"
                    locked={status.locked ?? true}
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
                    {status.access === "revoked"
                        ? "Adgangen til køretøjet er lukket. Kontakt receptionen, hvis du har brug for hjælp."
                        : "Reservationen er slut, og linket virker ikke længere."}
                  </p>
                )}
                {status.access === "not_yet" && (
                  <p className="text-center text-sm text-brand-700">
                    Reservationen starter {fullDateTime(status.start)}. Du kan låse køretøjet op her, når den er startet.
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
                <div className="relative isolate h-52 overflow-hidden rounded-2xl border border-brand-100">
                  <LeafletMap
                    lat={mapCenter.current?.lat ?? DENMARK_CENTER.lat}
                    lng={mapCenter.current?.lng ?? DENMARK_CENTER.lng}
                    zoom={mapCenter.current ? 16 : 7}
                    markerLat={status.position?.lat ?? DENMARK_CENTER.lat}
                    markerLng={status.position?.lng ?? DENMARK_CENTER.lng}
                    showMarker={Boolean(status.position)}
                    markerTooltip={status.plate ?? vehicleTitle}
                    className="absolute inset-0"
                    followMarker
                  />
                  {!status.position && (
                    <MapOverlayMessage>Der er ingen GPS position tilgængelig for dette køretøj</MapOverlayMessage>
                  )}
                </div>
              )}

              {showLockControl && (
                <div
                  role="note"
                  className="flex items-start gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-sm font-semibold text-amber-900 shadow-sm"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>Husk at låse køretøjet, når du forlader det og når du afleverer det.</span>
                </div>
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
