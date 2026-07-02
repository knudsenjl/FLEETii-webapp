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
  getItem: (key: string) => (isRemembered() ? localStorage : sessionStorage).getItem(key),
  setItem: (key: string, value: string) => {
    (isRemembered() ? localStorage : sessionStorage).setItem(key, value);
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: rememberAwareStorage,
  },
});
