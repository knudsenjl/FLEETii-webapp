// Application entry point. Mounts <App /> into the #root div (see index.html)
// inside a BrowserRouter (so client-side routing works — see App.tsx for the
// route table) and React's StrictMode (dev-only double-invoking of
// effects/render to help surface side-effect bugs early).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

// Dev-only: remove any service worker (and its Workbox precache) left on this
// origin by an earlier production build served on localhost (e.g. from dist/).
// The Vite dev server has no real sw.js — it answers that URL with the SPA's
// index.html — so the browser's own update check fails and the stale worker
// stays in control forever, serving the old cached app on every normal load
// and reload (only a hard refresh bypasses it). This load came through
// uncontrolled, so dropping the worker here makes every later load fresh.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) void registration.unregister()
  })
  if ('caches' in window) {
    void caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key)
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
