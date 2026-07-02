import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

interface AuthContextValue {
  session: Session | null;
  /** true once a valid auth session exists */
  isFullyAuthenticated: boolean;
  loading: boolean;
  refreshAssuranceLevel: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isFullyAuthenticated, setIsFullyAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshAssuranceLevel = async () => {
    const { data } = await supabase.auth.getSession();
    setIsFullyAuthenticated(Boolean(data.session));
  };

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) {
        await refreshAssuranceLevel();
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        if (newSession) {
          await refreshAssuranceLevel();
        } else {
          setIsFullyAuthenticated(false);
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
    setIsFullyAuthenticated(false);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
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
