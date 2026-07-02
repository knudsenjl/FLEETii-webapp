import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { LandingPage } from "./pages/LandingPage";
import { AvailablePage } from "./pages/AvailablePage";

function RootRoute() {
  const { loading, isFullyAuthenticated } = useAuth();

  if (!loading && isFullyAuthenticated) {
    return <Navigate to="/oversigt" replace />;
  }

  return <LoginPage />;
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route
          path="/oversigt"
          element={
            <ProtectedRoute>
              <LandingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/available"
          element={
            <ProtectedRoute>
              <AvailablePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
