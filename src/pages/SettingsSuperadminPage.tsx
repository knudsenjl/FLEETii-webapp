// The "FLEETii admin" settings page ("/settings-superadmin" — reached via
// the round settings button in PageHeader.tsx, only for role "FLEETii
// admin"; see SettingsAdminPage.tsx/SettingsUserPage.tsx for the other two
// roles' variants). Empty shell for now, same page frame as
// AdminFrontpage/FleetiiAdministrationPage, no content yet.
import { motion } from "framer-motion";
import { PageHeader } from "../components/PageHeader";

/** Settings page for role "FLEETii admin". */
export function SettingsSuperadminPage() {
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

          <section className="flex min-h-0 flex-1 flex-col gap-3 rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">Indstillinger</h2>
            <p className="text-sm text-red-600">Denne side er ikke designet endnu.</p>
            <p className="text-sm text-red-600">
              Denne side skal indeholde de indstillinger, der er nødvendige for Robert.
            </p>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
