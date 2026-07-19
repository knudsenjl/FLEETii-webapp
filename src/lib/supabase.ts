// The app's single Supabase client instance (anon key — safe to ship in the
// browser bundle; server-privileged work happens in netlify/functions/ with
// the service-role key instead). Also implements the "remember me" storage
// behavior: the session is kept in localStorage (survives browser restarts)
// when the user opted in, or sessionStorage (cleared when the tab closes)
// otherwise.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Mangler Supabase-konfiguration. Udfyld VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY i .env-filen.",
  );
}

// Captured HERE, synchronously, before createClient() below even runs — not
// derived from supabase-js's own PASSWORD_RECOVERY auth event. That event
// is racy: createClient()'s constructor kicks off its own async URL-token
// processing (default flowType is "implicit", so a password-reset email's
// tokens land in the URL hash as "#access_token=...&type=recovery"), which
// typically finishes — parsing AND stripping the hash via
// history.replaceState — before AuthContext.tsx's useEffect gets a chance
// to subscribe via onAuthStateChange, so the event fires into an empty
// listener list and is silently lost. Reading the raw hash right now, at
// module load, is synchronous and therefore race-free: nothing async can
// have touched the URL yet.
export const isPasswordRecoveryCallback =
  typeof window !== "undefined" && window.location.hash.includes("type=recovery");

const REMEMBER_ME_KEY = "fleetii_remember_me";

/** Persists the user's "remember me" choice (called from LoginPage before signing in), which rememberAwareStorage below reads to decide where to keep the session. Silently no-ops if storage is unavailable. */
export function setRememberMe(remember: boolean) {
  try {
    localStorage.setItem(REMEMBER_ME_KEY, remember ? "true" : "false");
  } catch (_) {
    /* ignore storage errors */
  }
}

/** Whether the current login should be remembered (localStorage) rather than session-only (sessionStorage). Defaults to true (remembered) if the flag was never set or storage is unavailable. */
function isRemembered(): boolean {
  try {
    return localStorage.getItem(REMEMBER_ME_KEY) !== "false";
  } catch (_) {
    return true;
  }
}

// Keeps the session in localStorage (survives browser restarts) when "remember me" is
// on, otherwise falls back to sessionStorage so the session disappears when the tab closes.
const rememberAwareStorage = {
  getItem: (key: string) => {
    try {
      return (isRemembered() ? localStorage : sessionStorage).getItem(key);
    } catch (_) {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    // Clear the other storage's copy of this key too — otherwise a token
    // written to localStorage during a "remembered" login lingers there
    // indefinitely once a later login on the same machine opts out of
    // "remember me" and starts writing to sessionStorage instead.
    try {
      if (isRemembered()) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    } catch (_) {
      /* ignore storage errors */
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch (_) {
      /* ignore storage errors */
    }
  },
};

/** The shared Supabase client used everywhere in the app (auth, `user_profiles`, `bookings`). Import this rather than calling createClient() again elsewhere. */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: rememberAwareStorage,
  },
});
