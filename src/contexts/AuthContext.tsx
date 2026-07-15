// App-wide authentication/authorization context. Wraps Supabase Auth's
// session with the app's own `profiles` row (name/phone/department/role),
// which is the source of truth for role-based UI (admin vs. regular user)
// and department scoping (Afdeling) used throughout the app. Every page that
// needs to know "who is logged in" or "are they an admin" reads this via
// useAuth() rather than talking to Supabase directly.
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

/** A row from the `profiles` table — the app's own user record, keyed by the Supabase auth.users id. */
export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  department: string | null;
  role: string;
}

/** Shape of the value exposed by useAuth(). */
interface AuthContextValue {
  session: Session | null;
  /** Extra user data (name, phone, department, role) synced from auth.users. */
  profile: Profile | null;
  /** The logged-in user's department (Afdeling). Alias for profile?.department. */
  afdeling: string | null;
  /** true once a valid auth session exists */
  isFullyAuthenticated: boolean;
  /** True if this account was created with the shared default password and hasn't set a real one yet (see create-user.mts/SetPasswordPage.tsx). ProtectedRoute forces such a session to /set-password before anything else. */
  mustChangePassword: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

/** Renders a role string as the Danish label shown in page headers ("Administrator" / "Bruger"). Any non-"admin" value (including null/undefined) is treated as a regular user. */
export function formatRoleLabel(role?: string | null): string {
  return role === "admin" ? "Administrator" : "Bruger";
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Provides the current Supabase session and matching `profiles` row to the
 * whole app. Mount once near the root (see App.tsx) — everything under it
 * can call useAuth() to read session/profile/afdeling/role state.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isFullyAuthenticated, setIsFullyAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  /** Fetches the `profiles` row for the given auth user id. Returns null (and logs) on any Supabase error, so a temporary DB hiccup degrades to "no profile" rather than throwing. */
  const loadProfile = async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, phone, department, role")
      .eq("id", userId)
      .maybeSingle<Profile>();
    if (error) {
      console.error("[AuthContext] profiles select failed:", error);
    }
    return data ?? null;
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
      const nextProfile = newSession ? await loadProfile(newSession.user.id) : null;
      if (!mounted || requestId !== latestRequestId) return;
      setSession(newSession);
      setProfile(nextProfile);
      setIsFullyAuthenticated(Boolean(newSession));
    };

    const initialRequestId = ++latestRequestId;
    supabase.auth.getSession().then(async ({ data }) => {
      await applyAuthState(data.session, initialRequestId);
      if (!mounted) return;
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
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
    setIsFullyAuthenticated(false);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        afdeling: profile?.department ?? null,
        isFullyAuthenticated,
        mustChangePassword: session?.user.app_metadata?.must_change_password === true,
        loading,
        signOut,
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
