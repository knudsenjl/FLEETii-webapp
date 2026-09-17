import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { isAnyAdmin, isDepartmentAdmin, isSysadm as isSysadmRole } from "../lib/roles";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { PageLoading } from "../components/PageLoading";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InlinePopup } from "../components/InlinePopup";
import { FieldInfoButton } from "../components/FieldInfoButton";
import { PageShell } from "../components/PageShell";
import { SettingsRow } from "../components/SettingsRow";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import { ForbiddenNotice } from "../components/ProtectedRoute";
import { RettighederSettings, type RettighederSettingsHandle } from "../components/RettighederSettings";
import { StandardSettings, STANDARDER, type StandardSetting } from "../components/StandardSettings";
import { AnvendelseSettings, type AnvendelseSettingsHandle } from "../components/AnvendelseSettings";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";
import { fetchDepartmentOptions, type DepartmentOption } from "../lib/departments";
import { EMAIL_PATTERN, PHONE_PATTERN } from "../lib/validation";

/** A row from the `user_profiles` table. When reached with one pre-filled via router state (clicking a row on DepartmentPage), the form edits it (see UserDetailsPage's own doc comment below for how). */
type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  /** Company-wide "Bruger-ID" identifier (see supabase/applied/user_profiles_add_user_ident.sql) — optional, shown/edited separately from E-mail. */
  user_ident: string | null;
  department_name: string | null;
  /** This user's own home department/costumer (user_profiles.department_id/costumer_id) — used to scope the departments-loading effect and the isLastAdmin pre-check to the EDITED user's own costumer/department rather than the viewing admin's, so a sysadm (no costumer of their own) can still edit a user belonging to any costumer. */
  department_id: string | null;
  costumer_id: string | null;
  role: string;
  /** Set once "Bloker brugers adgang" (delete-user.mts) has been used, cleared by "Genetabler brugers adgang" (unblock-user.mts) — see UserDetailsPage's own doc comment for why blocking is reversible rather than a true delete. */
  deleted_at: string | null;
};

/**
 * Admin "create/edit user" form. Validates every field is
 * filled and that the email isn't already taken (debounced live check
 * against `user_profiles`, ignoring the user's own row when editing) before
 * enabling "Opret bruger"/"Opdater bruger", which call the create-user/
 * update-user Netlify Functions respectively (authenticated with the
 * current session). When reached with an existing user (via DepartmentPage),
 * also shows "Arkiver bruger", which calls the delete-user Netlify Function
 * to ARCHIVE the account — bans their Supabase Auth login (so they can no
 * longer log in at all) and marks `user_profiles.deleted_at` rather than
 * deleting the row, so their booking history keeps resolving their name/
 * email exactly as before (see delete-user.mts's header for the full
 * reasoning, including why this needs the service-role key and can't be a
 * direct client-side action).
 *
 * Whenever the LOGGED-IN admin's own role (profile.role, not the role
 * being assigned to whichever user this form is creating/editing) is
 * "admin" or "sysadm" — i.e. whenever this route's own requireAdmin
 * guard (see App.tsx's ProtectedRoute) let them in at all — the Afdelinger
 * checkbox table (mirroring HandleVehiclePage.tsx's Afdeling(er)/
 * vehicle_departments pattern) is shown, for both the "Ny bruger" creation
 * form and editing an existing user, so the admin can grant departments
 * beyond the one home department. "Hjemmeafdeling" (once there's a real
 * choice — 2+ departments) is a select filtered to just userDepartmentIds
 * (staged locally pre-creation, loaded from user_departments when editing)
 * rather than every department in the costumer — you check a department
 * "Tilhører" in Afdelinger first, then it becomes choosable as Hjemmeafdeling,
 * same ordering as every other Afdeling(er)/Hjemmeafdeling pair in this
 * project. Its own Hjemmeafdeling is self-healed into userDepartmentIds
 * regardless, so create-user.mts's own historical gap (never seeding
 * user_departments at all) gets closed for every new user: on successful
 * creation, whatever's in userDepartmentIds (at least the chosen home
 * department, thanks to that self-heal) is inserted for the new user_id.
 *
 * A sysadm has no costumerId of their own, so creating a brand-new
 * user (never editing an existing one — see targetCostumerId) reads its
 * target costumer straight from the global header's own costumerId/
 * costumerName ("Data Filter", PageHeader.tsx): a read-only "Kunde" row
 * shows which one, and reaching the create form with the header fully
 * unscoped ("Alle") redirects to "/admin" instead. Nothing else on the page
 * (the Afdeling(er)/Hjemmeafdeling options) can load until targetCostumerId
 * is resolved.
 *
 * Reachable at plain "/user-details" (create — no user, matches App.tsx's
 * route with no :userId) or "/user-details/:userId" (edit). Normally reached
 * with the user pre-filled via router state (DepartmentPage's row click),
 * which skips a round-trip; a direct URL/refresh/bookmark to the :userId
 * route (no router state) falls back to fetching it by id instead,
 * redirecting to "/department" if it can't be found (deleted, archived, or
 * outside the admin's own department per RLS) — since that case was clearly
 * meant to be an edit, not silently falling into the create form.
 *
 * Also doubles as the personal-settings page for EVERY role (retiring the
 * old standalone "/settings-user" — see App.tsx's SettingsUserRedirect):
 * ":userId" matching the viewer's own profile.user_id (isSelf below) is
 * allowed past this route's own ProtectedRoute (which, unlike every other
 * admin-only route here, has no requireAdmin — see App.tsx), and renders
 * every profile field read-only (a user views but never edits their own
 * Navn/E-mail/Telefon/Rolle/Afdeling(er)/Hjemmeafdeling from here — that
 * still requires an admin) alongside a fully-editable Standard settings/
 * Anvendelser/Rettigheder section further down. A plain "user" requesting
 * someone ELSE's :userId (isSelf false, isAnyAdmin(profile?.role) also
 * false) gets ForbiddenNotice instead — this component's own check, since
 * ProtectedRoute can't express "admin OR your own row". An admin/sysadm
 * viewing someone else keeps the full edit form as before, PLUS a new
 * view-only rendering of that user's own Standard settings/Anvendelser
 * (see the readOnly StandardSettings instance below) — a capability admins
 * didn't have before this unification.
 */
export function UserDetailsPage() {
  const { session, profile, costumerId, costumerName, afdelingId, afdeling, availableDepartments } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { userId } = useParams<{ userId: string }>();
  /** True when the requested :userId is the logged-in viewer's own row — the self-view/personal-settings case (see this component's own doc comment). */
  const isSelf = Boolean(userId) && userId === profile?.user_id;
  /** A plain "user" (or any non-admin role) requesting someone ELSE's :userId — never allowed, since ProtectedRoute's own check (App.tsx) can't express "admin OR your own row" and had to be loosened to let self-view through at all. Rendered as ForbiddenNotice further down, once past the hooks section. */
  const forbiddenOtherUser = Boolean(userId) && !isSelf && !isAnyAdmin(profile?.role);
  const navState = location.state as { user?: ProfileRow } | null;
  const stateUser = navState?.user ?? null;
  const [fetchedUser, setFetchedUser] = useState<ProfileRow | null>(null);
  /** Starts true whenever a fetch-by-id will actually run (userId present, no stateUser) — NOT just false-by-default. The redirect-on-missing-user effect below and this page's own fetch effect both run in the SAME passive-effects pass on mount; if this started false, the redirect effect would see the pre-fetch "not loading, no user" state and bounce to /department before the fetch's setUserLoading(true) had any chance to take effect for that pass. Every existing caller (DepartmentPage) masked this by always passing router state, so `user` was already truthy and the redirect's `!user` check short-circuited — this only surfaces for a caller that navigates here by id alone (e.g. BookingDetailsPage's "Bruger" link, or a raw bookmark/refresh). */
  const [userLoading, setUserLoading] = useState(() => Boolean(userId) && !stateUser && !isSelf);
  /** Self-view's own "row" — built straight from AuthContext's own profile/afdeling/afdelingId rather than fetched, so self-view never needs a round-trip (and works even where user_profiles' SELECT RLS might otherwise be scoped away from the viewer's own admin-facing query shape). Takes priority over stateUser/fetchedUser whenever isSelf. Memoized on the underlying primitive fields (NOT just `isSelf && profile`) — every effect below keyed on `[user]` (grants loading, isLastAdmin, …) re-runs whenever this reference changes, so a fresh object literal every render here would re-trigger every one of them on every render, forever (grantsLoading flips true→false in a loop, which is exactly the Afdeling(er) "Indlæser…" flicker this used to cause). */
  const selfAsProfileRow: ProfileRow | null = useMemo(
    () =>
      isSelf && profile
        ? {
            user_id: profile.user_id,
            email: profile.email,
            full_name: profile.full_name,
            phone: profile.phone,
            user_ident: profile.user_ident,
            department_name: afdeling,
            department_id: afdelingId,
            costumer_id: profile.costumer_id,
            role: profile.role,
            deleted_at: null,
          }
        : null,
    [
      isSelf,
      profile?.user_id,
      profile?.email,
      profile?.full_name,
      profile?.phone,
      profile?.user_ident,
      profile?.costumer_id,
      profile?.role,
      afdeling,
      afdelingId,
    ],
  );
  const user = selfAsProfileRow ?? stateUser ?? fetchedUser;

  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  /** Company-wide "Bruger-ID" identifier — optional (unlike name/email/phone, not required to save). */
  const [userIdent, setUserIdent] = useState(user?.user_ident ?? "");
  // No default department when there's a real choice to make (2+ options) —
  // the admin must explicitly pick one from the dropdown. Auto-filled (and
  // locked, see the departmentOptions effect below) only when their costumer
  // has exactly one department, since there's no actual choice then.
  const [department, setDepartment] = useState(user?.department_name ?? "");
  const [role, setRole] = useState(user?.role ?? "user");

  const [emailExists, setEmailExists] = useState<boolean | null>(null);
  const [pendingAction, setPendingAction] = useState<"create" | "update" | "close" | "delete" | "reactivate" | null>(
    null,
  );
  const rettighederRef = useRef<RettighederSettingsHandle>(null);
  /** Self-view only: the embedded Anvendelser list's own exposed save()/revert() (see AnvendelseSettings.tsx's forwardRef) — wired into StandardSettings' onExtraCommit/onExtraRevert below so ONE "Opdater"/"Fortryd" governs both the Standard settings table and the Anvendelser list together, rather than Anvendelser saving each edit immediately regardless. */
  const anvendelseRef = useRef<AnvendelseSettingsHandle>(null);
  /** Mirrors AnvendelseSettings' own dirty/clean state (via its onDirtyChange prop) so StandardSettings' Opdater/Fortryd pair knows to stay enabled even when its OWN rows (Standard varighed/interval/Login timeout) have nothing pending but the Anvendelser list does. */
  const [anvendelseDirty, setAnvendelseDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [isLastAdmin, setIsLastAdmin] = useState(false);
  const { activeKey: warningKey, trigger: triggerWarning } = useTimedFlag();
  /** Which (if either) of the Afdeling(er)/Hjemmeafdeling "?" info popovers is open — plain toggle state, not useTimedFlag, since these should stay open for as long as the admin needs to read them rather than auto-closing after a few seconds. Closes on toggling the same one again, opening the other, or clicking anywhere outside (see the fixed inset-0 overlay rendered alongside each). */
  const [openInfoPopover, setOpenInfoPopover] = useState<"afdelinger" | "hjemmeafdeling" | null>(null);

  /** Fetch-by-id fallback for a direct URL/refresh/bookmark to "/user-details/:userId" (no router state) — skipped entirely when stateUser is already present. Includes blocked users (deleted_at set) — unlike DepartmentPage's own list, this page needs to reach them so "Genetabler brugers adgang" is reachable — and is naturally scoped to the admin's own department (or any, for a sysadm) by user_profiles' SELECT RLS policy — a userId outside it just resolves to null, same as "not found". */
  useEffect(() => {
    if (stateUser || !userId || isSelf || forbiddenOtherUser) return;

    let cancelled = false;
    setUserLoading(true);
    void supabase
      .from("user_profiles")
      .select(
        "user_id, email, full_name, phone, user_ident, department_id, costumer_id, role, deleted_at, departments!user_profiles_department_id_fkey(name)",
      )
      .eq("user_id", userId)
      .maybeSingle<{
        user_id: string;
        email: string | null;
        full_name: string | null;
        phone: string | null;
        user_ident: string | null;
        department_id: string | null;
        costumer_id: string | null;
        role: string;
        deleted_at: string | null;
        departments: { name: string } | null;
      }>()
      .then(({ data }) => {
        if (cancelled) return;
        setFetchedUser(
          data
            ? {
                user_id: data.user_id,
                email: data.email,
                full_name: data.full_name,
                phone: data.phone,
                user_ident: data.user_ident,
                department_name: data.departments?.name ?? null,
                department_id: data.department_id,
                costumer_id: data.costumer_id,
                role: data.role,
                deleted_at: data.deleted_at,
              }
            : null,
        );
        setUserLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, stateUser, isSelf, forbiddenOtherUser]);

  // Populates the form fields once `user` resolves asynchronously (the
  // fetch-by-id path above) — the useState initializers just above only run
  // on the very first render, which happens before that fetch can possibly
  // have completed, so without this the fields would stay stuck blank even
  // once fetchedUser arrives. Harmless no-op re-set on the (more common)
  // router-state path, where `user` is already correct on the first render.
  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name ?? "");
    setEmail(user.email ?? "");
    setPhone(user.phone ?? "");
    setUserIdent(user.user_ident ?? "");
    setDepartment(user.department_name ?? "");
    setRole(user.role ?? "user");
  }, [user]);

  // Redirects back to the department list if a SPECIFIC user was requested
  // (a :userId in the URL) but couldn't be loaded (deleted, archived, or
  // outside the admin's own department) — mirrors BookingDetailsPage/
  // VehicleDetailsPage's same redirect-on-missing-data pattern. Never fires
  // for the plain "/user-details" create route, which has no userId at all,
  // nor for forbiddenOtherUser (that case renders ForbiddenNotice instead —
  // a plain "user" requesting someone else's row was never going to resolve
  // via this fetch regardless, so there's nothing "missing" to redirect on).
  useEffect(() => {
    if (userId && !user && !userLoading && !forbiddenOtherUser) {
      navigate("/department", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, user, userLoading, forbiddenOtherUser, navigate]);

  /** This user's own Afdelinger grants (user_departments) — only loaded/relevant when editing an existing user (see the fetch effect below). */
  const [userDepartmentIds, setUserDepartmentIds] = useState<Set<string>>(new Set());
  /** The DB's own current user_departments rows, at load time — diffed against userDepartmentIds on save, same pattern as HandleVehiclePage.tsx's vehicle_departments reconciliation. */
  const [originalUserDepartmentIds, setOriginalUserDepartmentIds] = useState<Set<string>>(new Set());
  const [grantsLoading, setGrantsLoading] = useState(true);
  const [grantsError, setGrantsError] = useState<string | null>(null);

  /** A sysadm has no costumerId of their own (platform-wide role) — for a brand-new user, targetCostumerId below just follows the global header's own costumerId (useAuth() — see "Data Filter", PageHeader.tsx), never an in-page picker. Not shown/needed when editing an existing user (their own costumer_id, fetched above, is authoritative), nor for a regular admin (always their own costumerId). */
  const isSysadm = isSysadmRole(profile?.role);
  /** The costumer departmentOptions (and thus the whole Afdeling(er)/Hjemmeafdeling picker) is scoped to — the edited user's OWN costumer when editing (never the viewing admin's), otherwise the header's own current costumerId (authoritative for both roles when creating). */
  const targetCostumerId = user ? (user.costumer_id ?? costumerId) : costumerId;
  const targetCostumerName = user ? null : isSysadm ? costumerName : null;

  /** Redirects back to "/admin" if a sysadm reaches the CREATE form (no :userId — editing an existing user always has its own costumer_id, see targetCostumerId above) with the header fully unscoped (no costumerId — "Alle") — this form has no "pick a costumer here" fallback left (see this component's own doc comment). A regular admin always has their own costumerId regardless, and editing an existing user always resolves targetCostumerId from that user's own record, so this never fires for either of those cases. */
  useEffect(() => {
    if (!userId && isSysadm && !costumerId) {
      navigate("/admin", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isSysadm, costumerId]);

  // Scoped to targetCostumerId, NOT the viewing admin's own costumerId —
  // otherwise a sysadm editing a user in some other costumer (or
  // creating one for the costumer they navigated in for, see targetCostumerId
  // above) would see either the wrong departments or none at all.
  useEffect(() => {
    if (!targetCostumerId) {
      setDepartmentOptions([]);
      return;
    }
    void fetchDepartmentOptions(targetCostumerId).then(setDepartmentOptions);
  }, [targetCostumerId]);

  // A costumer with only one department has no real choice to make — force
  // it and lock the field instead of showing a single-option dropdown.
  useEffect(() => {
    if (departmentOptions.length === 1) {
      setDepartment(departmentOptions[0].name);
    }
  }, [departmentOptions]);

  /** Loads this user's own Afdelinger grants (user_departments) — only when editing an existing user. */
  useEffect(() => {
    if (!user) {
      setGrantsLoading(false);
      return;
    }

    let cancelled = false;
    setGrantsLoading(true);
    setGrantsError(null);

    void supabase
      .from("user_departments")
      .select("department_id")
      .eq("user_id", user.user_id)
      .returns<{ department_id: string }[]>()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setGrantsError(error.message);
          setGrantsLoading(false);
          return;
        }
        const grants = new Set((data ?? []).map((row) => row.department_id));
        setUserDepartmentIds(grants);
        setOriginalUserDepartmentIds(new Set(grants));
        setGrantsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  // When exactly one department is checked "Tilhører" in the Afdeling(er)
  // table, there's no real Hjemmeafdeling choice left either — auto-select
  // it and lock the field (see the sole-checked-department rendering
  // below), same treatment as the "only one department in the whole
  // costumer" case. Safe to run on load too (not just on a fresh checkbox
  // click): for an existing user already sitting at exactly one grant,
  // department already matches it, so this is a no-op. The reverse
  // direction — clearing department back to "" the moment a SECOND
  // department gets checked — deliberately isn't handled here as a mirrored
  // effect; see toggleUserDepartment's own comment for why.
  useEffect(() => {
    if (userDepartmentIds.size !== 1) return;
    const [onlyId] = userDepartmentIds;
    const onlyDepartment = departmentOptions.find((d) => d.department_id === onlyId);
    if (onlyDepartment && department !== onlyDepartment.name) {
      setDepartment(onlyDepartment.name);
    }
  }, [userDepartmentIds, departmentOptions, department]);

  /** Self-heals the current home department into userDepartmentIds whenever either resolves/changes — a user's home department must always be one of their own grants. Runs for a brand-new user too (not just when editing), so create-user.mts's insert below always has at least the chosen home department to seed. */
  useEffect(() => {
    const homeId = departmentOptions.find((d) => d.name === department)?.department_id;
    if (!homeId) return;
    setUserDepartmentIds((prev) => (prev.has(homeId) ? prev : new Set(prev).add(homeId)));
  }, [department, departmentOptions]);

  // Pre-checks whether this user is the last remaining admin in THEIR OWN
  // department (user.department_id, not the viewing admin's own afdelingId —
  // a sysadm viewing/archiving a user outside their own former
  // department has afdelingId === null, which would otherwise always read
  // as "not the last admin" regardless of the target's real situation), so
  // clicking "Arkiver bruger" can show a warning popup instead of "Er du
  // sikker...?" for an archive delete-user.mts will reject anyway. Mirrors
  // that function's own guard — this is a UX pre-check only, not the
  // authorization boundary (the server re-checks it regardless).
  useEffect(() => {
    if (!user || !isDepartmentAdmin(user.role) || !user.department_id) {
      setIsLastAdmin(false);
      return;
    }
    void supabase
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("department_id", user.department_id)
      .eq("role", "admin")
      .is("deleted_at", null)
      .neq("user_id", user.user_id)
      .then(({ count }) => setIsLastAdmin((count ?? 0) === 0));
  }, [user]);

  useEffect(() => {
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailExists(null);
      return;
    }

    const handle = setTimeout(async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("user_id")
        .eq("email", trimmed)
        .maybeSingle<{ user_id: string }>();

      if (error) {
        setEmailExists(null);
        return;
      }

      // Editing an existing user: their own (unchanged) email is not a
      // conflict — only a match belonging to a DIFFERENT user counts.
      setEmailExists(Boolean(data) && data?.user_id !== user?.user_id);
    }, 400);

    return () => clearTimeout(handle);
  }, [email, user?.user_id]);

  const emailFormatInvalid = email.trim().length > 0 && !EMAIL_PATTERN.test(email.trim());
  // PHONE_PATTERN validates spaces/dashes/parens as part of the format
  // itself (see its own comment) — tested against the trimmed value, not
  // the whitespace-stripped one. The saved value itself keeps its
  // single-space form (see normalizeNumberSpacing server-side in
  // create-user.mts/update-user.mts).
  const phoneFormatInvalid = phone.trim().length > 0 && !PHONE_PATTERN.test(phone.trim());

  const canSubmit =
    fullName.trim().length > 0 &&
    EMAIL_PATTERN.test(email.trim()) &&
    emailExists === false &&
    PHONE_PATTERN.test(phone.trim()) &&
    department.trim().length > 0 &&
    role.trim().length > 0 &&
    // A brand-new user created by a sysadm needs a real targetCostumerId
    // (from the global header — see this component's own doc comment) —
    // there's no viewer-own costumer to fall back to, and missing one must
    // block submission rather than silently creating the user with no
    // departmentOptions at all. In practice the redirect effect above
    // already sends them to "/admin" before this would ever matter, but
    // this stays as a defensive belt-and-braces check.
    (user || !isSysadm || Boolean(targetCostumerId));

  // isSelf reads straight off afdelingId (AuthContext's own live value,
  // available synchronously on the very first render) rather than
  // departmentOptions/department — departmentOptions itself only resolves
  // once its own fetch effect completes, which would otherwise leave
  // homeDepartmentId (and everything downstream of it, e.g. the new Standard
  // settings section below) undefined for a render or two even though the
  // real answer was already known.
  const homeDepartmentId = isSelf ? afdelingId : departmentOptions.find((d) => d.name === department)?.department_id;
  /** Whether the user-being-edited/created's OWN home department shows the "Bruger-ID:" row below at all — see useIdentSettings' own doc comment. Deliberately NOT afdelingId (the viewing admin's own active department): a sysadm editing a user in some other department has afdelingId === null (see this page's own doc comment on the fetch-by-id fallback being reachable by "any" department for that role), which would otherwise always hide the field regardless of the edited user's actual department setting. */
  const { useUserIdent } = useIdentSettings(homeDepartmentId ?? null);
  /** The one department checked "Tilhører" in Afdeling(er), when there's exactly one — Hjemmeafdeling locks to it (see the effect above and the rendering below), same as departmentOptions.length === 1 locking it to the costumer's own sole department. */
  const soleCheckedDepartment =
    userDepartmentIds.size === 1
      ? departmentOptions.find((d) => d.department_id === [...userDepartmentIds][0])
      : undefined;

  /** True when a regular admin (never a sysadm — see [[project_admin_costumer_wide_user_edit_scope]] for why the underlying edit itself stays ALLOWED costumer-wide regardless) is about to update an EXISTING user whose own departments (userDepartmentIds — self-healed to always include their home department, see the effect above) don't overlap AT ALL with the viewing admin's own granted departments (availableDepartments, from useAuth() — "Data Filter"'s own Afdeling <select> list). Purely informational — surfaced as an extra warning line in the "Opdater bruger" ConfirmDialog below, not a block, since the server-side authorization boundary is (and stays) the whole costumer, not the admin's own grants. userDepartmentIds.size > 0 guards against a false positive while it's still loading/hasn't self-healed yet. */
  const isCrossingDepartmentBoundary =
    isDepartmentAdmin(profile?.role) &&
    !isSelf &&
    Boolean(user) &&
    userDepartmentIds.size > 0 &&
    !availableDepartments.some((d) => userDepartmentIds.has(d.department_id));

  /** A leading "Indstillinger" subheader row (plain full-width label, no value cell — see the "custom" inputType's own doc comment on StandardSettings.tsx), then STANDARDER, then a trailing "Anvendelser" row embedding AnvendelseSettings itself — the same shape the old standalone "/settings-user"'s own userStandarder used, minus the RETTIGHEDER checkbox rows (those are handled by the separate RettighederSettings instances above/below instead, not merged into this table). AnvendelseSettings' own readOnly mirrors StandardSettings' (both flip together on isSelf). Memoized since it's passed to StandardSettings' settings prop, which that component's own load effect depends on by reference — an unmemoized inline array would re-trigger a refetch every render. */
  const standardAndAnvendelserSettings = useMemo<StandardSetting[]>(
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
          // 2026-09-14: confirmed via a real screenshot next to this page's
          // own "Bruger oplysninger"/"Tilladelser" headers, which use this
          // same div convention and looked correctly grey).
          <SettingsSectionHeading>Indstillinger</SettingsSectionHeading>
        ),
      },
      ...STANDARDER,
      {
        name: "Anvendelser_row",
        label: "Anvendelser",
        inputType: "custom",
        info: 'Disse anvendelser er tilgængelige, som begrundelse for en reservation. Ved at vælge "Andet" kan du angive en anden begrundese',
        render: (labelCell) => (
          <AnvendelseSettings
            ref={anvendelseRef}
            labelCell={labelCell}
            table="user_settings"
            scopeColumn="user_id"
            scopeId={user?.user_id ?? null}
            departmentId={homeDepartmentId ?? null}
            readOnly={!isSelf}
            deferSave={isSelf}
            onDirtyChange={setAnvendelseDirty}
          />
        ),
      },
    ],
    [user?.user_id, homeDepartmentId, isSelf],
  );

  /** Toggles a department's Afdelinger grant — refuses the one matching the current home department (a user can't lose access to their own active home department), guarded here too rather than trusting only the checkbox's disabled attribute below. */
  const toggleUserDepartment = (option: DepartmentOption, checked: boolean) => {
    if (option.department_id === homeDepartmentId) return;

    // Checking a SECOND department while exactly one was already the
    // (locked) Hjemmeafdeling means there's a real choice again — clear
    // back to "" so the field returns to its normal, editable, unset
    // "Vælg afdeling" state instead of silently keeping the old pick.
    // Reads userDepartmentIds directly (this render's own closure, so it's
    // exactly the pre-toggle count) rather than reacting to it via a
    // useEffect — deliberately only fires here, as a direct result of THIS
    // specific 1→2 transition, not the moment an existing multi-department
    // user's grants first load (which would also be "size !== 1").
    if (checked && userDepartmentIds.size === 1) {
      setDepartment("");
    }

    setUserDepartmentIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(option.department_id);
      } else {
        next.delete(option.department_id);
      }
      return next;
    });
  };

  /** Deletes this user's `user_profiles` row AND their Supabase Auth account via delete-user.mts (a real client-side delete can't reach auth.users at all — that requires the service-role key), then returns to DepartmentPage. */
  const handleDelete = async () => {
    if (!user) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/.netlify/functions/delete-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ userId: user.user_id }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSubmitError(result.error ?? "Kunne ikke slette bruger.");
        setIsSubmitting(false);
        return;
      }
    } catch {
      setSubmitError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/department", { replace: true });
  };

  /** Reverses handleDelete via unblock-user.mts — lifts the Auth ban and clears deleted_at, then returns to DepartmentPage. No "last admin" pre-check needed here, unlike handleDelete: restoring access only ever adds admin coverage back, never removes it. */
  const handleUnblock = async () => {
    if (!user) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/.netlify/functions/unblock-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ userId: user.user_id }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSubmitError(result.error ?? "Kunne ikke genetablere brugerens adgang.");
        setIsSubmitting(false);
        return;
      }
    } catch {
      setSubmitError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/department", { replace: true });
  };

  /** Calls update-user with the form's current values for this user, authenticated with the current session's access token, then persists any pending Rettigheder checkbox changes (staged locally via deferSave — see RettighederSettings' exposed save()). Shows the server's error message (or a generic connection-failure one) inline on failure. */
  const handleUpdate = async () => {
    if (!user) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/.netlify/functions/update-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          userId: user.user_id,
          email: email.trim(),
          full_name: fullName || null,
          phone: phone || null,
          user_ident: userIdent.trim() || null,
          department: department || null,
          role: role || "user",
        }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSubmitError(result.error ?? "Kunne ikke opdatere bruger.");
        setIsSubmitting(false);
        return;
      }
    } catch {
      setSubmitError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsSubmitting(false);
      return;
    }

    // Reconciles user_departments against whatever was toggled — only when
    // the grants section itself loaded successfully, so a failed fetch
    // (grantsError set) can't wipe out real grants the admin never
    // actually saw or touched. Mirrors HandleVehiclePage.tsx's own
    // vehicle_departments reconciliation.
    if (!grantsError) {
      const toAdd = [...userDepartmentIds].filter((id) => !originalUserDepartmentIds.has(id));
      const toRemove = [...originalUserDepartmentIds].filter((id) => !userDepartmentIds.has(id));

      if (toRemove.length > 0) {
        const { error: removeError } = await supabase
          .from("user_departments")
          .delete()
          .eq("user_id", user.user_id)
          .in("department_id", toRemove);
        if (removeError) {
          setSubmitError(removeError.message);
          setIsSubmitting(false);
          return;
        }
      }

      if (toAdd.length > 0) {
        const { error: addError } = await supabase
          .from("user_departments")
          .insert(toAdd.map((department_id) => ({ user_id: user.user_id, department_id })));
        if (addError) {
          setSubmitError(addError.message);
          setIsSubmitting(false);
          return;
        }
      }
    }

    const rettighederResult = await rettighederRef.current?.save();
    if (rettighederResult?.error) {
      setSubmitError(rettighederResult.error);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/department", { replace: true });
  };

  /** Calls create-user with the form's values, authenticated with the current session's access token, then seeds user_departments and persists any pending "Tilladelser for den nye bruger" checkbox changes (staged locally via deferSave — see RettighederSettings' exposed save()). Shows the server's error message (or a generic connection-failure one) inline on failure. */
  const handleConfirm = async () => {
    if (pendingAction === "close") {
      navigate("/department", { replace: true });
      return;
    }

    if (pendingAction === "delete") {
      await handleDelete();
      return;
    }

    if (pendingAction === "reactivate") {
      await handleUnblock();
      return;
    }

    if (pendingAction === "update") {
      await handleUpdate();
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/.netlify/functions/create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          email: email.trim(),
          full_name: fullName || null,
          phone: phone || null,
          user_ident: userIdent.trim() || null,
          department: department || null,
          role: role || "user",
        }),
      });

      const result = (await response.json()) as { id?: string; emailSent?: boolean; error?: string };

      if (!response.ok) {
        setSubmitError(result.error ?? "Kunne ikke oprette bruger.");
        setIsSubmitting(false);
        return;
      }

      // Seeds user_departments for the new user — create-user.mts itself
      // never touches that table, so without this a brand-new user would
      // have zero grants (the gap flagged earlier this session). The
      // self-heal effect above guarantees userDepartmentIds already has at
      // least the chosen home department; if role is "admin" it may also
      // include whatever else was checked in the Afdelinger table.
      const newUserId = result.id;
      if (newUserId && userDepartmentIds.size > 0) {
        const { error: insertGrantsError } = await supabase
          .from("user_departments")
          .insert([...userDepartmentIds].map((department_id) => ({ user_id: newUserId, department_id })));
        if (insertGrantsError) {
          setSubmitError(insertGrantsError.message);
          setIsSubmitting(false);
          return;
        }
      }

      // Persists whatever was toggled in the "Tilladelser for den nye
      // bruger" section above (deferSave — see its own doc comment) — held
      // back until now so a checkbox change there never touches
      // department_settings unless the user is actually created.
      const rettighederResult = await rettighederRef.current?.save();
      if (rettighederResult?.error) {
        setSubmitError(rettighederResult.error);
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      setPendingAction(null);
      navigate("/department", { replace: true, state: { emailWarning: result.emailSent === false } });
      return;
    } catch {
      setSubmitError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsSubmitting(false);
      return;
    }
  };

  // A plain "user" (or other non-admin role) requesting someone ELSE's
  // :userId — this route's own ProtectedRoute (App.tsx) had to drop
  // requireAdmin entirely to let self-view through at all, so the
  // self-vs-admin-vs-forbidden decision moves here instead. Checked after
  // every hook above (rules-of-hooks) but before any of the fetch/rendering
  // logic below actually needs `user` to mean anything.
  if (forbiddenOtherUser) {
    return <ForbiddenNotice />;
  }

  // Only while a SPECIFIC user is being fetched by id (:userId present, no
  // router state yet) — without this guard, the form would flash as "Ny
  // bruger oplysninger" (create mode) for a moment before the fetch resolves
  // and `user` becomes non-null.
  if (userId && !user && userLoading) {
    return (
      <PageLoading label="Indlæser bruger…" />
    );
  }

  return (
    <>
      <PageShell>
          <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <div className="rounded-2xl border border-brand-100">
                {/* rounded-2xl lives here too (not just on the outer border,
                    with no overflow-hidden at all) so the Afdeling(er)/
                    Hjemmeafdeling "?" popovers — absolutely positioned
                    descendants — aren't clipped when they overflow this
                    box's edge (same fix as RettighederSettings.tsx). */}
                <div className="divide-y divide-brand-100 rounded-2xl bg-white">
                  {/* The page's own title, as this table's own first row
                      (same bar styling as the "Indstillinger"/"Tilladelser"
                      subsubheaders below) rather than a separate <h2> sitting
                      above the table. */}
                  <SettingsSectionHeading>
                    {isSelf
                      ? "Dine bruger oplysninger"
                      : user
                        ? `Bruger oplysninger for ${user.user_ident ?? user.full_name ?? user.email ?? "—"}`
                        : "Opret bruger"}
                  </SettingsSectionHeading>
                  {!user && isSysadm && (
                    // sysadm-only "Ny bruger" Kunde row — read-only
                    // display, not a picker: targetCostumerId already
                    // follows the global header's own costumerId ("Data
                    // Filter", PageHeader.tsx), so there's nothing left to
                    // choose here, just to confirm.
                    <SettingsRow>
                      <label className="flex items-center text-sm font-medium text-brand-700">Kunde:</label>
                      <span className="rounded-lg border border-transparent px-2 py-0.5 text-sm text-brand-800">
                        {targetCostumerName ?? "—"}
                      </span>
                    </SettingsRow>
                  )}
                  {useUserIdent && (
                    <SettingsRow>
                      <label className="text-sm font-medium text-brand-700">Bruger-ID:</label>
                      {isSelf ? (
                        <input
                          type="text"
                          readOnly
                          disabled
                          value={userIdent || "—"}
                          className="cursor-not-allowed rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800"
                        />
                      ) : (
                        <input
                          type="text"
                          value={userIdent}
                          onChange={(e) => setUserIdent(e.target.value)}
                          placeholder="valgfri — bruger E-mail hvis tom"
                          className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      )}
                    </SettingsRow>
                  )}
                  {/* className override on all three: matches this table's own header bar's px-2 (RequiredFieldRow's own default is p-0.5, no horizontal padding) so every row's label text starts flush with the header text above it. */}
                  <RequiredFieldRow
                    label="Navn:"
                    value={fullName}
                    onChange={setFullName}
                    readOnly={isSelf}
                    className="grid grid-cols-[14rem_1fr] items-center gap-2 px-2 py-0.5"
                  />
                  <RequiredFieldRow
                    label="E-mail:"
                    value={email}
                    onChange={setEmail}
                    type="email"
                    readOnly={isSelf}
                    className="grid grid-cols-[14rem_1fr] items-center gap-2 px-2 py-0.5"
                  />
                  <RequiredFieldRow
                    label="Telefon:"
                    value={phone}
                    onChange={setPhone}
                    type="tel"
                    readOnly={isSelf}
                    className="grid grid-cols-[14rem_1fr] items-center gap-2 px-2 py-0.5"
                  />
                  <SettingsRow>
                    <label className="flex items-center text-sm font-medium text-brand-700">
                      Rolle: {!isSelf && <span className="ml-0.5 text-red-600">*</span>}
                    </label>
                    {isSelf ? (
                      <input
                        type="text"
                        readOnly
                        disabled
                        value={formatRoleLabel(role)}
                        className="cursor-not-allowed rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800"
                      />
                    ) : (
                      <select
                        required
                        aria-required="true"
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      >
                        <option value="" className="bg-brand-100">Vælg rolle:</option>
                        <option value="user">Bruger</option>
                        <option value="admin">Administrator</option>
                      </select>
                    )}
                  </SettingsRow>
                </div>
              </div>

              {/* Afdelingsindstillinger — its own table, same convention as
                  "Indstillinger"/"Tilladelser" (rounded-2xl border wrapper,
                  bg-white painted on that same rounded element so the
                  corners render correctly with no overflow-hidden needed —
                  see StandardSettings.tsx's own doc comment on why — plus a
                  subsubheader row as the first child). Afdeling(er) and
                  Hjemmeafdeling stay together here (own table, not two rows
                  in the "Dine bruger oplysninger" field list above) since
                  they're tightly coupled — Hjemmeafdeling can only ever be
                  one of whichever departments are checked "Tilhører" here. */}
              <div className="rounded-2xl border border-brand-100 bg-white">
                <div className="divide-y divide-brand-100 rounded-2xl">
                  <div className="relative flex items-center justify-between gap-2 rounded-t-2xl bg-brand-50/60 px-2 py-1 text-brand-600">
                    {/* text-xs/font-semibold/uppercase/tracking-wide live on
                        THIS span only, not the row div — InlinePopup doesn't
                        reset text styling itself, so putting those classes on
                        the div would have the popover message below inherit
                        them too, rendering its normal-sentence-case message
                        as bold, tracking-wide, ALL CAPS text. */}
                    <span className="text-xs font-semibold uppercase tracking-wide">Afdelingsindstillinger</span>
                    {/* The "?" that used to sit on its own "Afdeling(er):" row
                        moved up here — that row no longer exists as a single
                        unit now that each department is its own row below
                        (see the departmentOptions.map right underneath). */}
                    {(isSelf || isAnyAdmin(profile?.role)) && departmentOptions.length !== 1 && (
                      <>
                        <FieldInfoButton
                          open={openInfoPopover === "afdelinger"}
                          onToggle={() => setOpenInfoPopover((key) => (key === "afdelinger" ? null : "afdelinger"))}
                          message="Vælg hvilke afdelinger, brugeren er tilknyttet. Derefter kan du nedenfor angive brugerens hjemmeafdeling blandt de tilknyttede afdelinger"
                          align="right"
                        />
                      </>
                    )}
                  </div>
                  {/* Each department its own row (label = department name,
                      value = its "Tilhører" checkbox) directly in this
                      table, rather than nested inside a separate mini-table
                      within one "Afdeling(er):" row's value cell. */}
                  {(isSelf || isAnyAdmin(profile?.role)) &&
                    departmentOptions.length !== 1 && (
                      <>
                        {grantsLoading && <div className="px-2 py-1 text-sm text-brand-500">Indlæser…</div>}
                        {!grantsLoading && grantsError && (
                          <div className="px-2 py-1 text-sm text-red-600">{grantsError}</div>
                        )}
                        {!grantsLoading && !grantsError && departmentOptions.length === 0 && (
                          <div className="px-2 py-1 text-center text-sm text-brand-500">Ingen afdelinger fundet.</div>
                        )}
                        {!grantsLoading &&
                          !grantsError &&
                          departmentOptions.map((option) => {
                            const isHome = option.department_id === homeDepartmentId;
                            return (
                              <SettingsRow key={option.department_id}>
                                <label className="text-sm font-medium text-brand-700">{option.name}:</label>
                                <span className="inline-flex items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={isHome || userDepartmentIds.has(option.department_id)}
                                    disabled={isSelf || isHome}
                                    onChange={isSelf ? undefined : (e) => toggleUserDepartment(option, e.target.checked)}
                                    className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500 disabled:cursor-not-allowed"
                                  />
                                  {/* Always-visible, not a hover tooltip — explains why this one row's checkbox can't be unchecked, same "Blokeret" badge styling convention as VehicleDetailsPage.tsx/BookingDetailsPage.tsx. */}
                                  {isHome && (
                                    <span
                                      className="rounded bg-brand-100 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-brand-700"
                                      title="Kan ikke fjernes fra brugerens hjemmeafdeling"
                                    >
                                      Hjem
                                    </span>
                                  )}
                                </span>
                              </SettingsRow>
                            );
                          })}
                      </>
                    )}
                      <SettingsRow>
                        <div className="relative flex items-center justify-between gap-2">
                          <label className="text-sm font-medium text-brand-700">
                            Hjemmeafdeling:{" "}
                            {!isSelf && departmentOptions.length !== 1 && !soleCheckedDepartment && (
                              <span className="ml-0.5 text-red-600">*</span>
                            )}
                          </label>
                          <FieldInfoButton
                            open={openInfoPopover === "hjemmeafdeling"}
                            onToggle={() => setOpenInfoPopover((key) => (key === "hjemmeafdeling" ? null : "hjemmeafdeling"))}
                            message={
                              isSelf || departmentOptions.length === 1 || soleCheckedDepartment
                                ? "Du er tilknyttet denne afdeling"
                                : "Her skal du angive, hvilken afdeling brugeren pt. er tilknyttet (brugeren kan frit reservere fra alle tilknyttede afdelinger)"
                            }
                            align="right"
                          />
                        </div>
                        {isSelf || departmentOptions.length === 1 || soleCheckedDepartment ? (
                          <input
                            type="text"
                            readOnly
                            disabled
                            value={
                              isSelf
                                ? (afdeling ?? "—")
                                : departmentOptions.length === 1
                                  ? departmentOptions[0].name
                                  : (soleCheckedDepartment?.name ?? "")
                            }
                            className="cursor-not-allowed rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800"
                          />
                        ) : (
                          <select
                            required
                            aria-required="true"
                            value={department}
                            onChange={(e) => setDepartment(e.target.value)}
                            className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                          >
                            <option value="" className="bg-brand-100">Vælg hjemmeafdeling:</option>
                            {departmentOptions
                              .filter((option) => userDepartmentIds.has(option.department_id))
                              .map((option) => (
                                <option key={option.department_id} value={option.name}>
                                  {option.name}
                                </option>
                              ))}
                          </select>
                        )}
                      </SettingsRow>
                    </div>
                  </div>

              {emailFormatInvalid && <p className="text-xs text-red-600">Ugyldigt e-mailformat.</p>}
              {emailExists && (
                <p className="text-xs text-red-600">
                  Du kan ikke oprette en ny bruger med samme e-mail som en eksisterende bruger.
                </p>
              )}
              {phoneFormatInvalid && <p className="text-xs text-red-600">Ugyldigt telefonnummer.</p>}

              {!isSelf && (
                <p className="text-right text-xs text-brand-500">
                  <span className="text-red-600">*</span> Feltet skal udfyldes
                </p>
              )}

              {user && !isSelf && user.role === "user" && (
                <RettighederSettings
                  ref={rettighederRef}
                  table="user_settings"
                  scopeColumn="user_id"
                  scopeId={user.user_id}
                  departmentId={homeDepartmentId ?? null}
                  deferSave
                  heading="Tilladelser for denne bruger"
                />
              )}

              {/* Self-view's own Tilladelser (heading defaults to that, see
                  RettighederSettings.tsx) — read-only, shown for EVERY
                  role (matching the old standalone "/settings-user"'s
                  behavior), unlike the admin-edit instance just above which
                  only ever applies to editing an existing "user"-role
                  account. Mutually exclusive with it at runtime (isSelf vs.
                  "admin editing someone else"), so no shared state/ref. */}
              {isSelf && user && (
                <RettighederSettings
                  table="user_settings"
                  scopeColumn="user_id"
                  scopeId={user.user_id}
                  departmentId={homeDepartmentId ?? null}
                  readOnly
                />
              )}

              {!user && isAnyAdmin(profile?.role) && (
                // "Ny bruger": gated on the LOGGED-IN admin's own role
                // (profile?.role), not the new user's selected role — this
                // is a department_settings-scoped view (rights for everyone
                // in the department, not this one new user), so who's
                // creating the account is what matters. Same component
                // SettingsAdminPage itself uses, scoped to whichever
                // Hjemmeafdeling this new user is being assigned to, so it
                // can be set up in the same flow. deferSave (reusing
                // rettighederRef — mutually exclusive at runtime with the
                // admin-editing-someone-else instance above, since that one
                // only renders when `user` exists and this one only when it
                // doesn't) so toggling a checkbox here does NOT write to
                // department_settings immediately: nothing is persisted
                // until "Opret bruger" is pressed and its own ConfirmDialog
                // confirmed (handleConfirm's create branch calls
                // rettighederRef.current.save() right after the new user is
                // actually created) — a checkbox toggled here, followed by
                // "Fortryd" or just navigating away, must never silently
                // change a real department's shared rights before the user
                // it was meant for even exists.
                <RettighederSettings
                  ref={rettighederRef}
                  table="department_settings"
                  scopeColumn="department_id"
                  scopeId={homeDepartmentId ?? null}
                  heading="Tilladelser for den nye bruger"
                  deferSave
                />
              )}

              {/* Standard settings/Anvendelser — full edit for self (deferSave,
                  same Fortryd/Opdater pair the old standalone "/settings-user"
                  had), view-only for an admin looking at someone else's own
                  row (a capability admins didn't have before this page
                  absorbed "/settings-user" — see this component's own doc
                  comment). Never shown during the CREATE flow (no `user` yet
                  — nothing to scope these settings to). Placed AFTER every
                  Rettigheder section above (not right after the field list)
                  so its own embedded Fortryd/Opdater pair (deferSave, self
                  only) ends up the last thing on the page before the
                  submit-error/bottom action buttons, rather than sitting in
                  the middle of the page. */}
              {user && (
                <StandardSettings
                  table="user_settings"
                  scopeColumn="user_id"
                  scopeId={user.user_id}
                  settings={standardAndAnvendelserSettings}
                  departmentId={homeDepartmentId ?? null}
                  deferSave={isSelf}
                  readOnly={!isSelf}
                  extraDirty={anvendelseDirty}
                  onExtraCommit={() => anvendelseRef.current?.save() ?? Promise.resolve({ error: null })}
                  onExtraRevert={() => anvendelseRef.current?.revert()}
                />
              )}

              {submitError && <p className="text-sm text-red-600">{submitError}</p>}

              {user && !isSelf ? (
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => {
                      setSubmitError(null);
                      setPendingAction("update");
                    }}
                    disabled={!canSubmit}
                  >
                    Opdater bruger
                  </Button>
                  {user.deleted_at ? (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => {
                        setSubmitError(null);
                        setPendingAction("reactivate");
                      }}
                    >
                      Genetabler brugers adgang
                    </Button>
                  ) : (
                    <div className="relative">
                      <Button
                        variant="danger"
                        type="button"
                        onClick={() => {
                          if (isLastAdmin) {
                            triggerWarning("last-admin");
                            return;
                          }
                          setSubmitError(null);
                          setPendingAction("delete");
                        }}
                        className="w-full"
                      >
                        Bloker brugers adgang
                      </Button>
                      <InlinePopup
                        visible={warningKey === "last-admin"}
                        message="Kan ikke arkivere den sidste administrator i afdelingen."
                        variant="warning"
                      />
                    </div>
                  )}
                </div>
              ) : !user ? (
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => {
                      setSubmitError(null);
                      setPendingAction("create");
                    }}
                    disabled={!canSubmit}
                  >
                    Opret bruger
                  </Button>
                  <Button variant="secondary" type="button" onClick={() => setPendingAction("close")}>
                    Fortryd
                  </Button>
                </div>
              ) : null}
            </div>
          </section>
      </PageShell>

      {pendingAction && (
        <ConfirmDialog
          message={
            pendingAction === "create"
              ? "Er du sikker på, at du vil oprette denne bruger?"
              : pendingAction === "update"
                ? (
                    <>
                      Er du sikker på, at du vil opdatere denne bruger?
                      {isCrossingDepartmentBoundary && (
                        // Informational only — the update itself is still allowed
                        // (a regular admin's real authorization boundary is their
                        // whole costumer, not their own granted departments — see
                        // update-user.mts). This just makes sure they notice.
                        <span className="mt-2 block text-amber-600">
                          Bemærk: denne bruger er ikke i en af dine egne afdelinger — du er ved at krydse dine normale afdelingsgrænser.
                        </span>
                      )}
                    </>
                  )
                : pendingAction === "delete"
                  ? "Er du sikker på, at du vil blokere denne bruger adgang? Brugeren kan ikke længere logge ind, men brugerens historik (fx bookinger) bevares."
                  : pendingAction === "reactivate"
                    ? "Er du sikker på, at du vil genetablere denne brugers adgang?"
                    : "Er du sikker på, at du vil lukke uden at gemme?"
          }
          error={submitError}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handleConfirm()}
          isPending={isSubmitting}
          confirmPendingLabel={
            pendingAction === "delete" ? "Blokerer…" : pendingAction === "reactivate" ? "Genetablerer…" : "Vent…"
          }
        />
      )}
    </>
  );
}
