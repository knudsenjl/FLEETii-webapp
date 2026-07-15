// Route guard used in App.tsx's route table: gates every non-public route
// behind "must be logged in", "must have set a real password" (not still on
// the shared default from create-user.mts), and, for admin-only routes,
// "must have role admin". This is the app's client-side authorization
// boundary — the corresponding server-side boundary is Supabase RLS
// (supabase/rls_policies.sql) plus the requireAdmin() check in
// netlify/functions/_shared/serverAuth.ts for the Netlify Functions.
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "./FleetiiLogo";
import { Modal } from "./Modal";

/** Shown when a non-admin lands on an admin-only route. Auto-redirects to "/" after 5 seconds. */
function ForbiddenNotice() {
  const navigate = useNavigate();

  useEffect(() => {
    const timeout = setTimeout(() => navigate("/", { replace: true }), 5000);
    return () => clearTimeout(timeout);
  }, [navigate]);

  return (
    <Modal>
      <p className="text-center text-sm font-medium text-brand-800">
        Du har ikke tilladelse til at tilgå denne side. Siden er udelukkende tilgængelig for administratorer.
      </p>
    </Modal>
  );
}

/**
 * Wraps a route element: shows a loading placeholder while the initial auth
 * check runs, redirects to "/" if there's no session, forces a session that
 * still has must_change_password set to "/set-password" (before anything
 * else, including admin routes), shows ForbiddenNotice if `requireAdmin` is
 * set and the user's profile role isn't "admin", and otherwise renders
 * `children` normally.
 */
export function ProtectedRoute({ children, requireAdmin = false }: { children: ReactNode; requireAdmin?: boolean }) {
  const { loading, isFullyAuthenticated, profile, mustChangePassword } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-brand-50">
        <FleetiiLogo className="h-12 w-auto animate-pulse-slow" />
      </div>
    );
  }

  if (!isFullyAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (mustChangePassword && location.pathname !== "/set-password") {
    return <Navigate to="/set-password" replace />;
  }

  if (requireAdmin && profile?.role !== "admin") {
    return <ForbiddenNotice />;
  }

  return <>{children}</>;
}
