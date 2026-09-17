// The "sysadm" settings page ("/settings-superadmin" — reached via
// the round settings button in PageHeader.tsx, only for role "FLEETii
// admin"; see SettingsAdminPage.tsx for the department-wide variant, and
// UserDetailsPage.tsx's own personal-settings section — reached via the
// same button, self-view of "/user-details/:ownUserId" — for the personal
// variant every role has). Empty shell for now, same page frame as
// AdminFrontpage/CostumerAdministrationPage, no content yet.
import { motion } from "framer-motion";
import { PageHeader } from "../components/PageHeader";
import { fadeInUp } from "../lib/motionVariants";

/** Settings page for role "sysadm". */
export function SettingsSuperadminPage() {
  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          {...fadeInUp}
          className="flex min-h-0 flex-1 flex-col"
        >
          <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
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
