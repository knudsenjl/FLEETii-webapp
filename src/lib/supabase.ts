import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Mangler Supabase-konfiguration. Udfyld VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY i .env-filen.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
