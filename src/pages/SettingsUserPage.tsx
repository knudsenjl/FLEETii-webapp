// The PERSONAL settings page ("/settings-user" — reached via the round
// settings button in PageHeader.tsx; open to every role, not just "user" —
// an admin/FLEETii admin has their own personal overrides (e.g. their own
// "Login timeout") too, and previously had no way to reach this page at all
// (ProtectedRoute required role==="user" exactly). For role "user" the
// settings button navigates straight here (their only settings page); for
// admin/FLEETii admin it opens a small menu offering this page ALONGSIDE
// their department/FLEETii-wide settings page (SettingsAdminPage.tsx/
// SettingsSuperadminPage.tsx). Everything lives in ONE "Indstillinger" table
// now (per user request, merged from what used to be 3 separate
// sections/tables): standard duration/interval/timeout overrides, the 4
// Tillad_* rows as read-only "effective value" checkboxes (falling back to
// the department's own value when this user has no personal override — see
// StandardSettings.tsx's readOnly checkbox handling; a user can no longer
// change their own rights here, business decision — only an admin can, via
// UserDetailsPage, which still uses RettighederSettings directly for its own
// editable widget), and — as the last row's embedded content — the
// "Anvendelse" override list editor (still its own AnvendelseSettings
// component/table underneath, just relocated into this row's value cell).
import { useMemo } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { AnvendelseSettings } from "../components/AnvendelseSettings";
import { StandardSettings, STANDARDER, type StandardSetting } from "../components/StandardSettings";
import { RETTIGHEDER } from "../components/RettighederSettings";

/** Personal settings page — every role. */
export function SettingsUserPage() {
  const { profile, afdelingId } = useAuth();

  /** STANDARDER, plus the 4 Tillad_* rows as read-only "effective value" checkboxes (reuses RettighederSettings.tsx's own RETTIGHEDER label/infoUser text, falling back to info when infoUser isn't set, rather than duplicating it), plus a last "Anvendelser" row embedding AnvendelseSettings itself (see StandardSettings.tsx's "custom" inputType). Memoized (not module-scope, unlike the earlier static-only version) since the last row's render() closes over profile?.user_id/afdelingId — StandardSettings' load effect depends on this array by reference, so an unmemoized inline array would re-trigger a refetch every render. */
  const userStandarder = useMemo<StandardSetting[]>(
    () => [
      ...STANDARDER,
      ...RETTIGHEDER.map(
        (r): StandardSetting => ({
          name: r.name,
          label: r.label,
          inputType: "checkbox",
          defaultValue: "false",
          info: r.infoUser ?? r.info,
          readOnly: true,
        }),
      ),
      {
        name: "Anvendelser_row",
        label: "Anvendelser",
        inputType: "custom",
        info: 'Disse anvendelser er tilgængelige, som begrundelse for en reservation. Ved at vælge "Andet" kan du angive en anden begrundese',
        render: (labelCell) => (
          <AnvendelseSettings
            labelCell={labelCell}
            table="user_settings"
            scopeColumn="user_id"
            scopeId={profile?.user_id ?? null}
            departmentId={afdelingId}
          />
        ),
      },
    ],
    [profile?.user_id, afdelingId],
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
            <h2 className="text-xl font-semibold text-brand-800">
              Indstillinger for {profile?.full_name ?? profile?.email ?? "—"}
            </h2>
            <StandardSettings
              table="user_settings"
              scopeColumn="user_id"
              scopeId={profile?.user_id ?? null}
              settings={userStandarder}
              departmentId={afdelingId}
            />
          </section>
        </motion.main>
      </div>
    </div>
  );
}
