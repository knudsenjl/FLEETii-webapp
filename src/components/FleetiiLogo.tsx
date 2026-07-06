import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import logo from "../assets/fleetii-logo.png";

interface FleetiiLogoProps {
  className?: string;
  /** When true, clicking the logo navigates to the role-appropriate home page. */
  linkToHome?: boolean;
}

export function FleetiiLogo({ className = "h-10 w-auto", linkToHome = false }: FleetiiLogoProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const img = <img src={logo} alt="FLEETii" className={className} draggable={false} />;

  if (!linkToHome) return img;

  return (
    <button
      type="button"
      onClick={() => navigate(profile?.role === "admin" ? "/admin" : "/bookings")}
      aria-label="Gå til forsiden"
    >
      {img}
    </button>
  );
}
