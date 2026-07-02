import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { ReservationPage } from "./pages/ReservationPage";
import { AvailablePage } from "./pages/AvailablePage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { BookingsPage } from "./pages/BookingsPage";

function RootRoute() {
  const { loading, isFullyAuthenticated } = useAuth();

  if (!loading && isFullyAuthenticated) {
    return <Navigate to="/bookings" replace />;
  }

  return <LoginPage />;
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route
          path="/reservation"
          element={
            <ProtectedRoute>
              <ReservationPage />
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
        <Route
          path="/confirm"
          element={
            <ProtectedRoute>
              <ConfirmPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bookings"
          element={
            <ProtectedRoute>
              <BookingsPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
