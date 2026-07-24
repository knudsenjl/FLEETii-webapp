// The "admin" settings page ("/settings-admin" — reached via the round
// settings button in PageHeader.tsx, for role "admin"; see
// SettingsSuperadminPage.tsx/SettingsUserPage.tsx for the other two roles'
// variants). Manages the admin's own department's "Anvendelse" list, standard
// duration/interval values, and Tillad_* permission flags
// (department_settings) via AnvendelseSettings/StandardSettings/
// RettighederSettings.
import { motion } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { AnvendelseSettings } from "../components/AnvendelseSettings";
import { StandardSettings } from "../components/StandardSettings";
import { RettighederSettings } from "../components/RettighederSettings";

/** Settings page for role "admin". */
export function SettingsAdminPage() {
  const { afdelingId } = useAuth();

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
            <h2 className="text-xl font-semibold text-brand-800">Indstillinger</h2>
            <AnvendelseSettings table="department_settings" scopeColumn="department_id" scopeId={afdelingId} />
            <StandardSettings table="department_settings" scopeColumn="department_id" scopeId={afdelingId} />
            <RettighederSettings table="department_settings" scopeColumn="department_id" scopeId={afdelingId} />
          </section>
        </motion.main>
      </div>
    </div>
  );
}
