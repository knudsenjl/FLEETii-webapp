import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Mangler Supabase-konfiguration. Udfyld VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY i .env-filen.",
  );
}

const REMEMBER_ME_KEY = "fleetii_remember_me";

export function setRememberMe(remember: boolean) {
  try {
    localStorage.setItem(REMEMBER_ME_KEY, remember ? "true" : "false");
  } catch (_) {
    /* ignore storage errors */
  }
}

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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: rememberAwareStorage,
  },
});
