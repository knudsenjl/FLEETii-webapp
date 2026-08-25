import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { TimeSelect } from "../components/TimeSelect";
import { InlinePopup } from "../components/InlinePopup";
import { supabase } from "../lib/supabase";
import type { EditingBooking } from "../lib/bookings";
import {
  ANDET_VALUE,
  fetchSettingText,
  fetchSettingUnion,
  isSettingTilladt,
  sortAnvendelserWithAndetLast,
} from "../lib/settings";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useTimedFlag } from "../hooks/useTimedFlag";

/**
 * Every field this page's form needs to fully restore itself — stashed into
 * this page's OWN history entry (replace, not push) right before "Find
 * ledige"/"Skift køretøj" navigates to AvailablePage, and read back on
 * mount. Without this, a browser back-navigation from AvailablePage remounts
 * this page fresh: React Router's history state is only ever what a
 * navigate() call explicitly set on an entry, never a live mirror of a
 * component's local useState — so everything typed just vanished. The app's
 * own "Fortryd"/back buttons never had this problem (they don't return HERE
 * at all), only the browser's native back button does.
 */
type ReservationFormSnapshot = {
  selectedDepartmentId: string;
  bruger: string;
  anvendelseOption: string;
  anvendelseCustom: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  startIsNow: boolean;
  endIgnored: boolean;
};

/** Hardcoded fallbacks used whenever "Standard varighed"/"Standard interval" (department_settings/user_settings, see StandardSettings.tsx) has no value for the current user/department. */
const DEFAULT_DURATION_MINUTES = 3 * 60;
const DEFAULT_INTERVAL_MINUTES = 15;

/** Every `stepMinutes` of the day as "HH:mm" strings, for the Start/Slut TimeSelect dropdowns — step comes from "Standard interval" (falling back to DEFAULT_INTERVAL_MINUTES). "00" is a valid "Standard interval" value in its own right (see ceilToInterval) but isn't a meaningful STEP size — falls back to 1-minute granularity (every minute of the day, fully browsable) rather than dividing by zero. */
function buildTimeOptions(stepMinutes: number): string[] {
  const step = stepMinutes > 0 ? stepMinutes : 1;
  const count = Math.floor((24 * 60) / step);
  return Array.from({ length: count }, (_, i) => {
    const totalMinutes = i * step;
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

/**
 * Rounds a Date up to the next "Standard interval" boundary — 00 (see
 * StandardSettings.tsx's Standard_interval options) means "no rounding at
 * all", returned unchanged (a new reservation starts at the exact current
 * moment); 15/30/45/60 rounds up to the next hh:15/hh:30/hh:45/hh+1:00,
 * already sitting exactly on a boundary is left unchanged (matches the old
 * ceilToQuarterHour's Math.ceil semantics: "the next boundary at or after
 * this moment"). Deliberately computed from the Date's own LOCAL
 * hours/minutes (getHours/getMinutes), not epoch milliseconds — an
 * epoch-ms-based ceiling (the old ceilToQuarterHour's approach) only lines
 * up with LOCAL wall-clock boundaries when the local UTC offset is itself a
 * multiple of intervalMinutes, which breaks for 45 under Denmark's own
 * +60/+120 minute offsets (60/120 aren't multiples of 45) — see
 * CLAUDE.md's "naive wall-clock timestamps" convention for why this
 * codebase avoids exactly this kind of instant-based arithmetic on times
 * that are meant to read the same on-screen regardless of timezone.
 */
function ceilToInterval(date: Date, intervalMinutes: number): Date {
  if (intervalMinutes <= 0) return date;

  const result = new Date(date);
  result.setSeconds(0, 0);
  const totalMinutes = result.getHours() * 60 + result.getMinutes();
  const remainder = totalMinutes % intervalMinutes;
  if (remainder !== 0) {
    result.setMinutes(result.getMinutes() + (intervalMinutes - remainder));
  }
  return result;
}

/**
 * Step 1 of the booking flow ("/reservation"): pick who the reservation is
 * for (admins pick from their department's users; regular users always book
 * for themselves), what it's for, and the start/end date+time. Defaults to
 * "now" through "+Standard varighed" (falling back to +3 hours when unset),
 * with the Start/Slut TimeSelect stepping by "Standard interval" (falling
 * back to 15 minutes) — see StandardSettings.tsx. Continues to AvailablePage
 * (via router state, not a DB write yet) once "Find ledigt køretøj" is pressed. No
 * DB write happens on this page itself, whether creating or editing — the
 * actual insert/update only ever happens on ConfirmPage's "Bekræft".
 * When editing an existing booking (reached via BookingDetailsPage's
 * "Rediger reservation"), "Find ledigt køretøj" is instead two buttons: "Bekræft/
 * skift køretøj" (same action as "Find ledigt køretøj" — always goes through AvailablePage,
 * even to just keep the same vehicle, so the current period's actual
 * availability is checked and shown rather than only discovered as an error
 * on ConfirmPage; AvailablePage lets this booking's own current vehicle
 * bypass the department filter there, see its availableVehicles, so it's
 * reachable for reselection) and "Fortryd" (abandons the edit, no DB
 * changes, back to the booking's detail page).
 *
 * For a FLEETii admin (no department of their own — see isFleetiiAdmin), an
 * extra required "Kunde/afdeling" row comes first, letting them pick which
 * department platform-wide this booking belongs to — every department,
 * shown as "Kunde / Afdeling" (departmentOptions), same convention as
 * PageHeader's own "Skift afdeling". That pick is what actually scopes
 * AvailablePage's vehicle list (not afdelingId, which is null for them) and
 * is what ConfirmPage eventually writes as the booking's department_id.
 * Pre-filled to the booking's own current department when editing (via
 * EditingBooking's departmentId), unset when creating a brand-new one —
 * "Find ledigt køretøj"/"Bekræft/skift køretøj" both stay disabled until it's
 * chosen. The "Bruger" picker is gated on it too: disabled and scoped to
 * ONLY that department's own users (departmentUsers) rather than every user
 * platform-wide, and cleared back to unset the moment "Kunde/afdeling"
 * itself changes (the old pick may not even belong to the new department).
 * Every other role never sees the "Kunde/afdeling" row at all; their own
 * afdelingId is used unchanged, exactly as before.
 */
export function ReservationPage() {
  const { session, profile, afdelingId, afdeling, costumerName } = useAuth();
  /** Whether afdelingId's department shows the Bruger-ID value (vs. plain E-mail) below — see useIdentSettings' own doc comment. Same pattern as AllBookingsPage.tsx/BookingDetailsPage.tsx: the label is always "Bruger", only the value source swaps — this is the actual required field for picking who a booking is for, not an optional extra. */
  const { useUserIdent } = useIdentSettings(afdelingId);
  const navigate = useNavigate();
  const location = useLocation();
  const editing = (location.state as { editing?: EditingBooking } | null)?.editing ?? null;
  /** Present only when this page was reached via a browser back-navigation from AvailablePage — see ReservationFormSnapshot's own doc comment. Wins over every other default below, but never over editing's OWN fields where a snapshot field is itself blank (e.g. anvendelseCustom empty) — see each initializer. */
  const formSnapshot = (location.state as { formSnapshot?: ReservationFormSnapshot } | null)?.formSnapshot ?? null;
  const isAdmin = profile?.role === "admin" || profile?.role === "FLEETii admin";
  /** A FLEETii admin has no department of their own (platform-wide role) — for them alone, the "Kunde/afdeling" row below is what actually picks which department this booking belongs to (and which department's vehicles AvailablePage shows), rather than defaulting to afdelingId the way every other role does. */
  const isFleetiiAdmin = profile?.role === "FLEETii admin";
  /** Pre-fills to the booking being edited's own current department (see EditingBooking's departmentId) — otherwise unset, requiring an explicit pick, same as bruger's own editing?.userId prefill just below. */
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(
    formSnapshot?.selectedDepartmentId ?? editing?.departmentId ?? "",
  );
  const [departmentOptions, setDepartmentOptions] = useState<
    { department_id: string; name: string; costumerName: string | null }[]
  >([]);
  // bruger is a user_id (uuid) now, not an email (see
  // supabase/bookings_user_to_user_id.sql) — session.user.id is already
  // exactly that for a non-admin booking for themselves. When editing an
  // existing booking, editing.userId (whoever it was originally for) wins
  // over both defaults.
  const [bruger, setBruger] = useState(formSnapshot?.bruger ?? editing?.userId ?? (isAdmin ? "" : session?.user.id ?? ""));
  const [anvendelseOption, setAnvendelseOption] = useState(formSnapshot?.anvendelseOption ?? "");
  const [anvendelseCustom, setAnvendelseCustom] = useState(formSnapshot?.anvendelseCustom ?? "");
  /** The actual "anvendelse" value used downstream — the selected option, or (when ANDET_VALUE is picked) the user's own free-text reason. */
  const anvendelse = anvendelseOption === ANDET_VALUE ? anvendelseCustom : anvendelseOption;
  const [anvendelseOptions, setAnvendelseOptions] = useState<string[]>([]);
  const [users, setUsers] = useState<
    { user_id: string; email: string; user_ident: string | null; department_id: string | null }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  // Re-fetches whenever the active department changes (via PageHeader's
  // "Skift afdeling") — user_profiles' SELECT RLS
  // (user_profiles_select_admin_own_department) scopes rows to the admin's
  // CURRENT department, so an empty dependency array left this list (and
  // the "bruger" dropdown built from it below) stuck showing whichever
  // department was active on mount — see DepartmentPage.tsx's identical fix.
  useEffect(() => {
    supabase
      .from("user_profiles")
      .select("user_id, email, user_ident, department_id")
      .is("deleted_at", null)
      .order("email")
      .then(({ data, error: usersError }) => {
        if (usersError) {
          setError(usersError.message);
          return;
        }
        setUsers(
          (data ?? []).filter(
            (u): u is { user_id: string; email: string; user_ident: string | null; department_id: string | null } =>
              Boolean(u.email),
          ),
        );
      });
  }, [afdelingId]);

  /** Loads EVERY department platform-wide, each carrying its own costumer's name, for the "Kunde/afdeling" row's select — FLEETii-admin only, same query/shape as AuthContext's loadAvailableDepartments/ConfirmPage's own former version of this effect (departments' and costumers' SELECT RLS are both unrestricted for any authenticated user). */
  useEffect(() => {
    if (!isFleetiiAdmin) return;

    let cancelled = false;
    void supabase
      .from("departments")
      .select("department_id, name, costumers(name)")
      .order("name", { ascending: true })
      .returns<{ department_id: string; name: string; costumers: { name: string } | null }[]>()
      .then(({ data }) => {
        if (cancelled) return;
        setDepartmentOptions(
          (data ?? []).map((row) => ({
            department_id: row.department_id,
            name: row.name,
            costumerName: row.costumers?.name ?? null,
          })),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [isFleetiiAdmin]);

  /** Loads the "Anvendelse" dropdown's options as the union of the user's own department's list (department_settings) and their personal extra options (user_settings) — see fetchSettingUnion. ANDET_VALUE is guaranteed present here even if it's missing from BOTH fetched rows (a department created before backfill_and_seed_default_anvendelse.sql, or afdelingId === null — a FLEETii admin sitting on "Alle", see the "let FLEETii admin operate unscoped" work — never resolves a department_settings row to seed it from at all) — the option to type a free-text reason must always exist, not just whenever the DB happens to have been seeded. Always sorted to the end, regardless of where it sits (or whether it was just appended). */
  useEffect(() => {
    void fetchSettingUnion("Anvendelse", profile?.user_id, afdelingId)
      .then((values) => (values.includes(ANDET_VALUE) ? values : [...values, ANDET_VALUE]))
      .then(sortAnvendelserWithAndetLast)
      .then(setAnvendelseOptions);
  }, [profile?.user_id, afdelingId]);

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
      // >= 0, not > 0 — "00" (parsed to 0) is a real, meaningful override
      // (see ceilToInterval: 0 means "no rounding, start right now"), not
      // the same as "no override configured" (raw itself null/missing).
      setStandardIntervalMinutes(Number.isFinite(parsed) && parsed >= 0 ? parsed : null);
    });
  }, [profile?.user_id, afdelingId]);

  const effectiveDurationMinutes = standardDurationMinutes ?? DEFAULT_DURATION_MINUTES;
  const effectiveIntervalMinutes = standardIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
  const timeOptions = useMemo(() => buildTimeOptions(effectiveIntervalMinutes), [effectiveIntervalMinutes]);

  /** Pre-selects the booking-being-edited's Anvendelse once the options list has loaded — a plain "Anvendelse" match wins if the loaded list still has that exact option, otherwise it's treated as a free-text "Andet" reason (mirrors how the anvendelse getter below reconstructs the same distinction on submit). Guarded by editingPrefilled so a later options reload (e.g. afdelingId somehow changing) never clobbers a value the admin has since edited by hand — starts already-true when restoring from formSnapshot (both editing AND bouncing back from AvailablePage via "Skift køretøj"), since anvendelseOption/anvendelseCustom already came from the snapshot above and this effect must not overwrite them. */
  const editingAnvendelsePrefilled = useRef(Boolean(formSnapshot));
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

  // A FLEETii admin has no department of their own, so "Bruger" is scoped to
  // whichever department they picked in "Kunde/afdeling" instead of
  // afdelingId — empty (and the Bruger select disabled, see above) until
  // one is chosen, never "every user platform-wide": picking a department
  // first is what makes the Bruger list meaningful at all.
  //
  // A plain admin can always book for THEMSELVES too, regardless of
  // whether the active department (afdelingId) happens to be their own
  // hjemmeafdeling — an admin with a user_departments grant for another
  // department (see "Skift afdeling") would otherwise vanish from their
  // own Bruger list the moment they switch into it, since their
  // user_profiles.department_id (home department) no longer matches
  // afdelingId. Their own row is always RLS-visible regardless (see
  // user_profiles_select_own), so `users` already has it — just add it
  // back in here instead of letting the department filter drop it.
  const departmentUsers = isFleetiiAdmin
    ? users.filter((u) => u.department_id === selectedDepartmentId)
    : users.filter((u) => u.department_id === afdelingId || u.user_id === session?.user.id);

  const now = ceilToInterval(new Date(), effectiveIntervalMinutes);
  const end = new Date(now.getTime() + effectiveDurationMinutes * 60 * 1000);
  const toIsoDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const formatTime = (date: Date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  /** "date"/"time" parts of an ISO datetime string, for pre-filling Start/Slut from an existing booking being edited. Deliberately string-sliced rather than `new Date(iso).getHours()` — editing.startIso/endIso are raw Supabase timestamptz values with a real UTC offset (e.g. "...T14:00:00+00:00"), and `new Date()` would apply an actual timezone conversion here, silently shifting the pre-filled time by the browser's UTC offset. Every other place in this codebase (lib/bookings.ts's isoPrefix/addMinutesToIso) avoids exactly this by treating these strings as naive wall-clock digits — same convention applied here. */
  const splitIso = (iso: string) => ({ date: iso.slice(0, 10), time: iso.slice(11, 16) });
  const initialStart = formSnapshot
    ? { date: formSnapshot.startDate, time: formSnapshot.startTime }
    : editing
      ? splitIso(editing.startIso)
      : { date: toIsoDate(now), time: formatTime(now) };
  const initialEnd = formSnapshot
    ? { date: formSnapshot.endDate, time: formSnapshot.endTime }
    : editing?.endIso
      ? splitIso(editing.endIso)
      : { date: toIsoDate(end), time: formatTime(end) };
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
  const [startIsNow, setStartIsNow] = useState(formSnapshot?.startIsNow ?? false);
  /** When true, End is cleared and its fields are replaced by an "Ingen slutdato" label — see handleEndIgnoreToggle. Starts true when editing a booking that was itself open-ended (endIso null), or when restoring a formSnapshot that had it on. */
  const [endIgnored, setEndIgnored] = useState(formSnapshot?.endIgnored ?? Boolean(editing && editing.endIso === null));
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
   * has since edited by hand — starts already-applied when restoring from
   * formSnapshot too, for the same reason: initialEnd already came from the
   * snapshot, not effectiveDurationMinutes, and must not be overwritten.
   */
  const durationAppliedRef = useRef(Boolean(formSnapshot));
  useEffect(() => {
    if (editing || standardDurationMinutes === null || durationAppliedRef.current) return;
    durationAppliedRef.current = true;
    const start = new Date(`${startDate}T${startTime}:00`);
    const newEnd = new Date(start.getTime() + standardDurationMinutes * 60 * 1000);
    setEndDate(toIsoDate(newEnd));
    setEndTime(formatTime(newEnd));
  }, [editing, standardDurationMinutes]);

  /**
   * Same reapplication as durationAppliedRef just above, but for "Standard
   * interval" and Start rather than "Standard varighed" and End — the
   * initial `now`/initialStart computed above already used
   * effectiveIntervalMinutes, but again only as a useState *initializer*.
   * Recomputes both Start (ceilToInterval against a fresh "now") AND End
   * (Start + whatever duration is currently known — effectiveDurationMinutes
   * already falls back to the default while that's still loading, and gets
   * corrected by durationAppliedRef above once it resolves, regardless of
   * which of these two effects happens to fire first). Same
   * editing/formSnapshot/run-once guards as durationAppliedRef.
   */
  const intervalAppliedRef = useRef(Boolean(formSnapshot));
  useEffect(() => {
    if (editing || standardIntervalMinutes === null || intervalAppliedRef.current) return;
    intervalAppliedRef.current = true;
    const start = ceilToInterval(new Date(), standardIntervalMinutes);
    const newEnd = new Date(start.getTime() + effectiveDurationMinutes * 60 * 1000);
    setStartDate(toIsoDate(start));
    setStartTime(formatTime(start));
    setEndDate(toIsoDate(newEnd));
    setEndTime(formatTime(newEnd));
  }, [editing, standardIntervalMinutes]);

  /**
   * Commits a new start date/time. Rejects anything in the past (snapping
   * back to "now", rounded up to the next "Standard interval" boundary)
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
      const current = ceilToInterval(new Date(), effectiveIntervalMinutes);
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

  /**
   * {start, end, brugerLabel} freshly computed from the current form state —
   * shared by handleFindAvailable/handleUpdateSameVehicle so neither can
   * submit a stale value. Recomputed fresh on each call (not read from
   * possibly-stale state) so a delay between checking "Nu" and pressing the
   * button can't submit a start time that's already slipped into the past.
   * An ignored End means "no end constraint" — null rather than a malformed
   * "T:00" string, matching how AvailablePage/bookings.ts already treat a
   * null start/end as unbounded (see isVehicleAvailable). bruger is a
   * user_id now — brugerLabel resolves a display-ready email alongside it,
   * so AvailablePage/ConfirmPage never need a fresh lookup just to show who
   * the booking is for.
   */
  const currentPeriod = () => {
    const current = new Date();
    const start = startIsNow
      ? `${toIsoDate(current)}T${formatTime(current)}:00`
      : `${startDate}T${startTime}:00`;
    const end = endIgnored ? null : `${endDate}T${endTime}:00`;
    const selectedUser = departmentUsers.find((u) => u.user_id === bruger);
    const brugerLabel =
      isAdmin
        ? ((useUserIdent ? selectedUser?.user_ident : undefined) || selectedUser?.email) ?? editing?.userLabel ?? ""
        : ((useUserIdent && profile?.user_ident) || profile?.email || session?.user.email) ?? "";
    return { start, end, brugerLabel };
  };

  /** Display-ready "Kunde/afdeling" label matching the resolved departmentId below — the picked department's own "Kunde / Afdeling" for a FLEETii admin, or the viewer's own afdeling (with costumerName, when set) for every other role. Same "Kunde / Afdeling" (space-slash-space) format as PageHeader's "Skift afdeling" dropdown and this page's own Kunde/afdeling select just below — not PageHeader's OTHER, no-space "Afdeling:" summary line convention. Resolved here (not re-fetched on ConfirmPage) same as brugerLabel above — passed through router state all the way to ConfirmPage, which shows it as a final, read-only "security check" row before the booking is actually written. */
  const departmentLabel = isFleetiiAdmin
    ? (() => {
        const selected = departmentOptions.find((d) => d.department_id === selectedDepartmentId);
        return selected ? (selected.costumerName ? `${selected.costumerName} / ${selected.name}` : selected.name) : "";
      })()
    : costumerName
      ? `${costumerName} / ${afdeling ?? ""}`
      : (afdeling ?? "");

  /** Not editing: the plain "Find ledigt køretøj" flow. When editing, "Skift køretøj" reuses this same helper — the only difference is which fields (editingBookingId/editingVehicleId) get carried along, so AvailablePage can exclude this booking's own slot from the conflict check and let its current vehicle bypass the department filter. Nothing is deleted here — the row is only ever changed by ConfirmPage's own update on confirm. departmentId is the RESOLVED target department — the "Kunde/afdeling" pick for a FLEETii admin (validated below, required), or just afdelingId unchanged for every other role — carried all the way through AvailablePage (which scopes its own vehicle list to it) to ConfirmPage (which writes it as the booking's department_id). departmentLabel is its display-ready counterpart, for ConfirmPage's read-only summary row. */
  const handleFindAvailable = () => {
    const { start, end, brugerLabel } = currentPeriod();

    // Snapshot the current form into THIS page's own history entry
    // (replace, not push — no extra entry added) right before navigating
    // away, so a browser back-navigation from AvailablePage lands on a
    // "/reservation" entry that still has what was typed — see
    // ReservationFormSnapshot's own doc comment. Preserves `editing` (and
    // anything else already on this entry's state) rather than clobbering it.
    const snapshot: ReservationFormSnapshot = {
      selectedDepartmentId,
      bruger,
      anvendelseOption,
      anvendelseCustom,
      startDate,
      startTime,
      endDate,
      endTime,
      startIsNow,
      endIgnored,
    };
    navigate(location.pathname, {
      replace: true,
      state: { ...(location.state as Record<string, unknown> | null), formSnapshot: snapshot },
    });

    navigate("/available", {
      state: {
        user: bruger,
        userLabel: brugerLabel,
        use: anvendelse,
        start,
        end,
        editingBookingId: editing?.bookingId,
        editingVehicleId: editing?.vehicleId,
        departmentId: isFleetiiAdmin ? selectedDepartmentId || null : afdelingId,
        departmentLabel,
      },
    });
  };

  /** "Fortryd": abandons the edit with no DB changes (nothing was deleted in this path) and returns to the booking's own detail page. */
  const handleCancelEdit = () => {
    if (!editing) return;
    navigate(`/booking-details/${editing.bookingId}`);
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

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">
                {editing ? "Rediger reservation" : "Opret reservation"}
              </h2>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  {isFleetiiAdmin && (
                    // FLEETii-admin-only — a FLEETii admin has no department
                    // of their own, so this booking's target department must
                    // be picked explicitly before AvailablePage can even show
                    // a scoped vehicle list.
                    <div className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                      <label className="flex items-center text-sm font-medium text-brand-700">
                        Kunde/afdeling <span className="ml-0.5 text-red-600">*</span>
                      </label>
                      <select
                        value={selectedDepartmentId}
                        onChange={(e) => {
                          // Clears the Bruger pick too — the previously
                          // selected user may not belong to the newly
                          // chosen department at all (departmentUsers below
                          // is scoped to it), so keeping the old value would
                          // silently book on behalf of someone outside the
                          // department this booking is now being made for.
                          setSelectedDepartmentId(e.target.value);
                          setBruger("");
                        }}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      >
                        <option value="">Vælg kunde/afdeling</option>
                        {departmentOptions.map((department) => (
                          <option key={department.department_id} value={department.department_id}>
                            {department.costumerName ? `${department.costumerName} / ${department.name}` : department.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Bruger {isAdmin && <span className="ml-0.5 text-red-600">*</span>}
                    </label>
                    {isAdmin ? (
                      <select
                        value={bruger}
                        onChange={(e) => setBruger(e.target.value)}
                        disabled={isFleetiiAdmin && !selectedDepartmentId}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed disabled:bg-brand-100"
                      >
                        <option value="">{isFleetiiAdmin && !selectedDepartmentId ? "Vælg kunde/afdeling først" : "Vælg bruger"}</option>
                        {departmentUsers.map((u) => (
                          <option key={u.user_id} value={u.user_id}>
                            {useUserIdent ? u.user_ident || u.email : u.email}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={(useUserIdent && profile?.user_ident) || profile?.email || session?.user.email || ""}
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
                          ? "border-brand-600 bg-brand-100 text-brand-700"
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
                          ? "border-brand-600 bg-brand-100 text-brand-700"
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

              {editing ? (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleFindAvailable}
                    disabled={!bruger || !anvendelse.trim() || (isFleetiiAdmin && !selectedDepartmentId)}
                    className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Bekræft/skift køretøj
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Fortryd
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={handleFindAvailable}
                    disabled={!bruger || !anvendelse.trim() || (isFleetiiAdmin && !selectedDepartmentId)}
                    className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Find ledigt køretøj
                  </button>
                </div>
              )}
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
