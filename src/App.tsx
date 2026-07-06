import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { ReservationPage } from "./pages/ReservationPage";
import { AvailablePage } from "./pages/AvailablePage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { BookingsPage } from "./pages/BookingsPage";
import { AllBookingsPage } from "./pages/AllBookingsPage";
import { BookingDetailsPage } from "./pages/BookingDetailsPage";
import { AdminFrontpage } from "./pages/AdminFrontpage";
import { DepartmentPage } from "./pages/DepartmentPage";
import { FleetManagementPage } from "./pages/FleetManagementPage";
import { FleetPage } from "./pages/FleetPage";
import { HandleCarPage } from "./pages/HandleCarPage";
import { UserDetailsPage } from "./pages/UserDetailsPage";

function RootRoute() {
  const { loading, isFullyAuthenticated, profile } = useAuth();

  if (!loading && isFullyAuthenticated) {
    return (
      <Navigate
        to={profile?.role === "admin" ? "/admin" : "/bookings"}
        replace
      />
    );
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
        <Route
          path="/allbookings"
          element={
            <ProtectedRoute>
              <AllBookingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/booking-details"
          element={
            <ProtectedRoute>
              <BookingDetailsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminFrontpage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/department"
          element={
            <ProtectedRoute>
              <DepartmentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fleet-management"
          element={
            <ProtectedRoute>
              <FleetManagementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fleet"
          element={
            <ProtectedRoute>
              <FleetPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/handle-car"
          element={
            <ProtectedRoute>
              <HandleCarPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/user-details"
          element={
            <ProtectedRoute>
              <UserDetailsPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
