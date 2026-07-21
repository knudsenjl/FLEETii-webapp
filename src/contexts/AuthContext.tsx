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

/** A row from the `user_profiles` table — the app's own user record, keyed by the Supabase auth.users id. */
export interface Profile {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  /** References departments.department_id (uuid) — NOT a department name (see supabase/applied/user_profiles_department_to_department_id.sql). Use afdeling (context value, below) for the display name. */
  department_id: string | null;
  role: string;
}

/** Raw shape of a user_profiles row as selected by loadProfile, with the department name embedded via its department_id FK (Supabase/PostgREST resolves the relation automatically) — a single object, not an array, since department_id -> departments is many-to-one. */
type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  department_id: string | null;
  role: string;
  departments: { name: string } | null;
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
  /** true once a valid auth session exists */
  isFullyAuthenticated: boolean;
  /** True if this account was created with the shared default password and hasn't set a real one yet (see create-user.mts/SetPasswordPage.tsx). ProtectedRoute forces such a session to /set-password before anything else. */
  mustChangePassword: boolean;
  /** True once Supabase has fired a PASSWORD_RECOVERY auth event — i.e. the current session came from clicking a "reset password" email link (LoginPage.tsx's resetPasswordForEmail), not a normal sign-in. Supabase auto-signs the user in the moment that link's tokens land in the URL, WITHOUT changing the password — without this flag, ProtectedRoute would just let a password-reset click log someone in with their old password unchanged, defeating the whole point. Cleared via clearPasswordRecovery() once SetPasswordPage.tsx has handled it. */
  isPasswordRecovery: boolean;
  /** Clears isPasswordRecovery — call after SetPasswordPage.tsx successfully sets a new password for a recovery session, before navigating away, so ProtectedRoute stops redirecting back to /set-password. */
  clearPasswordRecovery: () => void;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Refreshes the session and applies it to session/profile state directly (awaited), so it's safe to navigate immediately after — see the implementation's comment for why this exists instead of just calling supabase.auth.refreshSession(). */
  refreshProfile: () => Promise<void>;
}

/** Renders a role string as the Danish label shown in page headers ("FLEETii Administrator" / "Administrator" / "Bruger"). Any value other than "admin"/"FLEETii admin" (including null/undefined) is treated as a regular user. */
export function formatRoleLabel(role?: string | null): string {
  if (role === "FLEETii admin") return "FLEETii Administrator";
  return role === "admin" ? "Administrator" : "Bruger";
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Provides the current Supabase session and matching `user_profiles` row to the
 * whole app. Mount once near the root (see App.tsx) — everything under it
 * can call useAuth() to read session/profile/afdeling/role state.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [afdeling, setAfdeling] = useState<string | null>(null);
  const [isFullyAuthenticated, setIsFullyAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  // Seeded from the URL itself (see supabase.ts's comment) rather than
  // starting false and waiting for supabase-js's PASSWORD_RECOVERY event,
  // which is too late to rely on — that event has already fired (and been
  // missed) by the time this provider's effect below subscribes to it.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(isPasswordRecoveryCallback);

  /** Fetches the `user_profiles` row for the given auth user id, embedding the department's name via the department_id FK in the same query (one round-trip instead of a separate departments lookup). Returns nulls (and logs) on any Supabase error, so a temporary DB hiccup degrades to "no profile" rather than throwing. */
  const loadProfile = async (userId: string): Promise<{ profile: Profile | null; afdeling: string | null }> => {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id, email, full_name, phone, department_id, role, departments(name)")
      .eq("user_id", userId)
      .maybeSingle<ProfileRow>();
    if (error) {
      console.error("[AuthContext] user_profiles select failed:", error);
      return { profile: null, afdeling: null };
    }
    if (!data) {
      return { profile: null, afdeling: null };
    }
    const { departments, ...profileFields } = data;
    return { profile: profileFields, afdeling: departments?.name ?? null };
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
      const next = newSession ? await loadProfile(newSession.user.id) : { profile: null, afdeling: null };
      if (!mounted || requestId !== latestRequestId) return;
      setSession(newSession);
      setProfile(next.profile);
      setAfdeling(next.afdeling);
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

  /** Signs the user out of Supabase and immediately clears local session/profile state (rather than waiting for the onAuthStateChange callback), so the UI reacts instantly. */
  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setAfdeling(null);
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
    const next = data.session ? await loadProfile(data.session.user.id) : { profile: null, afdeling: null };
    setSession(data.session);
    setProfile(next.profile);
    setAfdeling(next.afdeling);
    setIsFullyAuthenticated(Boolean(data.session));
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        afdeling,
        afdelingId: profile?.department_id ?? null,
        isFullyAuthenticated,
        mustChangePassword: session?.user.app_metadata?.must_change_password === true,
        isPasswordRecovery,
        clearPasswordRecovery: () => setIsPasswordRecovery(false),
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
