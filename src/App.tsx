// Top-level route table for the whole app. Every authenticated route is
// wrapped in <ProtectedRoute> (optionally with requireAdmin) which redirects
// unauthenticated users to "/" and shows a "forbidden" notice to non-admins
// on admin-only routes. "/about" is the one deliberately public route (it
// must be reachable from LoginPage before a user has signed in).
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { VehicleProvider } from "./contexts/VehicleContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { ReservationPage } from "./pages/ReservationPage";
import { AvailablePage } from "./pages/AvailablePage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { BookingsPage } from "./pages/BookingsPage";
import { AllBookingsPage } from "./pages/AllBookingsPage";
import { BookingDetailsPage } from "./pages/BookingDetailsPage";
import { AdminFrontpage } from "./pages/AdminFrontpage";
import { FleetiiAdministrationPage } from "./pages/FleetiiAdministrationPage";
import { DepartmentPage } from "./pages/DepartmentPage";
import { FleetManagementPage } from "./pages/FleetManagementPage";
import { HandleVehiclePage } from "./pages/HandleVehiclePage";
import { UserDetailsPage } from "./pages/UserDetailsPage";
import { VehiclesPage } from "./pages/VehiclesPage";
import { VehicleDetailsPage } from "./pages/VehicleDetailsPage";
import { NewVehiclePage } from "./pages/NewVehiclePage";
import { AboutPage } from "./pages/AboutPage";
import { SettingsSuperadminPage } from "./pages/SettingsSuperadminPage";
import { SettingsAdminPage } from "./pages/SettingsAdminPage";
import { SettingsUserPage } from "./pages/SettingsUserPage";
import { SetPasswordPage } from "./pages/SetPasswordPage";

/**
 * The "/" route. Once the initial auth check finishes, sends a signed-in
 * user to "/set-password" if they still have the shared default password
 * (see create-user.mts) or their session came from a "reset password" email
 * link (isPasswordRecovery — see AuthContext.tsx; this is also where a
 * clicked recovery link's redirect_to actually lands), otherwise straight
 * to their role's home page (admin dashboard vs. bookings list) instead of
 * showing the login form again. A "FLEETii admin" role lands on
 * "/fleetii-admin" instead of the regular admin dashboard (it's a superset
 * of "admin" — see ProtectedRoute's requireAdmin check). Renders LoginPage
 * while loading or once it's confirmed there's no session.
 */
function RootRoute() {
  const { loading, isFullyAuthenticated, profile, mustChangePassword, isPasswordRecovery } = useAuth();

  if (!loading && isFullyAuthenticated) {
    if (mustChangePassword || isPasswordRecovery) {
      return <Navigate to="/set-password" replace />;
    }
    if (profile?.role === "FLEETii admin") {
      return <Navigate to="/fleetii-admin" replace />;
    }
    return (
      <Navigate
        to={profile?.role === "admin" ? "/admin" : "/bookings"}
        replace
      />
    );
  }

  return <LoginPage />;
}

/** Root component: wraps the whole route tree in the two app-wide providers (auth session/profile, and 2hire vehicle/GPS telemetry) and declares every route. */
function App() {
  return (
    <AuthProvider>
      <VehicleProvider>
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
              <ProtectedRoute requireAdmin>
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
              <ProtectedRoute requireAdmin>
                <AdminFrontpage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleetii-admin"
            element={
              <ProtectedRoute requireRole="FLEETii admin">
                <FleetiiAdministrationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/department"
            element={
              <ProtectedRoute requireAdmin>
                <DepartmentPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet-map"
            element={
              <ProtectedRoute requireAdmin>
                <FleetManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/edit-vehicle"
            element={
              <ProtectedRoute requireAdmin>
                <HandleVehiclePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/user-details"
            element={
              <ProtectedRoute requireAdmin>
                <UserDetailsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet-table"
            element={
              <ProtectedRoute requireAdmin>
                <VehiclesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vehicle-details"
            element={
              <ProtectedRoute>
                <VehicleDetailsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/new-vehicle"
            element={
              <ProtectedRoute requireAdmin>
                <NewVehiclePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/set-password"
            element={
              <ProtectedRoute>
                <SetPasswordPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings-superadmin"
            element={
              <ProtectedRoute requireRole="FLEETii admin">
                <SettingsSuperadminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings-admin"
            element={
              <ProtectedRoute requireRole="admin">
                <SettingsAdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings-user"
            element={
              <ProtectedRoute requireRole="user">
                <SettingsUserPage />
              </ProtectedRoute>
            }
          />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </VehicleProvider>
    </AuthProvider>
  );
}

export default App;
