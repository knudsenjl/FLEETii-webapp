import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "./FleetiiLogo";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { loading, isFullyAuthenticated } = useAuth();

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

  return <>{children}</>;
}
