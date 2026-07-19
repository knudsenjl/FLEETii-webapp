// Forced "set a real password" page ("/set-password"). Reached two ways —
// ProtectedRoute/RootRoute (see App.tsx) send a session here before
// anywhere else in the app, admin routes included, if EITHER is true:
// (1) it's still on the shared default password from create-user.mts
// (app_metadata.must_change_password), or (2) it's a "reset password" email
// link's session (AuthContext.tsx's isPasswordRecovery) — Supabase signs
// the user in the moment that link's tokens land in the URL, WITHOUT
// changing the password, so without this gate a recovery-email click would
// just log someone in with their unchanged old password.
import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { FleetiiLogo } from "../components/FleetiiLogo";

const MIN_PASSWORD_LENGTH = 8;

/**
 * Lets the current user set a real password, then clears
 * app_metadata.must_change_password via complete-password-change.mts (a
 * server-only field the client can't clear itself — harmless to call even
 * when it was already false, e.g. for a password-recovery session) and
 * refreshes the session so ProtectedRoute/RootRoute see the change
 * immediately — no manual log-out/in required. Also clears
 * isPasswordRecovery so a recovery session doesn't get bounced right back
 * here after navigating away.
 */
export function SetPasswordPage() {
  const { session, refreshProfile, clearPasswordRecovery, isPasswordRecovery } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Adgangskoden skal være mindst ${MIN_PASSWORD_LENGTH} tegn.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Adgangskoderne er ikke ens.");
      return;
    }

    setIsSubmitting(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/.netlify/functions/complete-password-change", {
        method: "POST",
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        setError(result.error ?? "Kunne ikke fuldføre adgangskodeskiftet.");
        setIsSubmitting(false);
        return;
      }
    } catch {
      setError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsSubmitting(false);
      return;
    }

    await refreshProfile();
    clearPasswordRecovery();
    setIsSubmitting(false);
    navigate("/");
  };

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
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-xl shadow-brand-900/5"
      >
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4 p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-brand-900">Vælg en adgangskode</h2>
          <p className="text-sm text-brand-600">
            {isPasswordRecovery
              ? "Vælg en ny adgangskode for at fortsætte."
              : "Din konto blev oprettet med en midlertidig adgangskode. Vælg din egen adgangskode for at fortsætte."}
          </p>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-brand-700">
            Ny adgangskode
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-lg border border-brand-200 bg-brand-50/50 px-3.5 py-2.5 text-base text-brand-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-brand-700">
            Bekræft adgangskode
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-lg border border-brand-200 bg-brand-50/50 px-3.5 py-2.5 text-base text-brand-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30"
            />
          </label>

          {error && (
            <p role="alert" className="animate-fade-in rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Gemmer…" : "Gem adgangskode"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
