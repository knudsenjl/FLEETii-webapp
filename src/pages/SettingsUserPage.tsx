// The PERSONAL settings page ("/settings-user" — reached via the round
// settings button in PageHeader.tsx; open to every role, not just "user" —
// an admin/FLEETii admin has their own personal overrides (e.g. their own
// "Login timeout") too, and previously had no way to reach this page at all
// (ProtectedRoute required role==="user" exactly). For role "user" the
// settings button navigates straight here (their only settings page); for
// admin/FLEETii admin it opens a small menu offering this page ALONGSIDE
// their department/FLEETii-wide settings page (SettingsAdminPage.tsx/
// SettingsSuperadminPage.tsx). Manages the logged-in user's own "Anvendelse" override list
// (user_settings) via AnvendelseSettings, and shows (read-only, via
// RettighederSettings' readOnly prop) their own EFFECTIVE Tillad_*
// permission flags — passing departmentId so a flag with no personal
// override displays the department's own value instead of always showing
// unchecked. A user can no longer change their own rights here (business
// decision: only an admin can, via UserDetailsPage) — this view is display-
// only, so they can still see what applies to them. Also manages the user's
// own standard duration/interval override via StandardSettings.
import { motion } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { AnvendelseSettings } from "../components/AnvendelseSettings";
import { StandardSettings } from "../components/StandardSettings";
import { RettighederSettings } from "../components/RettighederSettings";

/** Personal settings page — every role. */
export function SettingsUserPage() {
  const { profile, afdelingId } = useAuth();

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col gap-4 rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">
              Indstillinger for {profile?.full_name ?? profile?.email ?? "—"}
            </h2>
            <AnvendelseSettings
              table="user_settings"
              scopeColumn="user_id"
              scopeId={profile?.user_id ?? null}
              departmentId={afdelingId}
            />
            <StandardSettings table="user_settings" scopeColumn="user_id" scopeId={profile?.user_id ?? null} />
            <RettighederSettings
              table="user_settings"
              scopeColumn="user_id"
              scopeId={profile?.user_id ?? null}
              departmentId={afdelingId}
              heading="Rettigheder for denne bruger"
              readOnly
            />
          </section>
        </motion.main>
      </div>
    </div>
  );
}
