import logo from "../assets/fleetii-logo.png";

interface FleetiiLogoProps {
  className?: string;
}

export function FleetiiLogo({ className = "h-10 w-auto" }: FleetiiLogoProps) {
  return <img src={logo} alt="FLEETii" className={className} draggable={false} />;
}
