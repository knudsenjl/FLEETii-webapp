// The only deliberately public page ("/about" — reachable both from
// LoginPage before signing in and from every other page's "i" header
// button). Static company/product info plus a link to the user manual and
// contact details; PageHeader itself handles showing/hiding "Log ud" and the
// role/afdeling row based on whether the visitor is actually logged in.
import { motion } from "framer-motion";
import { PageHeader } from "../components/PageHeader";

/** Static "About FLEETii" page: product description, a Brugermanual link, and contact info. Content is static Danish copy — no data fetching. */
export function AboutPage() {
  const manualUrl = import.meta.env.VITE_BRUGERMANUAL_URL;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
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
                {manualUrl && (
                  <a
                    href={manualUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Brugermanual
                  </a>
                )}
              </div>

              <p className="text-sm text-brand-700">
                FLEETii understøtter flådeadministration og køretøjsbrugere i din afdeling.
              </p>

              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-semibold text-brand-800">Administratorer</h3>
                <p className="text-sm text-brand-700">
                  Gennem flådeadministrationen får du overblik over, hvor jeres køretøjer
                  befinder sig geografisk, og du kan som administrator få indblik i væsentlige
                  faktorer, som eksempelvis brændstofniveau. Herudover kan du foretage bookinger
                  for dine brugere m.m.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-semibold text-brand-800">Køretøjsbrugere</h3>
                <p className="text-sm text-brand-700">
                  Her kan du se dine aktuelle reservationer (næste og kommende). Herudover kan du
                  bl.a. låse din reserverede bil op, og låse den under brugen af bilen og ved
                  afslutning af reservationen.
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
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-brand-500">
                      <path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8Z" />
                    </svg>
                    <a href="tel:+4570608689" className="hover:underline">70 60 86 89</a>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-brand-500">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m4 7 8 6 8-6" />
                    </svg>
                    <a href="mailto:info@fleeti.dk" className="hover:underline">info@fleeti.dk</a>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
