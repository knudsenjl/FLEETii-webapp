// The "sysadm" settings page ("/settings-superadmin" — reached via
// the round settings button in PageHeader.tsx, only for role "FLEETii
// admin"; see SettingsAdminPage.tsx for the department-wide variant, and
// UserDetailsPage.tsx's own personal-settings section — reached via the
// same button, self-view of "/user-details/:ownUserId" — for the personal
// variant every role has). Empty shell for now, same page frame as
// AdminFrontpage/CostumerAdministrationPage, no content yet.
import { PageHeader } from "../components/PageHeader";
import { PageShell } from "../components/PageShell";
import { SectionHeading } from "../components/SectionHeading";

/** Settings page for role "sysadm". */
export function SettingsSuperadminPage() {
  return (
    <PageShell>
      <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-2xl border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <SectionHeading>Indstillinger</SectionHeading>
            <p className="text-sm text-red-600">Denne side er ikke designet endnu.</p>
            <p className="text-sm text-red-600">
              Denne side skal indeholde de indstillinger, der er nødvendige for Robert.
            </p>
          </section>
    </PageShell>
  );
}
