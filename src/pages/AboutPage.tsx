// The only deliberately public page ("/about" — reachable both from
// LoginPage before signing in and from every other page's "i" header
// button). Static company/product info plus links to the three role manuals
// (Bruger, Administrator, Sysadm) and contact details;
// PageHeader itself handles showing/hiding "Log ud" and the role/afdeling
// row based on whether the visitor is actually logged in.
import { useState } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { useAuth } from "../contexts/AuthContext";
import { isAnyAdmin, isSysadm } from "../lib/roles";
import { ANTI_CLONING_NOTICE } from "../lib/legal";

/**
 * Static "About FLEETii" page: product description, Brugerguide/
 * Administratormanual/Sysadm-manual links, and contact info.
 * Content is static Danish copy — no data fetching. Each manual link comes
 * from its own env var (VITE_BRUGERMANUAL_URL/VITE_ADMINMANUAL_URL/
 * VITE_FLEETIIMANUAL_URL, same VITE_ convention as VITE_SUPABASE_URL — see
 * .env.example) rather than being hardcoded, so a button is simply omitted
 * when its var is unset instead of linking to a placeholder.
 *
 * Each var is a SITE-RELATIVE path to a self-hosted static file under
 * public/manualer/ (e.g. "/manualer/fleetii-manual-bruger.html"), NOT
 * an external link — switched away from claude.ai artifact URLs since
 * published artifacts start private and aren't reliably viewable by a real
 * customer who isn't logged into the account that created them. A relative
 * path works fine as an href here (resolves against the current page), but
 * create-user.mts's welcome email needs to prefix it with the site's own
 * base URL first — see that file's own doc comment.
 *
 * VITE_BRUGERMANUAL_URL is shared with create-user.mts's welcome-email
 * link — same manual, one source of truth.
 *
 * Administratormanual/Sysadm-manual are further gated by the viewer's role
 * (profile?.role from useAuth()) — irrelevant to a regular Bruger, and
 * profile is null for an anonymous visitor reaching this page from
 * LoginPage, so both stay hidden for them too. Administratormanual shows
 * for "admin" AND "sysadm" (a sysadm is a superset of admin and still
 * administers departments day-to-day); Sysadm-manual shows only for
 * "sysadm". Brugerguide has no such gate; every role may want it.
 *
 * fleetiiAdministratormanualUrl/VITE_FLEETIIMANUAL_URL keep their original
 * names (matching the untouched public/manualer/ filename) even though the
 * role and its button text are now "sysadm" — only the visible label
 * changed, not this asset's identity.
 */
export function AboutPage() {
  const { profile } = useAuth();
  /** Toggles the anti-cloning clause popup below the copyright line — see ANTI_CLONING_NOTICE's own comment for why this same clause is shared with LoginPage.tsx's identical copyright line. */
  const [showCopyrightNotice, setShowCopyrightNotice] = useState(false);
  const brugerguideUrl = import.meta.env.VITE_BRUGERMANUAL_URL;
  const administratormanualUrl = import.meta.env.VITE_ADMINMANUAL_URL;
  const fleetiiAdministratormanualUrl = import.meta.env.VITE_FLEETIIMANUAL_URL;

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

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-brand-800">Om FLEETii</h2>
                <div className="flex shrink-0 flex-col gap-2">
                  {brugerguideUrl && (
                    <a
                      href={brugerguideUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-center text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                    >
                      Brugerguide
                    </a>
                  )}
                  {administratormanualUrl && isAnyAdmin(profile?.role) && (
                    <a
                      href={administratormanualUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-center text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                    >
                      Administratormanual
                    </a>
                  )}
                  {fleetiiAdministratormanualUrl && isSysadm(profile?.role) && (
                    <a
                      href={fleetiiAdministratormanualUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-center text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                    >
                      Sysadm-manual
                    </a>
                  )}
                </div>
              </div>

              <p className="text-sm text-brand-700">
                FLEETii er den digitale nøgle- og flådestyringsløsning, der giver jeres
                organisation nøglefri adgang til flåden, fleksible bookinger, forhindre uønsket
                anvendelse, realtidsdata og et fuldt overblik — uden besvær med fysiske nøgler.
              </p>

              <p className="text-sm text-brand-700">
                FLEETii understøtter flådeadministratorer og køretøjsbrugere i din organisation.
              </p>

              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-semibold text-brand-800">Administratorer</h3>
                <p className="text-sm text-brand-700">
                  Gennem flådeadministrationen får du overblik over, hvor jeres køretøjer
                  befinder sig geografisk, og du kan som administrator få indblik i væsentlige
                  faktorer, som eksempelvis drivmiddelniveau. Herudover kan du foretage bookinger
                  for dine brugere m.m.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-semibold text-brand-800">Brugere af køretøjerne</h3>
                <p className="text-sm text-brand-700">
                  Her kan du se dine aktuelle reservationer (næste og kommende). Herudover kan du
                  bl.a. låse din reserverede bil op direkte fra din mobil uden adgang til den
                  fysiske bilnøgle, og låse den under brugen af bilen og ved afslutning af
                  reservationen.
                </p>
              </div>

              <div className="mt-auto flex flex-col gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <h3 className="text-sm font-semibold text-brand-800">Kontaktoplysninger</h3>
                <div className="flex flex-col gap-0.5 text-sm text-brand-700">
                  <p className="font-medium text-brand-800">FLEETii</p>
                  <p>Stokagervej 8D</p>
                  <p>8240 Risskov</p>
                </div>
                <div className="flex flex-col gap-1.5 text-sm text-brand-700">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-white">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-brand-500">
                        <path d="M10 12h4" />
                        <path d="M10 8h4" />
                        <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
                        <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />
                        <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
                      </svg>
                    </span>
                    <span>CVR: 31 98 30 37</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-white">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-brand-500">
                        <path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8Z" />
                      </svg>
                    </span>
                    <a href="tel:+4570608689" className="hover:underline">70 60 86 89</a>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-white">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-brand-500">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="m4 7 8 6 8-6" />
                      </svg>
                    </span>
                    <a href="mailto:info@fleeti.dk" className="hover:underline">info@fleeti.dk</a>
                  </div>
                </div>
              </div>

              {/* Proprietary notice — the only real recourse if the UI/workflow is cloned is having asserted ownership somewhere; see the repo's own LICENSE file for the full terms. */}
              <div className="flex justify-center">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowCopyrightNotice((prev) => !prev)}
                    className="text-center text-xs text-brand-400 underline decoration-dotted underline-offset-2 transition hover:text-brand-600"
                  >
                    © {new Date().getFullYear()} FLEETii. Alle rettigheder forbeholdes.
                    <br />
                    Uautoriseret kopiering eller efterligning af denne software er ikke tilladt.
                  </button>
                  {showCopyrightNotice && (
                    <div className="fixed inset-0 z-10" onClick={() => setShowCopyrightNotice(false)} />
                  )}
                  <InlinePopup visible={showCopyrightNotice} position="top" message={ANTI_CLONING_NOTICE} />
                </div>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
