// The FLEETii wordmark image, optionally clickable to jump to the user's
// role-appropriate home page. Used in PageHeader (linkToHome) and standalone
// on the loading/login screens (plain image).
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isAnyAdmin } from "../lib/roles";
import logo from "../assets/fleetii-logo.png";

interface FleetiiLogoProps {
  className?: string;
  /** When true, clicking the logo navigates to the role-appropriate home page. */
  linkToHome?: boolean;
}

/** The role-appropriate home route for a given `user_profiles.role` — matches RootRoute's (App.tsx) handling of the same roles: "sysadm" now lands on "/admin" too, same as a regular admin (AdminFrontpage.tsx shows them a costumers table and "INSTALLATIONER" button directly, below a divider); role "user" lands on "/booking" (see BookingPage.tsx). Keep this in sync with RootRoute by hand — they're deliberately not sharing a single source since one runs inside a component (needs useAuth()) and the other doesn't. */
function homePathForRole(role?: string | null): string {
  if (isAnyAdmin(role)) return "/admin";
  return "/booking";
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
