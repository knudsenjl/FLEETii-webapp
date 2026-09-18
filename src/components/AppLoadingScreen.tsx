// Full-viewport loading splash: shown by ProtectedRoute while the initial
// auth check runs, and by App.tsx's <Suspense> boundary while a lazy-loaded
// route chunk is still downloading — same visual either way, so a slow
// network doesn't produce two different-looking spinners back to back.
// Distinct from PageLoading.tsx (a per-record "still fetching" placeholder
// used inside an already-mounted detail page) — this one is the app shell's
// own loading state, before any page has mounted at all.
import { FleetiiLogo } from "./FleetiiLogo";

export function AppLoadingScreen() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-brand-50">
      <FleetiiLogo className="h-12 w-auto animate-pulse-slow" />
    </div>
  );
}
