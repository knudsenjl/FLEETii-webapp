// The "admin" settings page ("/settings-department" — reached via the round
// settings button in PageHeader.tsx, for role "admin"; see
// SettingsSuperadminPage.tsx/SettingsUserPage.tsx for the other two roles'
// variants). Everything lives in ONE "Indstillinger" table now (per user
// request, merged from what used to be 3 separate sections/tables): standard
// duration/interval/timeout values, the use_user_ident/use_vehicle_ident
// ID-display checkboxes, the Tillad_* permission checkboxes, and — as the
// last row's embedded content — the "Anvendelse" list editor (still its own
// AnvendelseSettings component/table underneath, just relocated into this
// row's value cell instead of its own separate page section). See
// DEPARTMENT_STANDARDER below.
import { useMemo } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { AnvendelseSettings } from "../components/AnvendelseSettings";
import { StandardSettings, STANDARDER, type StandardSetting } from "../components/StandardSettings";
import { RETTIGHEDER } from "../components/RettighederSettings";

/** Settings page for role "admin". */
export function SettingsAdminPage() {
  const { afdeling, afdelingId } = useAuth();

  /** STANDARDER, plus the two "Opsætning af ID'er" checkboxes, plus the 4 Tillad_* permission checkboxes (reusing RettighederSettings.tsx's own RETTIGHEDER label/info text — that component still owns the canonical copy, since UserDetailsPage still uses it directly for its own editable Aktiv/Nulstil/ceiling-check widget), plus a last "Anvendelser" row embedding AnvendelseSettings itself (see StandardSettings.tsx's "custom" inputType). Memoized (not module-scope, unlike the earlier static-only version) since the last row's render() closes over afdelingId — StandardSettings' load effect depends on this array by reference, so an unmemoized inline array would re-trigger a refetch every render. use_user_ident/use_vehicle_ident are seeded (value_bool = false) for every department by supabase/applied/backfill_and_seed_default_ident_settings.sql; the Tillad_* rows rely on "missing row = false" like they always have. Note: use_user_ident/use_vehicle_ident are settings/toggles only for now — nothing in the app yet reads them to actually gate whether Bruger-ID/Køretøj-ID is shown as the primary identifier. */
  const departmentStandarder = useMemo<StandardSetting[]>(
    () => [
      {
        name: "use_user_ident",
        label: "Anvender Bruger-ID",
        inputType: "checkbox",
        defaultValue: "false",
        info: "Brugere kan identificeres med jeres medarbejder nummer eller lign. efter jeres eget valg. Ellers anvendes E-mail som identifikation",
      },
      {
        name: "use_vehicle_ident",
        label: "Anvender Køretøj-ID",
        inputType: "checkbox",
        defaultValue: "false",
        info: "Jeres køretøjer kan identificeres med et køretøjsnummer eller lign. efter jeres eget valg. Ellers anvendes registreringsnummeret på køretøjet som identifikation",
      },
      ...STANDARDER,
      ...RETTIGHEDER.map(
        (r): StandardSetting => ({
          name: r.name,
          label: r.label,
          inputType: "checkbox",
          defaultValue: "false",
          info: r.info,
        }),
      ),
      {
        name: "Anvendelser_row",
        label: "Anvendelser",
        inputType: "custom",
        info: 'Disse anvendelser er tilgængelige for brugerne, som begrundelse for en reservation. Ved at vælge "Andet" kan de angive en anden begrundese',
        render: (labelCell) => (
          <AnvendelseSettings
            labelCell={labelCell}
            table="department_settings"
            scopeColumn="department_id"
            scopeId={afdelingId}
          />
        ),
      },
    ],
    [afdelingId],
  );

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
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

          <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">Indstillinger for {afdeling ?? "—"}</h2>
            <StandardSettings
              table="department_settings"
              scopeColumn="department_id"
              scopeId={afdelingId}
              settings={departmentStandarder}
            />
          </section>
        </motion.main>
      </div>
    </div>
  );
}
