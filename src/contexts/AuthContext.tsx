import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  department: string | null;
  role: string;
}

interface AuthContextValue {
  session: Session | null;
  /** Extra user data (name, phone, department, role) synced from auth.users. */
  profile: Profile | null;
  /** true once a valid auth session exists */
  isFullyAuthenticated: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

export function formatRoleLabel(role?: string | null): string {
  return role === "admin" ? "Administrator" : "Bruger";
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isFullyAuthenticated, setIsFullyAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, phone, department, role")
      .eq("id", userId)
      .maybeSingle<Profile>();
    if (error) {
      console.error("[AuthContext] profiles select failed:", error);
    }
    setProfile(data ?? null);
  };

  useEffect(() => {
    let mounted = true;

    // Profile is loaded before isFullyAuthenticated flips to true (and both
    // updates land in the same tick) so route decisions that depend on the
    // user's role never fire on a stale/empty profile — otherwise the app
    // briefly redirects everyone to the default route before correcting
    // itself once the role-based redirect resolves.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) {
        await loadProfile(data.session.user.id);
      }
      if (!mounted) return;
      setIsFullyAuthenticated(Boolean(data.session));
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        if (newSession) {
          await loadProfile(newSession.user.id);
        } else {
          setProfile(null);
        }
        setIsFullyAuthenticated(Boolean(newSession));
      },
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

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
        isFullyAuthenticated,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth skal bruges inden i en AuthProvider");
  return ctx;
}
