import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import fleetiiMarker from "../assets/fleetii-marker.png";

const fleetiiIcon = L.icon({
  iconUrl: fleetiiMarker,
  iconSize: [36, 45],
  iconAnchor: [18, 45],
  popupAnchor: [0, -45],
});

type LeafletMapProps = {
  lat: number;
  lng: number;
  zoom?: number;
  className?: string;
};

export function LeafletMap({ lat, lng, zoom = 13, className }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(containerRef.current).setView([lat, lng], zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    L.marker([lat, lng], { icon: fleetiiIcon }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, zoom]);

  return <div ref={containerRef} className={className} />;
}
