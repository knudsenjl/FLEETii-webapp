// Top-level route table for the whole app. Every authenticated route is
// wrapped in <ProtectedRoute> (optionally with requireAdmin) which redirects
// unauthenticated users to "/" and shows a "forbidden" notice to non-admins
// on admin-only routes. "/about" is the one deliberately public route (it
// must be reachable from LoginPage before a user has signed in).
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
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
import { TwoHireTestPage } from "./pages/TwoHireTestPage";
import { AdminFrontpage } from "./pages/AdminFrontpage";
import { CostumerAdministrationPage } from "./pages/CostumerAdministrationPage";
import { InstallationAdministrationPage } from "./pages/InstallationAdministrationPage";
import { CostumerDetailsPage } from "./pages/CostumerDetailsPage";
import { DepartmentDetailsPage } from "./pages/DepartmentDetailsPage";
import { EditDepartmentsPage } from "./pages/EditDepartmentsPage";
import { DepartmentPage } from "./pages/DepartmentPage";
import { FleetManagementPage } from "./pages/FleetManagementPage";
import { HandleVehiclePage } from "./pages/HandleVehiclePage";
import { UserDetailsPage } from "./pages/UserDetailsPage";
import { VehiclesPage } from "./pages/VehiclesPage";
import { VehicleDetailsPage } from "./pages/VehicleDetailsPage";
import { NewVehiclePage } from "./pages/NewVehiclePage";
import { VehicleCreatePage } from "./pages/VehicleCreatePage";
import { VehicleDeletePage } from "./pages/VehicleDeletePage";
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
 * showing the login form again. A "FLEETii admin" role now lands on "/admin"
 * too, same as a regular admin (it's a superset of "admin" — see
 * ProtectedRoute's requireAdmin check) — AdminFrontpage.tsx shows them two
 * extra buttons ("FLEETii admin: Administration af kunder"/"...installationer")
 * onward to "/fleetii-admin"/"/fleetii-admin-installations" when they
 * actually need it, rather than defaulting there on every login.
 * Renders LoginPage while loading or once it's confirmed there's no session.
 */
function RootRoute() {
  const { loading, isFullyAuthenticated, profile, mustChangePassword, isPasswordRecovery } = useAuth();

  if (!loading && isFullyAuthenticated) {
    if (mustChangePassword || isPasswordRecovery) {
      return <Navigate to="/set-password" replace />;
    }
    return (
      <Navigate
        to={profile?.role === "admin" || profile?.role === "FLEETii admin" ? "/admin" : "/bookings"}
        replace
      />
    );
  }

  return <LoginPage />;
}

/**
 * Resets the window's scroll position to the top on every route change.
 * Plain <BrowserRouter> (main.tsx) does NOT do this on its own — without
 * it, navigating away from a page the user had scrolled down (e.g.
 * LoginPage on a small/mobile viewport, where the form can push below the
 * fold) leaves the NEXT page starting at that same scroll offset too,
 * hiding its own PageHeader above the fold until the user manually scrolls
 * up (or zooms out, which removes the need to scroll at all).
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Root component: wraps the whole route tree in the two app-wide providers (auth session/profile, and 2hire vehicle/GPS telemetry) and declares every route. */
function App() {
  return (
    <AuthProvider>
      <VehicleProvider>
        <ScrollToTop />
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
            path="/booking-details/:bookingId"
            element={
              <ProtectedRoute>
                <BookingDetailsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/2hire-test"
            element={
              <ProtectedRoute requireAdmin>
                <TwoHireTestPage />
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
                <CostumerAdministrationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleetii-admin-installations"
            element={
              <ProtectedRoute requireRole="FLEETii admin">
                <InstallationAdministrationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/costumer-details"
            element={
              <ProtectedRoute requireRole="FLEETii admin">
                <CostumerDetailsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/costumer-details/:costumerId"
            element={
              <ProtectedRoute requireRole="FLEETii admin">
                <CostumerDetailsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/department-details"
            element={
              <ProtectedRoute requireRole="FLEETii admin">
                <DepartmentDetailsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/edit-departments"
            element={
              <ProtectedRoute requireAdmin>
                <EditDepartmentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vehicle-create"
            element={
              <ProtectedRoute requireRole="FLEETii admin">
                <VehicleCreatePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vehicle-create/:orderId"
            element={
              <ProtectedRoute requireRole="FLEETii admin">
                <VehicleCreatePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vehicle-delete"
            element={
              <ProtectedRoute requireRole="FLEETii admin">
                <VehicleDeletePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vehicle-delete/:orderId"
            element={
              <ProtectedRoute requireRole="FLEETii admin">
                <VehicleDeletePage />
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
            path="/user-details/:userId"
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
            path="/vehicle-details/:vehicleId"
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
            path="/settings-department"
            element={
              <ProtectedRoute requireRole="admin">
                <SettingsAdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings-user"
            element={
              <ProtectedRoute>
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
