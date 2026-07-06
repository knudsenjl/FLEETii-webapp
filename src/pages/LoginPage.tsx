import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { setRememberMe, supabase } from "../lib/supabase";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { TypingHeader } from "../components/TypingHeader";

type Step = { name: "credentials" };

const stepVariants = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
};

export function LoginPage() {
  const [step] = useState<Step>({ name: "credentials" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMeState] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);

  useEffect(() => {
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
  }, []);

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

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
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: username,
        password,
      });

      if (signInError) {
        setError("Forkert brugernavn eller adgangskode.");
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
    <div className="flex h-dvh flex-col items-center justify-center overflow-y-auto bg-brand-50 px-5 py-10 sm:px-6">
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
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-xl shadow-brand-900/5"
      >
        <div className="relative min-h-[22rem] p-6 sm:p-8">
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
                  <p className="mt-1 text-sm text-brand-500">
                    Indtast dine virksomhedsoplysninger for at fortsætte.
                  </p>
                </div>

                <label className="flex flex-col gap-1.5 text-sm font-medium text-brand-700">
                  Brugernavn / e-mail
                  <input
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="dig@virksomhed.dk"
                    className="rounded-lg border border-brand-200 bg-brand-50/50 px-3.5 py-2.5 text-base text-brand-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30"
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm font-medium text-brand-700">
                  Adgangskode
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="rounded-lg border border-brand-200 bg-brand-50/50 px-3.5 py-2.5 text-base text-brand-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30"
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
                  disabled={submitting}
                  className="mt-2 inline-flex items-center justify-center rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Logger ind…" : "Log ind"}
                </button>
              </motion.form>
            )}

          </AnimatePresence>
        </div>
      </motion.div>

      <p className="mt-6 text-center text-xs text-brand-400">
        © {new Date().getFullYear()} FLEETii. Alle rettigheder forbeholdes.
      </p>
    </div>
  );
}
