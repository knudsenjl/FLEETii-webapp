// This deploy's own public origin, for links in e-mails. Netlify sets URL
// (the site's main address — app.fleetii.dk / dev.fleetii.dk) on every
// Function invocation, and DEPLOY_PRIME_URL on deploy previews. The same
// `process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? …` was repeated in five
// Functions (code review 2026-09-26).

/** The site's origin, or null when Netlify didn't provide one (local tooling) — for callers that simply leave a link out then (the welcome e-mail). */
export function siteUrl(): string | null {
  return process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? null;
}

/** The site's origin, falling back to the staging site — for e-mails whose whole point is the link (order links, the drop-in guest link). */
export function siteBaseUrl(): string {
  return siteUrl() ?? "https://fleetii-webapp-staging.netlify.app";
}
