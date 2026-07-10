import { useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "./FleetiiLogo";

function ForbiddenNotice() {
  const navigate = useNavigate();

  useEffect(() => {
    const timeout = setTimeout(() => navigate("/", { replace: true }), 5000);
    return () => clearTimeout(timeout);
  }, [navigate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-lg">
        <p className="text-sm font-medium text-brand-800">
          Du har ikke tilladelse til at tilgå denne side. Siden er udelukkende tilgængelig for administratorer.
        </p>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children, requireAdmin = false }: { children: ReactNode; requireAdmin?: boolean }) {
  const { loading, isFullyAuthenticated, profile } = useAuth();

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

  if (requireAdmin && profile?.role !== "admin") {
    return <ForbiddenNotice />;
  }

  return <>{children}</>;
}
