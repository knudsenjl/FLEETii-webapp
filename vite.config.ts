import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// The app's Content-Security-Policy (code review 2026-09-26). Enforced as a
// <meta> tag written into the BUILT index.html only — not as a netlify.toml
// header — because `netlify dev` applies netlify.toml's headers to the Vite
// dev server too, whose React refresh preamble is an inline <script> that
// `script-src 'self'` would block, breaking local development. The built app
// has no inline scripts (verified: 0 violations across 13 staging pages while
// this ran report-only, 2026-09-27). Sources: Supabase REST + realtime
// websocket, Google Fonts (index.html), OpenStreetMap tiles (LeafletMap.tsx),
// the QR scanner's blob: worker (qr-scanner), inline style attributes
// (React/framer-motion). frame-ancestors can't be set from a <meta> tag, so it
// stays a header in netlify.toml.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/** Adds CONTENT_SECURITY_POLICY as the first <meta> in the built index.html (build only — see above). */
function contentSecurityPolicyMeta(): Plugin {
  return {
    name: 'fleetii-content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    contentSecurityPolicyMeta(),
    react(),
    tailwindcss(),
    VitePWA({
      // manifest.json is hand-written (public/manifest.json, linked from
      // index.html) — this plugin only adds the service worker on top of
      // it, so it doesn't generate or manage the manifest itself.
      manifest: false,
      // Precaches the app shell (JS/CSS/HTML/icons) so a repeat visit —
      // especially from the home-screen shortcut the manifest enables —
      // loads instantly from the cache instead of re-fetching everything.
      // Deliberately does NOT add any runtimeCaching rules: Supabase and
      // the Netlify Functions (booking data, lock/unlock commands, GPS)
      // must always hit the network, never a cached response, so this is
      // left at Workbox's default of only intercepting the precached
      // shell and letting every other request pass straight through.
      registerType: 'autoUpdate',
      workbox: {
        // The manuals (public/manualer/*.html) are ~2.2 MB of embedded
        // screenshots that most sessions never open — precaching them
        // would bloat the service worker's install step for no benefit
        // to a typical visit, so they're left to load from the network
        // (still cached by the browser's normal HTTP cache) on demand.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        globIgnores: ['manualer/**', 'templates/**'],
        // vite-plugin-pwa's default navigateFallback catches EVERY
        // navigation request (no extension-based exclusion, unlike plain
        // workbox-build) and serves index.html for it — including a
        // target="_blank" open of a manual under public/manualer/, which is
        // a top-level navigation like any other. That silently replaced the
        // real static manual with a fresh, unauthenticated boot of the SPA
        // (looking like a forced logout) — most reliably reproducible on an
        // iOS home-screen install, where target="_blank" navigates the same
        // single, service-worker-controlled window instead of opening a
        // real new tab. Denylisting these two static-file directories (the
        // same ones globIgnores already keeps out of precaching, for the
        // same reason — see its own comment) makes the SW pass their
        // navigations straight through to the network instead.
        navigateFallbackDenylist: [/^\/manualer\//, /^\/templates\//],
      },
    }),
  ],
  // Fixed, non-default port + strictPort so this never silently shares/shifts
  // off of a port a sibling project's Vite server (default 5173) already holds
  // — `netlify dev` proxies to whatever port it finds first, so an ambiguous
  // port previously caused it to serve the wrong project.
  server: {
    port: 5183,
    strictPort: true,
  },
})
