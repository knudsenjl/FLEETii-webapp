import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { TimeSelect } from "../components/TimeSelect";
import { InlinePopup } from "../components/InlinePopup";
import { supabase } from "../lib/supabase";
import {
  ANDET_VALUE,
  fetchSettingText,
  fetchSettingUnion,
  isSettingTilladt,
  sortAnvendelserWithAndetLast,
} from "../lib/settings";
import { useTimedFlag } from "../hooks/useTimedFlag";

/** The existing booking being edited, as passed in via router state from BookingDetailsPage's "Rediger reservation" button — carried forward through AvailablePage/ConfirmPage so confirming updates this row instead of inserting a new one. */
type EditingBooking = {
  bookingId: string;
  userId: string | null;
  userLabel: string | null;
  anvendelse: string;
  startIso: string;
  endIso: string | null;
};

/** Hardcoded fallbacks used whenever "Standard varighed"/"Standard interval" (department_settings/user_settings, see StandardSettings.tsx) has no value for the current user/department. */
const DEFAULT_DURATION_MINUTES = 3 * 60;
const DEFAULT_INTERVAL_MINUTES = 15;

/** Every `stepMinutes` of the day as "HH:mm" strings, for the Start/Slut TimeSelect dropdowns — step comes from "Standard interval" (falling back to DEFAULT_INTERVAL_MINUTES). */
function buildTimeOptions(stepMinutes: number): string[] {
  const count = Math.floor((24 * 60) / stepMinutes);
  return Array.from({ length: count }, (_, i) => {
    const totalMinutes = i * stepMinutes;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  });
}

/** Parses a "Standard varighed" value ("HH:MM") into a minute count, or null if it's missing/malformed — callers fall back to DEFAULT_DURATION_MINUTES in that case. */
function parseHHMMToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes >= 60) return null;
  return hours * 60 + minutes;
}

/** Rounds a Date up to the next quarter-hour boundary (used for the default "now" start time). */
function ceilToQuarterHour(date: Date): Date {
  const ms = 15 * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

/**
 * Step 1 of the booking flow ("/reservation"): pick who the reservation is
 * for (admins pick from their department's users; regular users always book
 * for themselves), what it's for, and the start/end date+time. Defaults to
 * "now" through "+Standard varighed" (falling back to +3 hours when unset),
 * with the Start/Slut TimeSelect stepping by "Standard interval" (falling
 * back to 15 minutes) — see StandardSettings.tsx. Continues to AvailablePage (via router state,
 * not a DB write yet) once "Find ledige" is pressed.
 */
export function ReservationPage() {
  const { session, profile, afdelingId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const editing = (location.state as { editing?: EditingBooking } | null)?.editing ?? null;
  // bruger is a user_id (uuid) now, not an email (see
  // supabase/bookings_user_to_user_id.sql) — session.user.id is already
  // exactly that for a non-admin booking for themselves. When editing an
  // existing booking, editing.userId (whoever it was originally for) wins
  // over both defaults.
  const [bruger, setBruger] = useState(
    editing?.userId ?? (profile?.role === "admin" ? "" : session?.user.id ?? ""),
  );
  const [anvendelseOption, setAnvendelseOption] = useState("");
  const [anvendelseCustom, setAnvendelseCustom] = useState("");
  /** The actual "anvendelse" value used downstream — the selected option, or (when ANDET_VALUE is picked) the user's own free-text reason. */
  const anvendelse = anvendelseOption === ANDET_VALUE ? anvendelseCustom : anvendelseOption;
  const [anvendelseOptions, setAnvendelseOptions] = useState<string[]>([]);
  const [users, setUsers] = useState<{ user_id: string; email: string; department_id: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("user_profiles")
      .select("user_id, email, department_id")
      .is("deleted_at", null)
      .order("email")
      .then(({ data, error: usersError }) => {
        if (usersError) {
          setError(usersError.message);
          return;
        }
        setUsers(
          (data ?? []).filter(
            (u): u is { user_id: string; email: string; department_id: string | null } => Boolean(u.email),
          ),
        );
      });
  }, []);

  /** Loads the "Anvendelse" dropdown's options as the union of the user's own department's list (department_settings) and their personal extra options (user_settings) — see fetchSettingUnion. ANDET_VALUE is always sorted to the end, regardless of where it sits in the stored array. */
  useEffect(() => {
    void fetchSettingUnion("Anvendelse", profile?.user_id, afdelingId)
      .then(sortAnvendelserWithAndetLast)
      .then(setAnvendelseOptions);
  }, [profile?.user_id, afdelingId]);

  const isAdmin = profile?.role === "admin";
  /** Whether a non-admin user may create an open-ended ("Ingen slutdato") reservation, per Tillad_reservation_uden_sluttidspunkt. Admins can always do so regardless — see handleEndIgnoreToggle. */
  const [userMayIgnoreEnd, setUserMayIgnoreEnd] = useState(false);
  const canIgnoreEnd = isAdmin || userMayIgnoreEnd;
  useEffect(() => {
    void isSettingTilladt("Tillad_reservation_uden_sluttidspunkt", profile?.user_id, afdelingId).then(
      setUserMayIgnoreEnd,
    );
  }, [profile?.user_id, afdelingId]);

  /** "Standard varighed"/"Standard interval" overrides (see StandardSettings.tsx) — null while loading or when neither user_settings nor department_settings has a value, in which case DEFAULT_DURATION_MINUTES/DEFAULT_INTERVAL_MINUTES are used instead. */
  const [standardDurationMinutes, setStandardDurationMinutes] = useState<number | null>(null);
  const [standardIntervalMinutes, setStandardIntervalMinutes] = useState<number | null>(null);
  useEffect(() => {
    void fetchSettingText("Standard_varighed", profile?.user_id, afdelingId).then((raw) => {
      setStandardDurationMinutes(raw ? parseHHMMToMinutes(raw) : null);
    });
    void fetchSettingText("Standard_interval", profile?.user_id, afdelingId).then((raw) => {
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      setStandardIntervalMinutes(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
    });
  }, [profile?.user_id, afdelingId]);

  const effectiveDurationMinutes = standardDurationMinutes ?? DEFAULT_DURATION_MINUTES;
  const timeOptions = useMemo(
    () => buildTimeOptions(standardIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES),
    [standardIntervalMinutes],
  );

  /** Pre-selects the booking-being-edited's Anvendelse once the options list has loaded — a plain "Anvendelse" match wins if the loaded list still has that exact option, otherwise it's treated as a free-text "Andet" reason (mirrors how the anvendelse getter below reconstructs the same distinction on submit). Guarded by editingPrefilled so a later options reload (e.g. afdelingId somehow changing) never clobbers a value the admin has since edited by hand. */
  const editingAnvendelsePrefilled = useRef(false);
  useEffect(() => {
    if (!editing || editingAnvendelsePrefilled.current || anvendelseOptions.length === 0) return;
    editingAnvendelsePrefilled.current = true;
    if (anvendelseOptions.includes(editing.anvendelse)) {
      setAnvendelseOption(editing.anvendelse);
    } else {
      setAnvendelseOption(ANDET_VALUE);
      setAnvendelseCustom(editing.anvendelse);
    }
  }, [editing, anvendelseOptions]);

  const departmentUsers = users.filter((u) => u.department_id === afdelingId);

  const now = ceilToQuarterHour(new Date());
  const end = new Date(now.getTime() + effectiveDurationMinutes * 60 * 1000);
  const toIsoDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const formatTime = (date: Date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  /** "date"/"time" parts of an ISO datetime string, for pre-filling Start/Slut from an existing booking being edited. Deliberately string-sliced rather than `new Date(iso).getHours()` — editing.startIso/endIso are raw Supabase timestamptz values with a real UTC offset (e.g. "...T14:00:00+00:00"), and `new Date()` would apply an actual timezone conversion here, silently shifting the pre-filled time by the browser's UTC offset. Every other place in this codebase (lib/bookings.ts's isoPrefix/addMinutesToIso) avoids exactly this by treating these strings as naive wall-clock digits — same convention applied here. */
  const splitIso = (iso: string) => ({ date: iso.slice(0, 10), time: iso.slice(11, 16) });
  const initialStart = editing ? splitIso(editing.startIso) : { date: toIsoDate(now), time: formatTime(now) };
  const initialEnd = editing?.endIso ? splitIso(editing.endIso) : { date: toIsoDate(end), time: formatTime(end) };
  /** Adds minutes to a "HH:mm" time, reporting how many calendar days the result rolled over (can be negative). */
  const addMinutes = (time: string, minutes: number): { time: string; daysAdded: number } => {
    const [hours, mins] = time.split(":").map(Number);
    const totalMinutes = hours * 60 + mins + minutes;
    const daysAdded = Math.floor(totalMinutes / (24 * 60));
    const total = totalMinutes - daysAdded * 24 * 60;
    return {
      time: `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
      daysAdded,
    };
  };

  const addDaysToIsoDate = (dateStr: string, days: number): string => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    return toIsoDate(date);
  };

  const [startDate, setStartDate] = useState(initialStart.date);
  const [endDate, setEndDate] = useState(initialEnd.date);
  const [startTime, setStartTime] = useState(initialStart.time);
  const [endTime, setEndTime] = useState(initialEnd.time);
  /** When true (the "Nu" clock icon button is pressed/active), Start is locked to the current moment and its fields are disabled — see handleNowToggle. */
  const [startIsNow, setStartIsNow] = useState(false);
  /** When true, End is cleared and its fields are replaced by an "Ingen slutdato" label — see handleEndIgnoreToggle. Starts true when editing a booking that was itself open-ended (endIso null). */
  const [endIgnored, setEndIgnored] = useState(Boolean(editing && editing.endIso === null));
  /** The End date/time as they were right before "ignore" was turned on, restored if it's turned back off. */
  const ignoredEndRef = useRef<{ date: string; time: string } | null>(null);
  const { activeKey: warningKey, trigger: triggerWarning } = useTimedFlag();

  /**
   * Once "Standard varighed" has resolved (found or not — standardDurationMinutes
   * is only null while still loading), re-applies End as Start + that
   * duration — the initial `end`/initialEnd computed above already used
   * effectiveDurationMinutes, but only as a useState *initializer*, which
   * doesn't re-run once the async fetch settles after first render. Skipped
   * when editing an existing booking (that already has its own concrete
   * End) and guarded to run only once, so it can't clobber an End the user
   * has since edited by hand.
   */
  const durationAppliedRef = useRef(false);
  useEffect(() => {
    if (editing || standardDurationMinutes === null || durationAppliedRef.current) return;
    durationAppliedRef.current = true;
    const start = new Date(`${startDate}T${startTime}:00`);
    const newEnd = new Date(start.getTime() + standardDurationMinutes * 60 * 1000);
    setEndDate(toIsoDate(newEnd));
    setEndTime(formatTime(newEnd));
  }, [editing, standardDurationMinutes]);

  /**
   * Commits a new start date/time. Rejects anything in the past (snapping
   * back to "now", rounded up to the next quarter hour, with a warning)
   * instead of accepting it. When `syncEndDate` is true (date input changed),
   * the end date follows the start date; when the resulting end time would
   * no longer be after the new start time on the same day, it's bumped
   * forward by 30 minutes (rolling the end date forward too if that bump
   * crosses midnight).
   */
  const applyStartDateTime = (candidateDate: string, candidateTime: string, syncEndDate: boolean) => {
    let date = candidateDate;
    let time = candidateTime;

    if (new Date(`${date}T${time}:00`).getTime() < Date.now()) {
      const current = ceilToQuarterHour(new Date());
      date = toIsoDate(current);
      time = formatTime(current);
      triggerWarning("start");
    }

    setStartDate(date);
    setStartTime(time);

    const effectiveEndDate = syncEndDate ? date : endDate;
    if (syncEndDate) {
      setEndDate(date);
    }
    if (effectiveEndDate === date && endTime <= time) {
      const bumped = addMinutes(time, 30);
      setEndTime(bumped.time);
      if (bumped.daysAdded > 0) {
        setEndDate(addDaysToIsoDate(date, bumped.daysAdded));
      }
    }
  };

  /** Commits a new end date/time. If it would land at or before the current start, corrects it to start + 30 minutes (rolling the date forward if that crosses midnight) and shows a warning, instead of accepting an invalid/zero-duration reservation. */
  const applyEndDateTime = (candidateDate: string, candidateTime: string) => {
    let date = candidateDate;
    let time = candidateTime;

    if (new Date(`${date}T${time}:00`).getTime() <= new Date(`${startDate}T${startTime}:00`).getTime()) {
      const bumped = addMinutes(startTime, 30);
      date = bumped.daysAdded > 0 ? addDaysToIsoDate(startDate, bumped.daysAdded) : startDate;
      time = bumped.time;
      triggerWarning("end");
    }

    setEndDate(date);
    setEndTime(time);
  };

  /**
   * Locks Start to the current moment (disabling its fields) when the "Nu"
   * button is pressed on, or just re-enables editing (leaving the last value
   * in place) when pressed off. Doesn't go through applyStartDateTime: that
   * function rejects "past" candidates and rounds up to the next quarter
   * hour, but a value computed as `new Date()` right now would almost always
   * be judged already in the past by the time the comparison runs a moment
   * later — rounding it up instead of keeping the exact current moment "Nu"
   * is supposed to mean.
   */
  const handleNowToggle = (nowActive: boolean) => {
    setStartIsNow(nowActive);
    if (!nowActive) return;

    const current = new Date();
    const endMoment = new Date(current.getTime() + effectiveDurationMinutes * 60 * 1000);

    setStartDate(toIsoDate(current));
    setStartTime(formatTime(current));
    // Matches the page's own initial default (now -> now+3h) — un-ignores
    // End if it was ignored, since "Nu" is establishing a fresh, concrete
    // booking window.
    setEndIgnored(false);
    setEndDate(toIsoDate(endMoment));
    setEndTime(formatTime(endMoment));
  };

  /**
   * Clears End and swaps its date/time inputs for an "Ingen slutdato" label
   * when turned on, or restores whatever End held right before it was
   * turned on. Unlike "Nu", there's no live value to keep computing while
   * ignored — an ignored End just stays empty until turned back off.
   * Turning it on requires Tillad_reservation_uden_sluttidspunkt (admins
   * always may) — otherwise shows a warning instead, matching the
   * start/end warnings above rather than just disabling the button.
   */
  const handleEndIgnoreToggle = () => {
    if (endIgnored) {
      const restored = ignoredEndRef.current;
      if (restored) {
        setEndDate(restored.date);
        setEndTime(restored.time);
      }
      setEndIgnored(false);
      return;
    }

    if (!canIgnoreEnd) {
      triggerWarning("endBlocked");
      return;
    }

    ignoredEndRef.current = { date: endDate, time: endTime };
    setEndDate("");
    setEndTime("");
    setEndIgnored(true);
  };

  const handleFindAvailable = () => {
    // Recomputed fresh here (not read from possibly-stale state) so a delay
    // between checking "Nu" and pressing "Find ledige" can't submit a start
    // time that's already slipped into the past.
    const current = new Date();
    const start = startIsNow
      ? `${toIsoDate(current)}T${formatTime(current)}:00`
      : `${startDate}T${startTime}:00`;
    // An ignored End means "no end constraint" — pass null rather than a
    // malformed "T:00" string, matching how AvailablePage/bookings.ts
    // already treat a null start/end as unbounded (see isVehicleAvailable).
    const end = endIgnored ? null : `${endDate}T${endTime}:00`;
    // bruger is a user_id now — resolve a display-ready email to carry
    // through router state too, so AvailablePage/ConfirmPage never need a
    // fresh lookup just to show who the booking is for.
    const brugerLabel =
      profile?.role === "admin"
        ? (departmentUsers.find((u) => u.user_id === bruger)?.email ?? editing?.userLabel ?? "")
        : (session?.user.email ?? "");

    navigate("/available", {
      state: {
        user: bruger,
        userLabel: brugerLabel,
        use: anvendelse,
        start,
        end,
        editingBookingId: editing?.bookingId,
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
          <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">
                {editing ? "Rediger reservation" : "Opret reservation"}
              </h2>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Bruger {profile?.role === "admin" && <span className="ml-0.5 text-red-600">*</span>}
                    </label>
                    {profile?.role === "admin" ? (
                      <select
                        value={bruger}
                        onChange={(e) => setBruger(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      >
                        <option value="">Vælg bruger</option>
                        {departmentUsers.map((u) => (
                          <option key={u.user_id} value={u.user_id}>
                            {u.email}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={session?.user.email ?? ""}
                        disabled
                        readOnly
                        className="rounded-lg border border-brand-200 bg-brand-100 px-3 py-2 text-sm text-brand-800 outline-none"
                      />
                    )}
                  </div>
                  {/* Anvendelse + (conditionally) Angiv årsag are wrapped
                      together in one div so they count as a SINGLE child of
                      the parent's divide-y — that border only ever lands
                      between direct children, so nesting both rows one level
                      deeper guarantees no line can appear between them,
                      rather than relying on a border-t-0 override to beat it
                      on specificity. */}
                  <div>
                    <div className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                      <label className="flex items-center text-sm font-medium text-brand-700">
                        Anvendelse <span className="ml-0.5 text-red-600">*</span>
                      </label>
                      <select
                        required
                        aria-required="true"
                        value={anvendelseOption}
                        onChange={(e) => setAnvendelseOption(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      >
                        <option value="">Vælg anvendelse</option>
                        {anvendelseOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    {anvendelseOption === ANDET_VALUE && (
                      <div className="grid grid-cols-2 gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
                        <label className="flex items-center justify-end text-sm font-medium text-brand-700">
                          Angiv årsag <span className="ml-0.5 text-red-600">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          aria-required="true"
                          value={anvendelseCustom}
                          onChange={(e) => setAnvendelseCustom(e.target.value)}
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      </div>
                    )}
                  </div>
                  <div className="relative grid grid-cols-[4rem_3.5rem_1fr_1fr] items-center gap-0.5 p-3 sm:p-4">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Start
                    </label>
                    <button
                      type="button"
                      onClick={() => handleNowToggle(!startIsNow)}
                      aria-pressed={startIsNow}
                      aria-label="Nu"
                      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                        startIsNow
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-brand-200 bg-brand-50/60 text-brand-700 hover:bg-brand-100"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </button>
                    <input
                      type="date"
                      value={startDate}
                      disabled={startIsNow}
                      onChange={(e) => applyStartDateTime(e.target.value, startTime, true)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <TimeSelect
                      value={startTime}
                      options={timeOptions}
                      onChange={(t) => applyStartDateTime(startDate, t, false)}
                      disabled={startIsNow}
                    />
                    <InlinePopup visible={warningKey === "start"} message="Start kan ikke være før nu" variant="warning" />
                  </div>
                  <div className="relative grid grid-cols-[4rem_3.5rem_1fr_1fr] items-center gap-0.5 p-3 sm:p-4">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Slut
                    </label>
                    <button
                      type="button"
                      onClick={handleEndIgnoreToggle}
                      aria-pressed={endIgnored}
                      aria-label="Ignorer slut"
                      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                        endIgnored
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-brand-200 bg-brand-50/60 text-brand-700 hover:bg-brand-100"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                    </button>
                    {endIgnored ? (
                      <div className="col-span-2 rounded-lg border border-brand-200 bg-brand-100 px-3 py-2 text-sm italic text-brand-600">
                        Ingen slutdato
                      </div>
                    ) : (
                      <>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => applyEndDateTime(e.target.value, endTime)}
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                        <TimeSelect
                          value={endTime}
                          options={timeOptions.filter((t) => startDate !== endDate || t > startTime)}
                          onChange={(t) => applyEndDateTime(endDate, t)}
                        />
                      </>
                    )}
                    <InlinePopup visible={warningKey === "end"} message="Slut kan ikke være før Start" variant="warning" />
                    <InlinePopup
                      visible={warningKey === "endBlocked"}
                      message="Du har ikke tilladelse til reservationer uden sluttid"
                      variant="warning"
                    />
                  </div>
                </div>
              </div>

              <p className="text-right text-xs text-brand-500">
                <span className="text-red-600">*</span> Feltet skal udfyldes
              </p>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={handleFindAvailable}
                  disabled={!bruger || !anvendelse.trim()}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
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
