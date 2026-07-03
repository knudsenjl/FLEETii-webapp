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
  refreshAssuranceLevel: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isFullyAuthenticated, setIsFullyAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshAssuranceLevel = async () => {
    const { data } = await supabase.auth.getSession();
    setIsFullyAuthenticated(Boolean(data.session));
  };

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, full_name, phone, department, role")
      .eq("id", userId)
      .maybeSingle<Profile>();
    setProfile(data ?? null);
  };

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) {
        await refreshAssuranceLevel();
        await loadProfile(data.session.user.id);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        if (newSession) {
          await refreshAssuranceLevel();
          await loadProfile(newSession.user.id);
        } else {
          setIsFullyAuthenticated(false);
          setProfile(null);
        }
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
        refreshAssuranceLevel,
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
