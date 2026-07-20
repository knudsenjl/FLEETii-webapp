// Route guard used in App.tsx's route table: gates every non-public route
// behind "must be logged in", "must have set a real password" (not still on
// the shared default from create-user.mts), and, for admin-only routes,
// "must have role admin or FLEETii admin" (requireAdmin) or, for a route
// restricted to one exact role (the three per-role settings pages, the
// FLEETii-admin dashboard), "must have exactly this role" (requireRole —
// unlike requireAdmin, "FLEETii admin" does NOT satisfy requireRole="admin",
// and vice versa). This is the app's client-side authorization boundary —
// the corresponding server-side boundary is Supabase RLS
// (supabase/rls_policies.sql) plus the requireAdmin() check in
// netlify/functions/_shared/serverAuth.ts for the Netlify Functions.
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "./FleetiiLogo";
import { Modal } from "./Modal";

/** Shown when a user's role doesn't satisfy a route's requireAdmin/requireRole check. Auto-redirects to "/" after 5 seconds. Deliberately role-agnostic wording — this guards routes restricted to admins, to "FLEETii admin" exactly, and (for the per-role settings pages) to "user" exactly, so it can't claim the page is "for administrators" when that isn't always true. */
function ForbiddenNotice() {
  const navigate = useNavigate();

  useEffect(() => {
    const timeout = setTimeout(() => navigate("/", { replace: true }), 5000);
    return () => clearTimeout(timeout);
  }, [navigate]);

  return (
    <Modal>
      <p className="text-center text-sm font-medium text-brand-800">
        Du har ikke tilladelse til at tilgå denne side.
      </p>
    </Modal>
  );
}

/**
 * Wraps a route element: shows a loading placeholder while the initial auth
 * check runs, redirects to "/" if there's no session, forces a session that
 * still has must_change_password set OR came from a "reset password" email
 * link (isPasswordRecovery — see AuthContext.tsx) to "/set-password" (before
 * anything else, including admin routes), shows ForbiddenNotice if
 * `requireAdmin` is set and the user's profile role isn't "admin" or
 * "FLEETii admin" (the latter is a superset of "admin" — see App.tsx's
 * RootRoute) — or if `requireRole` is set and the role isn't exactly that
 * value (unlike requireAdmin, no superset here — e.g. requireRole="admin"
 * rejects "FLEETii admin" too) — and otherwise renders `children` normally.
 */
export function ProtectedRoute({
  children,
  requireAdmin = false,
  requireRole,
}: {
  children: ReactNode;
  requireAdmin?: boolean;
  requireRole?: string;
}) {
  const { loading, isFullyAuthenticated, profile, mustChangePassword, isPasswordRecovery } = useAuth();
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

  if ((mustChangePassword || isPasswordRecovery) && location.pathname !== "/set-password") {
    return <Navigate to="/set-password" replace />;
  }

  if (requireAdmin && profile?.role !== "admin" && profile?.role !== "FLEETii admin") {
    return <ForbiddenNotice />;
  }

  if (requireRole !== undefined && profile?.role !== requireRole) {
    return <ForbiddenNotice />;
  }

  return <>{children}</>;
}
