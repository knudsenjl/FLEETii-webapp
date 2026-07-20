// The FLEETii wordmark image, optionally clickable to jump to the user's
// role-appropriate home page. Used in PageHeader (linkToHome) and standalone
// on the loading/login screens (plain image).
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import logo from "../assets/fleetii-logo.png";

interface FleetiiLogoProps {
  className?: string;
  /** When true, clicking the logo navigates to the role-appropriate home page. */
  linkToHome?: boolean;
}

/** The role-appropriate home route for a given `user_profiles.role` — matches RootRoute's (App.tsx) and PageHeader's settingsPathForRole's handling of the same three roles. */
function homePathForRole(role?: string | null): string {
  if (role === "FLEETii admin") return "/fleetii-admin";
  return role === "admin" ? "/admin" : "/bookings";
}

/** Renders the FLEETii logo image, wrapped in a nav button when linkToHome is set. */
export function FleetiiLogo({ className = "h-10 w-auto", linkToHome = false }: FleetiiLogoProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const img = <img src={logo} alt="FLEETii" className={className} draggable={false} />;

  if (!linkToHome) return img;

  return (
    <button
      type="button"
      onClick={() => navigate(homePathForRole(profile?.role))}
      aria-label="Gå til forsiden"
    >
      {img}
    </button>
  );
}
