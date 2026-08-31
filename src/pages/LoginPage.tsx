// The public entry point ("/" when logged out — see RootRoute in App.tsx).
// Handles username/password sign-in via Supabase Auth, "remember me" (both
// the username, stored directly in localStorage, and the session-persistence
// choice handled by lib/supabase.ts), and a "forgot password" reset-email
// flow. On success it does NOT navigate manually — AuthContext's
// onAuthStateChange listener picks up the new session and RootRoute
// redirects once the profile has loaded too, avoiding a flash to the wrong
// page.
import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { setRememberMe, supabase } from "../lib/supabase";
import { fetchCostumerDeactivatedAt, useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { TypingHeader } from "../components/TypingHeader";
import { InlinePopup } from "../components/InlinePopup";
import { ANTI_CLONING_NOTICE } from "../lib/legal";

/** Placeholder for a possible future multi-step login flow; today there's only one step. */
type Step = { name: "credentials" };

/** Shown for any signInWithPassword failure (wrong credentials, or — per the open "first attempt after a fresh page load sometimes fails, retry immediately succeeds" investigation — possibly a getSession()-race/timeout too, see errorDetail's own comment below). Deliberately generic regardless of the real cause, same reasoning as before this was pulled into a named constant. */
const CREDENTIALS_ERROR_MESSAGE = "Login fejlede - tjek venligst brugernavn og adgangskode, og prøv igen";

const stepVariants = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
};

/** The login form. Renders unauthenticated at "/" (see RootRoute) and also reachable, unauthenticated, via LoginPage's own "i" about-button linking to /about. */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  /** Present only when this page was reached via a browser back-navigation from AboutPage (the "i" button below) — see its own comment. Wins over the remembered-username effect just below, so credentials just typed aren't clobbered by whatever's in localStorage. */
  const formSnapshot = (location.state as { formSnapshot?: { username: string; password: string } } | null)?.formSnapshot ?? null;
  // `loading`: true until AuthContext's own initial supabase.auth.getSession()
  // call (fired on mount, see AuthContext.tsx) resolves. Supabase-js
  // serializes ALL auth calls (getSession, signInWithPassword, token
  // refresh) behind an internal lock, so submitting while that first
  // getSession() is still in flight — right after a cold page load, slower
  // than usual — queues signInWithPassword behind it and can surface as a
  // failure that isn't actually about the entered credentials (see the
  // "first attempt after a fresh page load sometimes wrongly fails, retry
  // immediately succeeds" investigation). Disabling submit until loading is
  // false removes that race outright instead of working around its symptom.
  const { deactivationMessage, clearDeactivationMessage, idleTimeoutMessage, clearIdleTimeoutMessage, loading } = useAuth();
  const [step] = useState<Step>({ name: "credentials" });
  const [username, setUsername] = useState(formSnapshot?.username ?? "");
  const [password, setPassword] = useState(formSnapshot?.password ?? "");
  const [rememberMe, setRememberMeState] = useState(true);
  /** Toggles the anti-cloning clause popup below the copyright line — see ANTI_CLONING_NOTICE's own comment for why this same clause is shared with AboutPage.tsx's identical copyright line. */
  const [showCopyrightNotice, setShowCopyrightNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The real signInWithPassword error's own message, shown alongside the generic text above on EVERY failed attempt (including the first — see handleCredentialsSubmit; this used to wait for a second consecutive failure, but that hid the very first occurrence of an intermittent fault, which is exactly the data point needed to spot a pattern). The generic error text never reveals whether a failure is genuinely bad credentials or something else (network/CORS/the getSession()-race above); surfacing the raw detail lets that be diagnosed straight from the UI, without needing devtools open to read the console.error below. */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);

  useEffect(() => {
    // Skipped when restoring from formSnapshot — the just-typed username
    // (possibly not the remembered one) already won above, and this would
    // otherwise silently replace it with whatever's in localStorage.
    if (formSnapshot) return;
    try {
      const stored = localStorage.getItem("fleetii_remember_username");
      if (stored) {
        setUsername(stored);
      } else {
        setRememberMeState(false);
      }
    } catch (_) {
      /* ignore */
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Covers the case where a costumer was deactivated while this tab already
  // had an open session — AuthContext force-signs-out the moment its own
  // profile reload notices (initial load, auth-state change, or a
  // background token refresh) and leaves this message behind, since the
  // sign-out already landed here (at "/") by the time it's read.
  useEffect(() => {
    if (deactivationMessage) {
      setError(deactivationMessage);
      clearDeactivationMessage();
    }
  }, [deactivationMessage, clearDeactivationMessage]);

  // Same idea as the deactivationMessage effect above, for AuthContext's
  // idle-timeout tracker — the sign-out already happened by the time this
  // message is read here.
  useEffect(() => {
    if (idleTimeoutMessage) {
      setError(idleTimeoutMessage);
      clearIdleTimeoutMessage();
    }
  }, [idleTimeoutMessage, clearIdleTimeoutMessage]);

  /** Validates the form, remembers the username/session-mode if requested, and signs in via Supabase Auth. Errors are shown inline; a successful sign-in is picked up by AuthContext, not handled here. */
  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorDetail(null);

    // Belt-and-suspenders alongside the submit button's own disabled={loading}
    // below — a disabled button already stops the browser from submitting
    // via Enter, but this guards handleCredentialsSubmit itself regardless
    // of how it gets called.
    if (loading) return;

    if (!username || !password) {
      setError("Indtast både brugernavn og adgangskode.");
      return;
    }

    setSubmitting(true);
    setRememberMe(rememberMe);

    try {
      if (rememberMe) {
        localStorage.setItem("fleetii_remember_username", username);
      } else {
        localStorage.removeItem("fleetii_remember_username");
      }
    } catch (_) {
      // ignore storage errors
    }

    try {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: username,
        password,
      });

      if (signInError) {
        // Logged so a login failure that ISN'T actually bad credentials
        // (network/CORS issue, restricted browser environment, etc.) is
        // distinguishable in devtools — the message shown to the user is
        // always the same generic Danish text regardless of the real cause,
        // but the raw message is also surfaced inline (errorDetail) on
        // every attempt, including the first — see its own comment above
        // for why.
        console.error("[login] signInWithPassword failed:", signInError);
        setErrorDetail(signInError.message);
        setError(CREDENTIALS_ERROR_MESSAGE);
        setSubmitting(false);
        return;
      }

      // Checked here, right after sign-in, rather than relying solely on
      // AuthContext's own async profile load (below) — that load races
      // against this function returning, so a deactivated costumer's user
      // would otherwise see a brief flash of a signed-in app before being
      // kicked back out.
      const deactivatedAt = await fetchCostumerDeactivatedAt(signInData.user.id);
      if (deactivatedAt) {
        await supabase.auth.signOut();
        setError("Din virksomheds adgang er blokeret. Kontakt FLEETii for detaljer.");
        setSubmitting(false);
        return;
      }

      // AuthProvider's onAuthStateChange listener picks up the new session,
      // loads the profile, and RootRoute redirects once both are ready —
      // no manual navigation here, so there's no flash to the wrong page.
    } catch {
      setError("Login fejlede. Prøv igen senere.");
      setSubmitting(false);
    }
  }

  /** Sends a Supabase password-reset email to the entered username/email. Requires a non-empty username field (used as the recipient) but no password. */
  async function handleForgotPassword() {
    setError(null);
    setResetMessage(null);

    if (!username) {
      setError("Indtast din e-mail for at nulstille adgangskoden.");
      return;
    }

    setResetSubmitting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(username);
    setResetSubmitting(false);

    if (resetError) {
      console.error("resetPasswordForEmail failed:", resetError);
      setError(`Kunne ikke sende nulstillingsmail: ${resetError.message}`);
      return;
    }

    setResetMessage("Vi har sendt en mail med et link til at nulstille din adgangskode.");
  }

  return (
    <div className="flex h-svh flex-col items-center justify-center overflow-y-auto bg-brand-50 px-5 py-10 sm:px-6">
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,theme(colors.brand.100),transparent_60%)]"
        aria-hidden="true"
      />

      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="mb-8 flex flex-col items-center gap-3 sm:mb-10"
      >
        <FleetiiLogo className="h-14 w-auto sm:h-16" />
        <TypingHeader
          as="h1"
          text="Velkommen til FLEETii"
          className="text-center text-xl font-semibold text-brand-800 sm:text-2xl"
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm shrink-0 overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-xl shadow-brand-900/5"
      >
        <div className="relative min-h-[22rem] p-6 sm:p-8">
          <button
            type="button"
            onClick={() => {
              // Snapshot whatever's typed onto THIS page's own history entry
              // (replace, not push) right before navigating away — same fix
              // as ReservationPage's formSnapshot, so a browser
              // back-navigation from AboutPage doesn't lose it (AboutPage
              // has no back button of its own, only the browser's).
              navigate(location.pathname, { replace: true, state: { formSnapshot: { username, password } } });
              navigate("/about");
            }}
            aria-label="Om FLEETii"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-brand-200 bg-brand-50 font-serif text-base font-bold italic text-brand-700 transition hover:bg-brand-100"
          >
            i
          </button>

          <AnimatePresence mode="wait">
            {step.name === "credentials" && (
              <motion.form
                key="credentials"
                variants={stepVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeOut" }}
                onSubmit={handleCredentialsSubmit}
                className="flex flex-col gap-4"
              >
                <div>
                  <h2 className="text-lg font-semibold text-brand-900">
                    Log ind
                  </h2>
                </div>

                <label className="flex flex-col gap-1.5 text-sm font-medium text-brand-700">
                  Brugernavn / e-mail
                  <div className="relative">
                    {/* text-[16px] (an absolute value, not a rem-based text-* class) rather than the label's own text-sm — iOS Safari force-zooms the whole tab in when a focused field's computed font-size is under 16px, and html's font-size:87.5% shrinks every rem-based size below that threshold (see BookingPage.tsx's own fix for the exact symptom this avoids). Only genuinely-focusable text fields on pages a role-"user" Bruger can reach on their phone need this — see SetPasswordPage.tsx/ReservationPage.tsx's own inputs for the other spots. Admin-only desktop-oriented forms deliberately don't carry this, so their fields stay visually consistent with this app's normal (smaller) text sizing instead. */}
                    <input
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="dig@virksomhed.dk"
                      className="w-full rounded-lg border border-brand-200 bg-brand-50/50 px-3.5 py-2.5 pr-9 text-[16px] text-brand-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30"
                    />
                    {username && (
                      <button
                        type="button"
                        onClick={() => setUsername("")}
                        aria-label="Ryd brugernavn"
                        className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-brand-400 transition hover:bg-brand-100 hover:text-brand-600"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="M18 6 6 18" />
                          <path d="M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </label>

                <label className="flex flex-col gap-1.5 text-sm font-medium text-brand-700">
                  Adgangskode
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="rounded-lg border border-brand-200 bg-brand-50/50 px-3.5 py-2.5 text-[16px] text-brand-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30"
                  />
                </label>

                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-brand-700">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMeState(e.target.checked)}
                      className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-2 focus:ring-accent-500/30"
                    />
                    Husk mig
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleForgotPassword()}
                    disabled={resetSubmitting}
                    className="text-sm font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resetSubmitting ? "Sender…" : "Skift adgangskode"}
                  </button>
                </div>

                {error && (
                  <p
                    role="alert"
                    className="animate-fade-in rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
                  >
                    {error}
                    {errorDetail && (
                      <span className="mt-1 block text-xs text-red-500">Detaljer: {errorDetail}</span>
                    )}
                  </p>
                )}

                {resetMessage && (
                  <p
                    role="status"
                    className="animate-fade-in rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700"
                  >
                    {resetMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting || loading}
                  className="mt-2 inline-flex items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 shadow-sm transition hover:bg-brand-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Logger ind…" : loading ? "Indlæser…" : "Log ind"}
                </button>
              </motion.form>
            )}

          </AnimatePresence>
        </div>
      </motion.div>

      <div className="mt-6 flex justify-center">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowCopyrightNotice((prev) => !prev)}
            className="text-xs text-brand-400 underline decoration-dotted underline-offset-2 transition hover:text-brand-600"
          >
            © {new Date().getFullYear()} FLEETii. Alle rettigheder forbeholdes.
          </button>
          {showCopyrightNotice && (
            <div className="fixed inset-0 z-10" onClick={() => setShowCopyrightNotice(false)} />
          )}
          <InlinePopup visible={showCopyrightNotice} position="top" message={ANTI_CLONING_NOTICE} />
        </div>
      </div>
    </div>
  );
}
