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
import { DepartmentPage } from "./pages/DepartmentPage";
import { FleetManagementPage } from "./pages/FleetManagementPage";
import { HandleVehiclePage } from "./pages/HandleVehiclePage";
import { UserDetailsPage } from "./pages/UserDetailsPage";
import { VehiclesPage } from "./pages/VehiclesPage";
import { VehicleDetailsPage } from "./pages/VehicleDetailsPage";
import { NewVehiclePage } from "./pages/NewVehiclePage";
import { AboutPage } from "./pages/AboutPage";

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
            path="/bookingDetails"
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
            path="/handleVehicle"
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
            path="/vehicleDetails"
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
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </VehicleProvider>
    </AuthProvider>
  );
}

export default App;
