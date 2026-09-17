// The per-department settings page ("/department-settings" — reached via the
// round settings button in PageHeader.tsx for role "admin", or via
// DepartmentDetailsPage.tsx's own "Indstillinger" button for either role
// (route relaxed from requireRole="admin" to requireAdmin 2026-09-14, so
// sysadm can reach it too now — purely driven by afdelingId from context
// below, no role branching in this file itself, and every department_
// settings/departments write here already allowed sysadm via
// is_fleetii_admin()/"any costumer" RLS bypasses predating this change).
// PageHeader's own gear-menu item ("Afdelingsindstillinger") stays admin-only
// though — sysadm's gear menu still points at "/settings-superadmin"
// (settingsMenuItemsForRole in PageHeader.tsx, deliberately untouched); see
// SettingsSuperadminPage.tsx for that sysadm-only platform-wide variant, and
// UserDetailsPage.tsx's own personal-settings section — reached via the
// same button, self-view of "/user-details/:ownUserId" — for the personal
// variant every role has, retired from a standalone "/settings-user" page).
// Three separate tables (per user request, split back out of the single
// merged table an earlier request had combined them into): "Afdelingsoplysninger"
// (Navn/Adresse — plain columns on the departments row itself, not a
// department_settings row — plus the two use_user_ident/use_vehicle_ident
// ID-display checkboxes, hand-rolled below rather than routed through
// StandardSettings since Navn/Adresse live on a different table entirely)
// shown FIRST, then RettighederSettings (the 4 Tillad_* permission
// checkboxes, own "Tilladelser" header row, same component UserDetailsPage
// uses for its own Tillad_* sections), then a "Indstillinger"
// StandardSettings table (standard duration/interval/timeout values, and —
// as the last row's embedded content — the "Anvendelse" list editor, still
// its own AnvendelseSettings component/table underneath, just relocated
// into this row's value cell instead of its own separate page section)
// shown LAST. All three run in deferSave mode, sharing ONE "Opdater"/
// "Fortryd" pair — same functionality as UserDetailsPage's own self-view
// section: StandardSettings renders that pair itself (see its own deferSave
// doc comment), right after the Indstillinger table, which is already last
// on the page; RettighederSettings' own dirtiness/save/revert, and this
// page's own Afdelingsoplysninger draft, both feed into it via
// onExtraCommit/onExtraRevert/extraDirty, exactly like UserDetailsPage
// wires its embedded AnvendelseSettings into that same mechanism. See
// indstillingerSettings and the Afdelingsoplysninger state below.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { FieldInfoButton } from "../components/FieldInfoButton";
import { SettingsRow } from "../components/SettingsRow";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import { AnvendelseSettings } from "../components/AnvendelseSettings";
import { StandardSettings, STANDARDER, type StandardSetting } from "../components/StandardSettings";
import { RettighederSettings, type RettighederSettingsHandle } from "../components/RettighederSettings";
import { invalidateIdentSettingsCache } from "../hooks/useIdentSettings";
import { supabase } from "../lib/supabase";

/** Raw shape of the two use_*_ident rows as selected in the Afdelingsoplysninger fetch below. */
type IdentRow = { name: string; value_bool: boolean | null };

/** Settings page for role "admin". */
export function SettingsAdminPage() {
  const { afdelingId } = useAuth();
  /** RettighederSettings' own exposed save()/revert() (see RettighederSettings.tsx's forwardRef) — wired into StandardSettings' onExtraCommit/onExtraRevert below so ONE "Opdater"/"Fortryd" governs every table together, rather than Tilladelser saving each toggle immediately regardless. */
  const rettighederRef = useRef<RettighederSettingsHandle>(null);
  /** Mirrors RettighederSettings' own dirty/clean state (via its onDirtyChange prop) so StandardSettings' Opdater/Fortryd pair knows to stay enabled even when its OWN rows (Standard varighed/interval/Login timeout/Anvendelser) have nothing pending but Tilladelser (or Afdelingsoplysninger, below) does. */
  const [rettighederDirty, setRettighederDirty] = useState(false);

  // Afdelingsoplysninger's own draft state — Navn/Adresse (departments.name/
  // address, a different table entirely from department_settings) alongside
  // the two use_user_ident/use_vehicle_ident checkboxes (department_settings
  // rows, same table StandardSettings/RettighederSettings below use, just
  // not routed through StandardSettings itself — two plain checkboxes don't
  // need that component's own ceiling/fallback machinery). Hand-rolled
  // rather than a third StandardSettings instance so this page's single
  // shared Opdater/Fortryd pair (rendered by the LAST StandardSettings
  // instance, below) can stay the only commit surface on the page, exactly
  // like RettighederSettings already plugs into it.
  const [deptName, setDeptName] = useState("");
  const [deptAddress, setDeptAddress] = useState("");
  const [savedDeptName, setSavedDeptName] = useState("");
  const [savedDeptAddress, setSavedDeptAddress] = useState("");
  const [useUserIdent, setUseUserIdent] = useState(false);
  const [useVehicleIdent, setUseVehicleIdent] = useState(false);
  const [savedUseUserIdent, setSavedUseUserIdent] = useState(false);
  const [savedUseVehicleIdent, setSavedUseVehicleIdent] = useState(false);
  const [afdelingsoplysningerLoading, setAfdelingsoplysningerLoading] = useState(true);
  const [afdelingsoplysningerError, setAfdelingsoplysningerError] = useState<string | null>(null);
  /** Which (if any) of the two ID-checkbox "?" info popovers is open — same plain-toggle pattern as StandardSettings.tsx's own openInfoName. */
  const [openInfoName, setOpenInfoName] = useState<string | null>(null);

  useEffect(() => {
    if (!afdelingId) {
      setAfdelingsoplysningerLoading(false);
      return;
    }

    let cancelled = false;
    setAfdelingsoplysningerLoading(true);
    setAfdelingsoplysningerError(null);

    const deptFetch = supabase
      .from("departments")
      .select("name, address")
      .eq("department_id", afdelingId)
      .maybeSingle<{ name: string | null; address: string | null }>();
    const identFetch = supabase
      .from("department_settings")
      .select("name, value_bool")
      .in("name", ["use_user_ident", "use_vehicle_ident"])
      .eq("department_id", afdelingId)
      .returns<IdentRow[]>();

    void Promise.all([deptFetch, identFetch]).then(([deptResult, identResult]) => {
      if (cancelled) return;
      if (deptResult.error) {
        setAfdelingsoplysningerError(deptResult.error.message);
        setAfdelingsoplysningerLoading(false);
        return;
      }
      if (identResult.error) {
        setAfdelingsoplysningerError(identResult.error.message);
        setAfdelingsoplysningerLoading(false);
        return;
      }

      const name = deptResult.data?.name ?? "";
      const address = deptResult.data?.address ?? "";
      setDeptName(name);
      setDeptAddress(address);
      setSavedDeptName(name);
      setSavedDeptAddress(address);

      const identMap = Object.fromEntries((identResult.data ?? []).map((row) => [row.name, row.value_bool === true]));
      const userIdent = identMap.use_user_ident ?? false;
      const vehicleIdent = identMap.use_vehicle_ident ?? false;
      setUseUserIdent(userIdent);
      setUseVehicleIdent(vehicleIdent);
      setSavedUseUserIdent(userIdent);
      setSavedUseVehicleIdent(vehicleIdent);

      setAfdelingsoplysningerLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [afdelingId]);

  const afdelingsoplysningerDirty =
    deptName !== savedDeptName ||
    deptAddress !== savedDeptAddress ||
    useUserIdent !== savedUseUserIdent ||
    useVehicleIdent !== savedUseVehicleIdent;

  /** Writes whatever's changed in Afdelingsoplysninger — Navn/Adresse (departments row) and/or the two ID checkboxes (department_settings rows) — called from the shared Opdater button below (via onExtraCommit). Each half only writes if IT changed, same "only touch what's dirty" approach StandardSettings.tsx's own handleUpdateAll uses. */
  const commitAfdelingsoplysninger = async (): Promise<{ error: string | null }> => {
    if (!afdelingId) return { error: null };

    if (deptName !== savedDeptName || deptAddress !== savedDeptAddress) {
      const trimmedName = deptName.trim();
      if (!trimmedName) return { error: "Navn skal udfyldes." };
      const trimmedAddress = deptAddress.trim() || null;

      const { error } = await supabase
        .from("departments")
        .update({ name: trimmedName, address: trimmedAddress })
        .eq("department_id", afdelingId);
      if (error) return { error: error.message };

      setDeptName(trimmedName);
      setDeptAddress(trimmedAddress ?? "");
      setSavedDeptName(trimmedName);
      setSavedDeptAddress(trimmedAddress ?? "");
    }

    if (useUserIdent !== savedUseUserIdent || useVehicleIdent !== savedUseVehicleIdent) {
      const { error } = await supabase.from("department_settings").upsert(
        [
          { name: "use_user_ident", value_bool: useUserIdent, department_id: afdelingId },
          { name: "use_vehicle_ident", value_bool: useVehicleIdent, department_id: afdelingId },
        ],
        { onConflict: "name,department_id" },
      );
      if (error) return { error: error.message };

      invalidateIdentSettingsCache(afdelingId);
      setSavedUseUserIdent(useUserIdent);
      setSavedUseVehicleIdent(useVehicleIdent);
    }

    return { error: null };
  };

  /** Discards Afdelingsoplysninger's own unsaved draft, reverting to the last-loaded/saved snapshot — the read-side counterpart to commitAfdelingsoplysninger, called from the shared Fortryd button below. */
  const revertAfdelingsoplysninger = () => {
    setDeptName(savedDeptName);
    setDeptAddress(savedDeptAddress);
    setUseUserIdent(savedUseUserIdent);
    setUseVehicleIdent(savedUseVehicleIdent);
  };

  /** A leading "Indstillinger" subheader row (plain full-width label, no value cell — see the "custom" inputType's own doc comment), then STANDARDER's duration/interval/timeout rows, then a trailing "Anvendelser" row embedding AnvendelseSettings itself (see StandardSettings.tsx's "custom" inputType). The 4 Tillad_* permission checkboxes and the Navn/Adresse/ID-checkbox fields live in their own separate tables instead (rendered above this one, see the JSX below) — no longer merged in here. Memoized since the last row's render() closes over afdelingId — StandardSettings' load effect depends on this array by reference, so an unmemoized inline array would re-trigger a refetch every render. */
  const indstillingerSettings = useMemo<StandardSetting[]>(
    () => [
      {
        name: "Indstillinger_header",
        label: "Indstillinger",
        inputType: "custom",
        render: () => (
          // rounded-t-2xl matches StandardSettings.tsx's own outer wrapper
          // rounding — this row's own distinct background would otherwise
          // show square corners poking past the wrapper's rounded top edge,
          // since it's the FIRST row and that wrapper isn't overflow-hidden
          // (see its own doc comment on why). Plain div, not <tr>/<td> —
          // StandardSettings' rows are div-based now (2026-09-14 unification,
          // see its own doc comment), so a leftover table-cell here rendered
          // as an orphan table-cell display box with no real <table> to size
          // itself against, silently losing its background bar (fixed
          // 2026-09-14: confirmed via a real screenshot next to the
          // Afdelingsoplysninger/Tilladelser headers, which use this same div
          // convention and looked correctly grey).
          <SettingsSectionHeading>Indstillinger</SettingsSectionHeading>
        ),
      },
      ...STANDARDER,
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
            {/* Afdelingsoplysninger — same rounded-2xl/bg-white + header-bar
                convention as the tables below, hand-rolled since Navn/Adresse
                (departments.name/address) don't fit StandardSettings' own
                single table/scopeId model, which the two ID checkboxes here
                are ALSO scoped to (department_settings) but rendered by hand
                too, to keep this whole table's draft/commit/revert in one
                place. */}
            <div className="rounded-2xl border border-brand-100 bg-white">
              <div className="divide-y divide-brand-100 rounded-2xl">
                <SettingsSectionHeading>Afdelingsoplysninger</SettingsSectionHeading>
                {afdelingsoplysningerLoading && (
                  <div className="px-2 py-3 text-center text-sm text-brand-500">Indlæser…</div>
                )}
                {!afdelingsoplysningerLoading && afdelingsoplysningerError && (
                  <div className="px-2 py-3 text-center text-sm text-red-600">{afdelingsoplysningerError}</div>
                )}
                {!afdelingsoplysningerLoading && !afdelingsoplysningerError && (
                  <>
                    <RequiredFieldRow
                      label="Navn:"
                      value={deptName}
                      onChange={setDeptName}
                      className="grid grid-cols-[14rem_1fr] items-center gap-2 px-2 py-0.5"
                    />
                    <SettingsRow>
                      <label className="text-sm font-medium text-brand-700">Adresse:</label>
                      <input
                        type="text"
                        value={deptAddress}
                        onChange={(e) => setDeptAddress(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </SettingsRow>
                    {(
                      [
                        {
                          name: "use_user_ident",
                          label: "Anvender Bruger-ID",
                          checked: useUserIdent,
                          onToggle: setUseUserIdent,
                          info: "Brugere kan identificeres med jeres medarbejder nummer eller lign. efter jeres eget valg. Ellers anvendes E-mail som identifikation",
                        },
                        {
                          name: "use_vehicle_ident",
                          label: "Anvender Køretøj-ID",
                          checked: useVehicleIdent,
                          onToggle: setUseVehicleIdent,
                          info: "Jeres køretøjer kan identificeres med et køretøjsnummer eller lign. efter jeres eget valg. Ellers anvendes registreringsnummeret på køretøjet som identifikation",
                        },
                      ] as const
                    ).map((row) => (
                      <SettingsRow key={row.name}>
                        <div className="relative flex items-center justify-between gap-1">
                          <label htmlFor={`afdelingsoplysning-${row.name}`} className="text-sm font-medium text-brand-700">
                            {row.label}:
                          </label>
                          <FieldInfoButton
                            open={openInfoName === row.name}
                            onToggle={() => setOpenInfoName((prev) => (prev === row.name ? null : row.name))}
                            message={row.info}
                          />
                        </div>
                        <input
                          id={`afdelingsoplysning-${row.name}`}
                          type="checkbox"
                          checked={row.checked}
                          onChange={(e) => row.onToggle(e.target.checked)}
                          className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500"
                        />
                      </SettingsRow>
                    ))}
                  </>
                )}
              </div>
            </div>

            <RettighederSettings
              ref={rettighederRef}
              table="department_settings"
              scopeColumn="department_id"
              scopeId={afdelingId}
              deferSave
              onDirtyChange={setRettighederDirty}
            />
            <StandardSettings
              table="department_settings"
              scopeColumn="department_id"
              scopeId={afdelingId}
              settings={indstillingerSettings}
              deferSave
              extraDirty={rettighederDirty || afdelingsoplysningerDirty}
              onExtraCommit={async () => {
                const deptResult = await commitAfdelingsoplysninger();
                if (deptResult.error) return deptResult;
                return (await rettighederRef.current?.save()) ?? { error: null };
              }}
              onExtraRevert={() => {
                revertAfdelingsoplysninger();
                rettighederRef.current?.revert();
              }}
            />
          </section>
        </motion.main>
      </div>
    </div>
  );
}
