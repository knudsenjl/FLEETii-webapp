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
import { FleetPage } from "./pages/FleetPage";
import { HandleVehiclePage } from "./pages/HandleVehiclePage";
import { UserDetailsPage } from "./pages/UserDetailsPage";
import { VehiclesPage } from "./pages/VehiclesPage";
import { VehicleDetailsPage } from "./pages/VehicleDetailsPage";

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
              <ProtectedRoute>
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
            path="/handleVehicle"
            element={
              <ProtectedRoute>
                <HandleVehiclePage />
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
          <Route
            path="/vehicles"
            element={
              <ProtectedRoute>
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </VehicleProvider>
    </AuthProvider>
  );
}

export default App;
