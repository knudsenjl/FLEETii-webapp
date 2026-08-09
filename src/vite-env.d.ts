/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** AboutPage.tsx's "Brugerguide" button + create-user.mts's welcome-email link — optional, button/email line omitted when unset. */
  readonly VITE_BRUGERMANUAL_URL?: string;
  /** AboutPage.tsx's "Administratormanual" button — optional, button omitted when unset. */
  readonly VITE_ADMINMANUAL_URL?: string;
  /** AboutPage.tsx's "FLEETii-administratormanual" button — optional, button omitted when unset. */
  readonly VITE_FLEETIIMANUAL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
