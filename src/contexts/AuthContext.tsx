// App-wide authentication/authorization context. Wraps Supabase Auth's
// session with the app's own `user_profiles` row (name/phone/department_id/
// role), which is the source of truth for role-based UI (admin vs. regular
// user) and department scoping (Afdeling) used throughout the app. Every
// page that needs to know "who is logged in" or "are they an admin" reads
// this via useAuth() rather than talking to Supabase directly.
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { isPasswordRecoveryCallback, supabase } from "../lib/supabase";
import { fetchSettingText } from "../lib/settings";
import { isDepartmentAdmin, isFleetiiAdmin } from "../lib/roles";

/** localStorage key for the idle-timeout tracker below — deliberately plain localStorage regardless of "remember me" (lib/supabase.ts's rememberAwareStorage), since it needs to survive a full browser/VS Code restart to catch "closed overnight" — a non-sensitive timestamp, not the session itself. */
const LAST_ACTIVITY_KEY = "fleetii_last_activity";
/** Used when neither user_settings nor department_settings has a "Session_timeout" row yet (see StandardSettings.tsx, which is where an admin/user actually sets this) — keep in sync with that component's own defaultValue. */
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
/** How often the periodic idle check runs while a tab stays open and authenticated — only matters for that "left open" case; the "closed and reopened later" case is caught by an immediate check instead (see the effect below). */
const IDLE_CHECK_INTERVAL_MS = 30_000;
/** Caps how often a real user-activity event actually writes to localStorage — mousemove-style events can fire far more often than that's useful for a minutes-scale timeout. */
const ACTIVITY_WRITE_THROTTLE_MS = 30_000;

/** A row from the `user_profiles` table — the app's own user record, keyed by the Supabase auth.users id. */
export interface Profile {
  user_id: string;
  email: string | null;
  /** Company-wide "Bruger-ID" identifier (see user_profiles_add_user_ident.sql) — takes precedence over email for display wherever the app shows a user's identifier; null/empty falls back to email. */
  user_ident: string | null;
  full_name: string | null;
  phone: string | null;
  /** References departments.department_id (uuid) — NOT a department name (see supabase/applied/user_profiles_department_to_department_id.sql). Use afdeling (context value, below) for the display name. */
  department_id: string | null;
  /** References costumers.costumer_id (uuid, see supabase/applied/user_profiles_add_costumer_id.sql). Use costumerName (context value, below) for the display name. */
  costumer_id: string | null;
  role: string;
}

/** Raw shape of a user_profiles row as selected by loadProfile, with the department name (and, nested one level further, its costumer's name via departments.costumer_id) embedded via FKs (Supabase/PostgREST resolves both relations automatically) — single objects, not arrays, since both FKs are many-to-one. */
type ProfileRow = {
  user_id: string;
  email: string | null;
  user_ident: string | null;
  full_name: string | null;
  phone: string | null;
  department_id: string | null;
  costumer_id: string | null;
  role: string;
  departments: { name: string; costumers: { name: string; deactivated_at: string | null } | null } | null;
};

/** One department a user is allowed to switch into (see user_departments_table.sql) — the set "Skift afdeling" offers, distinct from afdelingId (the one currently active). For a FLEETii admin, this is EVERY department platform-wide rather than a personal grant list (see loadAvailableDepartments) — costumerName is only ever populated on that branch, letting PageHeader.tsx disambiguate same-named departments across different costumers. */
export interface DepartmentOption {
  department_id: string;
  name: string;
  costumerName?: string | null;
}

/** Raw shape of a user_departments row as selected by loadAvailableDepartments, with the department's name embedded via FK. */
type UserDepartmentRow = {
  department_id: string;
  departments: { name: string } | null;
};

/** Raw shape of a departments row as selected by loadAvailableDepartments' FLEETii-admin branch, with its costumer's name embedded via FK. */
type AllDepartmentsRow = {
  department_id: string;
  name: string;
  costumers: { name: string } | null;
};

/** Shape of the value exposed by useAuth(). */
interface AuthContextValue {
  session: Session | null;
  /** Extra user data (name, phone, department_id, role) synced from auth.users. */
  profile: Profile | null;
  /** The logged-in user's department NAME (Afdeling), resolved via the departments join — for display. Use afdelingId for permission/filtering comparisons instead (afdeling is a name, not comparable to other tables' department_id columns). */
  afdeling: string | null;
  /** The logged-in user's department_id (uuid). Alias for profile?.department_id — compare this against other tables' department_id columns (bookings, settings), not afdeling. */
  afdelingId: string | null;
  /** The NAME of the costumer associated with the logged-in user's department (departments.costumer_id -> costumers.name), resolved via a nested join alongside afdeling. Null if the department has no costumer_id set. Display-only, like afdeling. */
  costumerName: string | null;
  /** The logged-in user's costumer_id (uuid). Alias for profile?.costumer_id — compare/scope queries against this (e.g. UserDetailsPage's department dropdown, DepartmentPage's department picker), not costumerName. */
  costumerId: string | null;
  /** The departments this user is allowed to switch into (see user_departments_table.sql) — offered by "Skift afdeling" (PageHeader.tsx). Includes the currently active one. Empty until loaded/if the user has no grants. */
  availableDepartments: DepartmentOption[];
  /** Switches the user's active department (afdelingId) to one of availableDepartments, via a direct user_profiles update (RLS restricts this to the department_id column and to a value the user holds a grant for — see user_profiles_update_own_department.sql). Refreshes profile/afdeling/costumerName on success. Returns an error message on failure (e.g. the grant was revoked between load and click), null on success. A FLEETii admin may also pass null, meaning "Alle" — clears department_id/costumer_id back to unscoped (their default state) via switch-department.mts; null is not a valid argument for any other role (PageHeader.tsx never offers an "Alle" entry to switch to for them). */
  switchDepartment: (departmentId: string | null) => Promise<string | null>;
  /** true once a valid auth session exists */
  isFullyAuthenticated: boolean;
  /** True if this account was created with the shared default password and hasn't set a real one yet (see create-user.mts/SetPasswordPage.tsx). ProtectedRoute forces such a session to /set-password before anything else. */
  mustChangePassword: boolean;
  /** True once Supabase has fired a PASSWORD_RECOVERY auth event — i.e. the current session came from clicking a "reset password" email link (LoginPage.tsx's resetPasswordForEmail), not a normal sign-in. Supabase auto-signs the user in the moment that link's tokens land in the URL, WITHOUT changing the password — without this flag, ProtectedRoute would just let a password-reset click log someone in with their old password unchanged, defeating the whole point. Cleared via clearPasswordRecovery() once SetPasswordPage.tsx has handled it. */
  isPasswordRecovery: boolean;
  /** Clears isPasswordRecovery — call after SetPasswordPage.tsx successfully sets a new password for a recovery session, before navigating away, so ProtectedRoute stops redirecting back to /set-password. */
  clearPasswordRecovery: () => void;
  /** Set when a profile load discovers the logged-in user's costumer has been deactivated ("Deaktiver kunde", see CostumerDetailsPage.tsx/costumers_add_deactivated_at.sql) — the session is force-signed-out the moment this is detected (initial load, auth-state change, or a background token refresh), and this message is left behind for LoginPage.tsx to display since the sign-out itself already happened by the time it's read. Danish, user-facing. Null otherwise. */
  deactivationMessage: string | null;
  /** Clears deactivationMessage — call after LoginPage.tsx has displayed it, so it doesn't reappear on a later, legitimate login. */
  clearDeactivationMessage: () => void;
  /** Set when the idle-timeout tracker (see the effect below) force-signs-out a session that's had no mouse/keyboard/touch/scroll activity for longer than the effective "Session_timeout" setting (StandardSettings.tsx — user_settings override, else department_settings, else DEFAULT_IDLE_TIMEOUT_MINUTES). Same "sign-out already happened, message left behind for LoginPage.tsx" pattern as deactivationMessage. Danish, user-facing. Null otherwise. */
  idleTimeoutMessage: string | null;
  /** Clears idleTimeoutMessage — call after LoginPage.tsx has displayed it, so it doesn't reappear on a later, legitimate login. */
  clearIdleTimeoutMessage: () => void;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Refreshes the session and applies it to session/profile state directly (awaited), so it's safe to navigate immediately after — see the implementation's comment for why this exists instead of just calling supabase.auth.refreshSession(). */
  refreshProfile: () => Promise<void>;
}

/** Renders a role string as the Danish label shown in page headers ("FLEETii Administrator" / "Administrator" / "Bruger"). Any value other than "admin"/"FLEETii admin" (including null/undefined) is treated as a regular user. */
export function formatRoleLabel(role?: string | null): string {
  if (isFleetiiAdmin(role)) return "FLEETii Administrator";
  return isDepartmentAdmin(role) ? "Administrator" : "Bruger";
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Standalone (usable outside the provider) check for whether the given user's costumer is currently deactivated — LoginPage.tsx calls this right after signInWithPassword, since waiting on the provider's own async onAuthStateChange-driven profile load would race against LoginPage's post-login navigation. Always returns null for role "FLEETii admin" — costumers_add_deactivated_at.sql deliberately leaves is_fleetii_admin() unaffected by deactivation so a FLEETii admin can keep managing a deactivated costumer's data (to reactivate or purge it); this client-side check must mirror that exemption, or a FLEETii admin account that happens to have a department_id/costumer_id under a deactivated costumer would get locked out entirely. Returns null (and logs) on any Supabase error, treated as "not deactivated" so a transient DB hiccup doesn't block a legitimate login. */
export async function fetchCostumerDeactivatedAt(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("role, departments!user_profiles_department_id_fkey(costumers(deactivated_at))")
    .eq("user_id", userId)
    .maybeSingle<{ role: string; departments: { costumers: { deactivated_at: string | null } | null } | null }>();
  if (error) {
    console.error("[AuthContext] fetchCostumerDeactivatedAt failed:", error);
    return null;
  }
  if (isFleetiiAdmin(data?.role)) return null;
  return data?.departments?.costumers?.deactivated_at ?? null;
}

/**
 * Provides the current Supabase session and matching `user_profiles` row to the
 * whole app. Mount once near the root (see App.tsx) — everything under it
 * can call useAuth() to read session/profile/afdeling/role state.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [afdeling, setAfdeling] = useState<string | null>(null);
  const [costumerName, setCostumerName] = useState<string | null>(null);
  const [availableDepartments, setAvailableDepartments] = useState<DepartmentOption[]>([]);
  const [isFullyAuthenticated, setIsFullyAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  // Seeded from the URL itself (see supabase.ts's comment) rather than
  // starting false and waiting for supabase-js's PASSWORD_RECOVERY event,
  // which is too late to rely on — that event has already fired (and been
  // missed) by the time this provider's effect below subscribes to it.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(isPasswordRecoveryCallback);
  const [deactivationMessage, setDeactivationMessage] = useState<string | null>(null);
  const [idleTimeoutMessage, setIdleTimeoutMessage] = useState<string | null>(null);

  /** Fetches the `user_profiles` row for the given auth user id, embedding the department's name (and, nested one level further, its costumer's name/deactivated_at) via FKs in the same query (one round-trip instead of separate departments/costumers lookups). Returns nulls (and logs) on any Supabase error, so a temporary DB hiccup degrades to "no profile" rather than throwing. */
  const loadProfile = async (
    userId: string,
  ): Promise<{
    profile: Profile | null;
    afdeling: string | null;
    costumerName: string | null;
    costumerDeactivatedAt: string | null;
  }> => {
    const { data, error } = await supabase
      .from("user_profiles")
      // Explicit !user_profiles_department_id_fkey disambiguates the embed:
      // since user_departments_table.sql, PostgREST also sees an implicit
      // many-to-many user_profiles<->departments relationship via
      // user_departments, so a bare "departments(...)" is now ambiguous
      // (PGRST201) and fails outright — this pins it to the direct FK.
      .select(
        "user_id, email, user_ident, full_name, phone, department_id, costumer_id, role, departments!user_profiles_department_id_fkey(name, costumers(name, deactivated_at))",
      )
      .eq("user_id", userId)
      .maybeSingle<ProfileRow>();
    if (error) {
      console.error("[AuthContext] user_profiles select failed:", error);
      return { profile: null, afdeling: null, costumerName: null, costumerDeactivatedAt: null };
    }
    if (!data) {
      return { profile: null, afdeling: null, costumerName: null, costumerDeactivatedAt: null };
    }
    const { departments, ...profileFields } = data;
    return {
      profile: profileFields,
      afdeling: departments?.name ?? null,
      costumerName: departments?.costumers?.name ?? null,
      // "FLEETii admin" is exempt from the deactivation lockout, mirroring
      // is_fleetii_admin() being left untouched by costumers_add_
      // deactivated_at.sql — see fetchCostumerDeactivatedAt's doc comment
      // for why.
      costumerDeactivatedAt: isFleetiiAdmin(profileFields.role) ? null : (departments?.costumers?.deactivated_at ?? null),
    };
  };

  /** Fetches the departments the given user is allowed to switch into. A FLEETii admin has no personal user_departments grants (platform-wide role, intentionally cleared — see the "let FLEETii admin operate unscoped" work) — for them alone, this returns EVERY department platform-wide instead, each carrying its own costumer's name (PageHeader.tsx shows "Kunde / Afdeling" for these, disambiguating same-named departments across costumers); switching into one of these goes through switch-department.mts rather than the direct update every other role uses (see switchDepartment below), since the column-scoped GRANT backing that direct update can never touch costumer_id. Returns [] (and logs) on any Supabase error, same degrade-gracefully approach as loadProfile. */
  const loadAvailableDepartments = async (userId: string, role: string | null): Promise<DepartmentOption[]> => {
    if (isFleetiiAdmin(role)) {
      const { data, error } = await supabase
        .from("departments")
        .select("department_id, name, costumers(name)")
        .order("name", { ascending: true })
        .returns<AllDepartmentsRow[]>();
      if (error) {
        console.error("[AuthContext] departments select failed:", error);
        return [];
      }
      return (data ?? []).map((row) => ({
        department_id: row.department_id,
        name: row.name,
        costumerName: row.costumers?.name ?? null,
      }));
    }

    const { data, error } = await supabase
      .from("user_departments")
      .select("department_id, departments(name)")
      .eq("user_id", userId)
      .returns<UserDepartmentRow[]>();
    if (error) {
      console.error("[AuthContext] user_departments select failed:", error);
      return [];
    }
    return (data ?? [])
      .filter((row) => row.departments !== null)
      .map((row) => ({ department_id: row.department_id, name: row.departments!.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  useEffect(() => {
    let mounted = true;
    // Bumped every time a new auth event starts. An in-flight profile load
    // only applies its result if it's still the most recently started
    // request when it resolves — otherwise a slower, now-stale load (e.g.
    // from a sign-out that's since been superseded by a sign-in) could
    // resolve after and overwrite the newer, correct session/profile.
    let latestRequestId = 0;

    // Profile is loaded before isFullyAuthenticated flips to true (and both
    // updates land in the same tick) so route decisions that depend on the
    // user's role never fire on a stale/empty profile — otherwise the app
    // briefly redirects everyone to the default route before correcting
    // itself once the role-based redirect resolves.
    const applyAuthState = async (newSession: Session | null, requestId: number) => {
      const next = newSession
        ? await loadProfile(newSession.user.id)
        : { profile: null, afdeling: null, costumerName: null, costumerDeactivatedAt: null };
      if (newSession && next.costumerDeactivatedAt) {
        // Caught here rather than only at LoginPage's sign-in check so a
        // costumer deactivated mid-session (an already-open tab, or the
        // background token refresh supabase-js runs periodically) also gets
        // force-signed-out, not just blocked at the next fresh login.
        if (!mounted || requestId !== latestRequestId) return;
        setSession(null);
        setProfile(null);
        setAfdeling(null);
        setCostumerName(null);
        setAvailableDepartments([]);
        setIsFullyAuthenticated(false);
        setDeactivationMessage("Din virksomheds adgang er blokeret. Kontakt FLEETii for detaljer.");
        // Same reasoning as forceSignOutForIdle's own removeItem (idle-timeout
        // effect below) — a reactivated costumer's next login shouldn't
        // inherit a now-stale activity timestamp from before this forced
        // sign-out.
        try {
          localStorage.removeItem(LAST_ACTIVITY_KEY);
        } catch (_) {
          /* ignore storage errors */
        }
        void supabase.auth.signOut();
        return;
      }
      const departments = newSession ? await loadAvailableDepartments(newSession.user.id, next.profile?.role ?? null) : [];
      if (!mounted || requestId !== latestRequestId) return;
      setSession(newSession);
      setProfile(next.profile);
      setAfdeling(next.afdeling);
      setCostumerName(next.costumerName);
      setAvailableDepartments(departments);
      setIsFullyAuthenticated(Boolean(newSession));
    };

    const initialRequestId = ++latestRequestId;
    supabase.auth.getSession().then(async ({ data }) => {
      await applyAuthState(data.session, initialRequestId);
      if (!mounted) return;
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      // Secondary signal only — isPasswordRecoveryCallback (the useState
      // initializer above) is the one this app actually relies on, since
      // this event is usually already missed by the time this listener
      // subscribes. Kept as a backup for the rare case a recovery session
      // gets established later in the tab's lifetime instead of on load.
      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
      }
      const requestId = ++latestRequestId;
      void applyAuthState(newSession, requestId);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  /**
   * Idle-timeout tracker: force-signs-out a session with no mouse/keyboard/
   * touch/scroll activity for longer than the effective "Session_timeout"
   * setting (user_settings override, else department_settings, else
   * DEFAULT_IDLE_TIMEOUT_MINUTES — see StandardSettings.tsx for where an
   * admin/user actually sets this). Re-runs whenever the effective scope
   * (user/department) changes, so switching department picks up that
   * department's own timeout rather than the previous one.
   *
   * Two distinct checks, for two distinct scenarios:
   * - An IMMEDIATE check against the last-activity timestamp already
   *   persisted in localStorage, the moment this effect runs. This is what
   *   actually catches "closed the browser/VS Code overnight, reopened it
   *   the next morning" — nothing was running while it was closed, so a
   *   live timer alone could never have caught that; only comparing against
   *   a value that survived the closure can.
   * - A periodic setInterval check, for a tab that stays open and
   *   authenticated but genuinely idle (no interaction) for longer than the
   *   timeout — the immediate check alone wouldn't catch that case, since
   *   nothing re-triggers this effect while just sitting idle.
   *
   * The activity timestamp is deliberately plain localStorage regardless of
   * "remember me" (see LAST_ACTIVITY_KEY) — it needs to survive a full
   * restart to make the first check above possible at all.
   */
  useEffect(() => {
    if (!isFullyAuthenticated) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let lastWrite = 0;
    const activityEvents: (keyof WindowEventMap)[] = ["mousedown", "keydown", "scroll", "touchstart"];

    const readLastActivity = (): number => {
      try {
        const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
        return raw ? Number(raw) : Date.now();
      } catch (_) {
        return Date.now();
      }
    };

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastWrite < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWrite = now;
      try {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      } catch (_) {
        /* ignore storage errors */
      }
    };

    const forceSignOutForIdle = () => {
      setSession(null);
      setProfile(null);
      setAfdeling(null);
      setCostumerName(null);
      setAvailableDepartments([]);
      setIsFullyAuthenticated(false);
      setIdleTimeoutMessage("Du er blevet logget ud pga. længere tids inaktivitet. Log venligst ind igen.");
      // Cleared, not just left stale: without this, the very next login
      // re-runs this effect, readLastActivity() still returns this same
      // long-past timestamp (nothing else writes to it before this check
      // runs), and the immediate staleness check below fires again straight
      // away — signing the freshly-authenticated session back out with the
      // same message before the user gets a chance to do anything.
      try {
        localStorage.removeItem(LAST_ACTIVITY_KEY);
      } catch (_) {
        /* ignore storage errors */
      }
      void supabase.auth.signOut();
    };

    void (async () => {
      const raw = await fetchSettingText("Session_timeout", profile?.user_id, profile?.department_id);
      if (cancelled) return;
      const parsedMinutes = raw ? Number.parseInt(raw, 10) : NaN;
      const timeoutMs =
        (Number.isFinite(parsedMinutes) && parsedMinutes > 0 ? parsedMinutes : DEFAULT_IDLE_TIMEOUT_MINUTES) * 60_000;

      if (Date.now() - readLastActivity() >= timeoutMs) {
        forceSignOutForIdle();
        return;
      }

      // Becoming authenticated (or this check running at all) counts as
      // activity — write immediately rather than waiting out the throttle
      // window, so a freshly-loaded session doesn't look stale on the very
      // next check.
      lastWrite = 0;
      recordActivity();

      activityEvents.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }));
      intervalId = setInterval(() => {
        if (Date.now() - readLastActivity() >= timeoutMs) {
          forceSignOutForIdle();
        }
      }, IDLE_CHECK_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      activityEvents.forEach((event) => window.removeEventListener(event, recordActivity));
    };
    // recordActivity/forceSignOutForIdle/etc. are re-created each run
    // deliberately (they close over profile/afdelingId-derived values) —
    // only the scope identifiers below should actually restart this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullyAuthenticated, profile?.user_id, profile?.department_id]);

  /** Signs the user out of Supabase and immediately clears local session/profile state (rather than waiting for the onAuthStateChange callback), so the UI reacts instantly. */
  const signOut = async () => {
    await supabase.auth.signOut();
    // Same reasoning as forceSignOutForIdle's own removeItem: leaving this
    // stale would make the idle-timeout effect's immediate check misfire on
    // the very next login.
    try {
      localStorage.removeItem(LAST_ACTIVITY_KEY);
    } catch (_) {
      /* ignore storage errors */
    }
    setSession(null);
    setProfile(null);
    setAfdeling(null);
    setCostumerName(null);
    setAvailableDepartments([]);
    setIsFullyAuthenticated(false);
    setIsPasswordRecovery(false);
  };

  /**
   * Refreshes the Supabase session (to pick up server-side auth changes —
   * e.g. app_metadata.must_change_password cleared by
   * complete-password-change.mts, which a plain supabase.auth.refreshSession()
   * call doesn't reflect anywhere by itself) and applies the result to
   * session/profile state directly, awaited, before returning. Callers that
   * navigate right after a server-side auth change (SetPasswordPage.tsx)
   * MUST await this rather than calling supabase.auth.refreshSession()
   * themselves and navigating immediately after — that raced against this
   * same update happening asynchronously via the onAuthStateChange listener
   * below, so ProtectedRoute's mustChangePassword check could still see the
   * stale value and redirect straight back to /set-password.
   */
  const refreshProfile = async () => {
    const { data } = await supabase.auth.refreshSession();
    const next = data.session
      ? await loadProfile(data.session.user.id)
      : { profile: null, afdeling: null, costumerName: null, costumerDeactivatedAt: null };
    const departments = data.session ? await loadAvailableDepartments(data.session.user.id, next.profile?.role ?? null) : [];
    setSession(data.session);
    setProfile(next.profile);
    setAfdeling(next.afdeling);
    setCostumerName(next.costumerName);
    setAvailableDepartments(departments);
    setIsFullyAuthenticated(Boolean(data.session));
  };

  /**
   * Switches the user's active department. A FLEETii admin goes through
   * switch-department.mts (a service-role-backed Netlify Function) instead
   * of the direct update below — that function also updates costumer_id to
   * match the target department's own, which a FLEETii admin genuinely
   * needs (they may switch into a department under a completely different
   * costumer) but the direct path below structurally cannot do (its GRANT
   * only ever covers the department_id column — see
   * user_profiles_update_own_department.sql) and which no user_departments
   * grant exists for anyway (a FLEETii admin's grants are intentionally
   * empty — see the "let FLEETii admin operate unscoped" work). A FLEETii
   * admin may also pass departmentId as null — "Alle" (PageHeader.tsx's own
   * pseudo-entry) — which the function treats as "clear back to unscoped"
   * rather than a specific department; every other role keeps updating
   * user_profiles.department_id directly (RLS restricts this to the
   * department_id column and to a value present in the user's own
   * user_departments grants — see user_profiles_update_own_department.sql
   * — so an already-revoked or foreign department_id is rejected
   * server-side, not just skipped client-side; null is never passed on this
   * path since PageHeader never offers "Alle" to a non-FLEETii-admin).
   * Re-loads profile/afdeling/costumerName on success either way, so
   * PageHeader and every afdelingId comparison update immediately.
   */
  const switchDepartment = async (departmentId: string | null): Promise<string | null> => {
    if (!session) return "Ikke logget ind.";

    if (isFleetiiAdmin(profile?.role)) {
      try {
        const response = await fetch("/.netlify/functions/switch-department", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ departmentId }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) return result.error ?? "Kunne ikke skifte afdeling.";
      } catch {
        return "Kunne ikke kontakte serveren. Prøv igen senere.";
      }
    } else {
      if (!departmentId) return "Ugyldig afdeling.";
      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({ department_id: departmentId })
        .eq("user_id", session.user.id);
      if (updateError) return updateError.message;
    }

    const next = await loadProfile(session.user.id);
    setProfile(next.profile);
    setAfdeling(next.afdeling);
    setCostumerName(next.costumerName);
    return null;
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        afdeling,
        afdelingId: profile?.department_id ?? null,
        costumerName,
        costumerId: profile?.costumer_id ?? null,
        availableDepartments,
        switchDepartment,
        isFullyAuthenticated,
        mustChangePassword: session?.user.app_metadata?.must_change_password === true,
        isPasswordRecovery,
        clearPasswordRecovery: () => setIsPasswordRecovery(false),
        deactivationMessage,
        clearDeactivationMessage: () => setDeactivationMessage(null),
        idleTimeoutMessage,
        clearIdleTimeoutMessage: () => setIdleTimeoutMessage(null),
        loading,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Reads the current auth session/profile/role state. Must be called from a component under <AuthProvider> (i.e. anywhere in this app) — throws otherwise. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth skal bruges inden i en AuthProvider");
  return ctx;
}
