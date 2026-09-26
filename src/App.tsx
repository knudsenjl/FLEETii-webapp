// Top-level route table for the whole app. Every authenticated route is
// wrapped in <ProtectedRoute> (optionally with requireAdmin) which redirects
// unauthenticated users to "/" and shows a "forbidden" notice to non-admins
// on admin-only routes. "/about" (reachable from LoginPage before a user has
// signed in) and "/gaest" (a drop-in guest's emailed link — see
// GuestDrivePage.tsx) are the only deliberately public routes.
import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { VehicleProvider } from "./contexts/VehicleContext";
import { isAnyAdmin } from "./lib/roles";
import { AppLoadingScreen } from "./components/AppLoadingScreen";
import { ProtectedRoute } from "./components/ProtectedRoute";
// LoginPage is the one page loaded eagerly — it's what nearly every visit
// renders first (via RootRoute below), so it ships in the initial bundle
// instead of costing a round-trip through <Suspense> before anyone sees
// anything. Every other route is lazy — most visits only ever touch a
// handful of these, so there's no reason to make everyone download the
// admin/fleet-management/import pages (and their dependencies, e.g. Leaflet)
// up front.
import { LoginPage } from "./pages/LoginPage";
const ReservationPage = lazy(() => import("./pages/ReservationPage").then((m) => ({ default: m.ReservationPage })));
const AvailablePage = lazy(() => import("./pages/AvailablePage").then((m) => ({ default: m.AvailablePage })));
const ConfirmPage = lazy(() => import("./pages/ConfirmPage").then((m) => ({ default: m.ConfirmPage })));
const BookingsPage = lazy(() => import("./pages/BookingsPage").then((m) => ({ default: m.BookingsPage })));
const AllBookingsPage = lazy(() => import("./pages/AllBookingsPage").then((m) => ({ default: m.AllBookingsPage })));
const BookingDetailsPage = lazy(() =>
  import("./pages/BookingDetailsPage").then((m) => ({ default: m.BookingDetailsPage })),
);
const BookingPage = lazy(() => import("./pages/BookingPage").then((m) => ({ default: m.BookingPage })));
const AdminFrontpage = lazy(() => import("./pages/AdminFrontpage").then((m) => ({ default: m.AdminFrontpage })));
const CostumerAdministrationPage = lazy(() =>
  import("./pages/CostumerAdministrationPage").then((m) => ({ default: m.CostumerAdministrationPage })),
);
const InstallationAdministrationPage = lazy(() =>
  import("./pages/InstallationAdministrationPage").then((m) => ({ default: m.InstallationAdministrationPage })),
);
const CostumerDetailsPage = lazy(() =>
  import("./pages/CostumerDetailsPage").then((m) => ({ default: m.CostumerDetailsPage })),
);
const CostumerNewPage = lazy(() => import("./pages/CostumerNewPage").then((m) => ({ default: m.CostumerNewPage })));
const DepartmentDetailsPage = lazy(() =>
  import("./pages/DepartmentDetailsPage").then((m) => ({ default: m.DepartmentDetailsPage })),
);
const DepartmentPage = lazy(() => import("./pages/DepartmentPage").then((m) => ({ default: m.DepartmentPage })));
const FleetManagementPage = lazy(() =>
  import("./pages/FleetManagementPage").then((m) => ({ default: m.FleetManagementPage })),
);
const HandleVehiclePage = lazy(() =>
  import("./pages/HandleVehiclePage").then((m) => ({ default: m.HandleVehiclePage })),
);
const UserDetailsPage = lazy(() => import("./pages/UserDetailsPage").then((m) => ({ default: m.UserDetailsPage })));
const ImportUsersPage = lazy(() => import("./pages/ImportUsersPage").then((m) => ({ default: m.ImportUsersPage })));
const ImportVehiclesPage = lazy(() =>
  import("./pages/ImportVehiclesPage").then((m) => ({ default: m.ImportVehiclesPage })),
);
const VehiclesPage = lazy(() => import("./pages/VehiclesPage").then((m) => ({ default: m.VehiclesPage })));
const VehicleDetailsPage = lazy(() =>
  import("./pages/VehicleDetailsPage").then((m) => ({ default: m.VehicleDetailsPage })),
);
const NewVehiclePage = lazy(() => import("./pages/NewVehiclePage").then((m) => ({ default: m.NewVehiclePage })));
const VehicleCreatePage = lazy(() =>
  import("./pages/VehicleCreatePage").then((m) => ({ default: m.VehicleCreatePage })),
);
const VehicleDeletePage = lazy(() =>
  import("./pages/VehicleDeletePage").then((m) => ({ default: m.VehicleDeletePage })),
);
const DropInGuestPage = lazy(() => import("./pages/DropInGuestPage").then((m) => ({ default: m.DropInGuestPage })));
const GuestDrivePage = lazy(() => import("./pages/GuestDrivePage").then((m) => ({ default: m.GuestDrivePage })));
const AboutPage = lazy(() => import("./pages/AboutPage").then((m) => ({ default: m.AboutPage })));
const SettingsSuperadminPage = lazy(() =>
  import("./pages/SettingsSuperadminPage").then((m) => ({ default: m.SettingsSuperadminPage })),
);
const SettingsAdminPage = lazy(() =>
  import("./pages/SettingsAdminPage").then((m) => ({ default: m.SettingsAdminPage })),
);
const SetPasswordPage = lazy(() => import("./pages/SetPasswordPage").then((m) => ({ default: m.SetPasswordPage })));
const TwoHireCommandPage = lazy(() =>
  import("./pages/TwoHireCommandPage").then((m) => ({ default: m.TwoHireCommandPage })),
);

/**
 * The "/" route. Once the initial auth check finishes, sends a signed-in
 * user to "/set-password" if they still have the shared default password
 * (see create-user.mts) or their session came from a "reset password" email
 * link (isPasswordRecovery — see AuthContext.tsx; this is also where a
 * clicked recovery link's redirect_to actually lands), otherwise straight
 * to their role's home page instead of showing the login form again: role
 * "user" lands on "/booking" (their current/next booking, with a "Next"
 * button through to the full list — see BookingPage.tsx's own doc
 * comment), admin/sysadm land on "/admin". A "sysadm" role
 * lands on "/admin" too, same as a regular admin (it's a superset of "admin"
 * — see ProtectedRoute's requireAdmin check) — AdminFrontpage.tsx shows them
 * a costumers table and an "INSTALLATIONER" button (onward to
 * "/sysadm-installations") directly, below a divider, rather than a
 * separate hub page.
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
        to={isAnyAdmin(profile?.role) ? "/admin" : "/booking"}
        replace
      />
    );
  }

  return <LoginPage />;
}

/**
 * Old "/settings-user" bookmarks/links (that page was retired — see
 * UserDetailsPage.tsx's own doc comment) redirect here to the equivalent
 * self-view route instead of 404ing. Reads profile.user_id fresh from
 * useAuth() rather than baking it into the route itself, since a redirect
 * component can't take a router :param no one supplied. Falls back to "/"
 * in the (should-be-impossible, ProtectedRoute already guarantees a session)
 * case profile isn't loaded yet.
 */
function SettingsUserRedirect() {
  const { profile } = useAuth();
  return <Navigate to={profile?.user_id ? `/user-details/${profile.user_id}` : "/"} replace />;
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
        <Suspense fallback={<AppLoadingScreen />}>
          <Routes>
            <Route path="/" element={<RootRoute />} />
            <Route
              path="/drop-in"
              element={
                <ProtectedRoute requireAdmin>
                  <DropInGuestPage />
                </ProtectedRoute>
              }
            />
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
                <ProtectedRoute requireRole="user">
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
              path="/booking"
              element={
                <ProtectedRoute requireRole="user">
                  <BookingPage />
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
              path="/costumers"
              element={
                <ProtectedRoute requireRole="sysadm">
                  <CostumerAdministrationPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sysadm-installations"
              element={
                <ProtectedRoute requireRole="sysadm">
                  <InstallationAdministrationPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/2hire-command"
              element={
                <ProtectedRoute requireRole="sysadm">
                  <TwoHireCommandPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/costumer-new"
              element={
                <ProtectedRoute requireRole="sysadm">
                  <CostumerNewPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/costumer-details/:costumerId"
              element={
                <ProtectedRoute requireRole="sysadm">
                  <CostumerDetailsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/department-details"
              element={
                <ProtectedRoute requireAdmin>
                  <DepartmentDetailsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vehicle-create"
              element={
                <ProtectedRoute requireRole="sysadm">
                  <VehicleCreatePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vehicle-create/:orderId"
              element={
                <ProtectedRoute requireRole="sysadm">
                  <VehicleCreatePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vehicle-delete"
              element={
                <ProtectedRoute requireRole="sysadm">
                  <VehicleDeletePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vehicle-delete/:orderId"
              element={
                <ProtectedRoute requireRole="sysadm">
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
                <ProtectedRoute>
                  <UserDetailsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/import-users"
              element={
                <ProtectedRoute requireAdmin>
                  <ImportUsersPage />
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
              path="/import-vehicles"
              element={
                <ProtectedRoute requireAdmin>
                  <ImportVehiclesPage />
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
                <ProtectedRoute requireRole="sysadm">
                  <SettingsSuperadminPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/department-settings"
              element={
                <ProtectedRoute requireAdmin>
                  <SettingsAdminPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings-user"
              element={
                <ProtectedRoute>
                  <SettingsUserRedirect />
                </ProtectedRoute>
              }
            />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/gaest" element={<GuestDrivePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </VehicleProvider>
    </AuthProvider>
  );
}

export default App;
