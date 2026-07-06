import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { supabase } from "../lib/supabase";

const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, i) => {
  const hours = Math.floor(i / 4);
  const minutes = (i % 4) * 15;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

function ceilToQuarterHour(date: Date): Date {
  const ms = 15 * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

export function ReservationPage() {
  const { signOut, session, profile } = useAuth();
  const navigate = useNavigate();
  const [bruger, setBruger] = useState(
    profile?.role === "admin" ? "" : session?.user.email ?? "",
  );
  const [anvendelse, setAnvendelse] = useState("");
  const [users, setUsers] = useState<{ id: string; email: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, email")
      .order("email")
      .then(({ data, error: usersError }) => {
        if (usersError) {
          setError(usersError.message);
          return;
        }
        setUsers(
          (data ?? []).filter((u): u is { id: string; email: string } => Boolean(u.email)),
        );
      });
  }, []);

  const now = ceilToQuarterHour(new Date());
  const end = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const toIsoDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const formatTime = (date: Date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const addMinutes = (time: string, minutes: number) => {
    const [hours, mins] = time.split(":").map(Number);
    const total = (hours * 60 + mins + minutes + 24 * 60) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

  const [startDate, setStartDate] = useState(toIsoDate(now));
  const [endDate, setEndDate] = useState(toIsoDate(end));
  const [startTime, setStartTime] = useState(formatTime(now));
  const [endTime, setEndTime] = useState(formatTime(end));
  const [showStartWarning, setShowStartWarning] = useState(false);
  const startWarningTimeout = useRef<number | null>(null);
  const [showEndWarning, setShowEndWarning] = useState(false);
  const endWarningTimeout = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (startWarningTimeout.current) {
        window.clearTimeout(startWarningTimeout.current);
      }
      if (endWarningTimeout.current) {
        window.clearTimeout(endWarningTimeout.current);
      }
    };
  }, []);

  const triggerStartWarning = () => {
    setShowStartWarning(true);
    if (startWarningTimeout.current) {
      window.clearTimeout(startWarningTimeout.current);
    }
    startWarningTimeout.current = window.setTimeout(() => setShowStartWarning(false), 3000);
  };

  const triggerEndWarning = () => {
    setShowEndWarning(true);
    if (endWarningTimeout.current) {
      window.clearTimeout(endWarningTimeout.current);
    }
    endWarningTimeout.current = window.setTimeout(() => setShowEndWarning(false), 3000);
  };

  const applyStartDateTime = (candidateDate: string, candidateTime: string, syncEndDate: boolean) => {
    let date = candidateDate;
    let time = candidateTime;

    if (new Date(`${date}T${time}:00`).getTime() < Date.now()) {
      const current = ceilToQuarterHour(new Date());
      date = toIsoDate(current);
      time = formatTime(current);
      triggerStartWarning();
    }

    setStartDate(date);
    setStartTime(time);

    const effectiveEndDate = syncEndDate ? date : endDate;
    if (syncEndDate) {
      setEndDate(date);
    }
    if (effectiveEndDate === date && endTime <= time) {
      setEndTime(addMinutes(time, 30));
    }
  };

  const applyEndDateTime = (candidateDate: string, candidateTime: string) => {
    let date = candidateDate;
    let time = candidateTime;

    if (new Date(`${date}T${time}:00`).getTime() < new Date(`${startDate}T${startTime}:00`).getTime()) {
      const corrected = ceilToQuarterHour(new Date(Date.now() + 3 * 60 * 60 * 1000));
      date = toIsoDate(corrected);
      time = formatTime(corrected);
      triggerEndWarning();
    }

    setEndDate(date);
    setEndTime(time);
  };

  const handleFindAvailable = () => {
    navigate("/available", {
      state: {
        user: bruger,
        use: anvendelse,
        start: `${startDate}T${startTime}:00`,
        end: `${endDate}T${endTime}:00`,
      },
    });
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
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <FleetiiLogo className="h-8 w-auto shrink-0" linkToHome />
              <p className="min-w-0 truncate text-[0.7rem] font-medium text-brand-600">{formatRoleLabel(profile?.role)}: {profile?.email ?? "—"} - Afdeling: {profile?.department ?? "—"}</p>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => navigate(-1)}
                aria-label="Tilbage"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-200 bg-white text-brand-700 transition hover:bg-brand-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                onClick={() => void signOut()}
                className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
              >
                Log ud
              </button>
            </div>
          </div>

          <section className="flex min-h-0 flex-1 flex-col rounded-[2rem] border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">
                Opret reservation
              </h2>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Bruger
                    </label>
                    <select
                      value={bruger}
                      onChange={(e) => setBruger(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    >
                      <option value="">Vælg bruger</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.email}>
                          {u.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Anvendelse
                    </label>
                    <input
                      type="text"
                      placeholder="Beskrivelse"
                      value={anvendelse}
                      onChange={(e) => setAnvendelse(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="relative grid grid-cols-[4rem_1fr_1fr] items-center gap-3 p-3 sm:p-4">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Start
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => applyStartDateTime(e.target.value, startTime, true)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                    <select
                      value={startTime}
                      onChange={(e) => applyStartDateTime(startDate, e.target.value, false)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {showStartWarning && (
                      <div className="absolute left-0 top-full z-10 mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 shadow-md">
                        Start kan ikke være før nu
                      </div>
                    )}
                  </div>
                  <div className="relative grid grid-cols-[4rem_1fr_1fr] items-center gap-3 p-3 sm:p-4">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Slut
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => applyEndDateTime(e.target.value, endTime)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                    <select
                      value={endTime}
                      onChange={(e) => applyEndDateTime(endDate, e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    >
                      {TIME_OPTIONS.filter((t) => startDate !== endDate || t >= startTime).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {showEndWarning && (
                      <div className="absolute bottom-full left-0 z-10 mb-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 shadow-md">
                        Slut kan ikke være før Start
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={handleFindAvailable}
                  disabled={!bruger}
                  className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Find ledige
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
