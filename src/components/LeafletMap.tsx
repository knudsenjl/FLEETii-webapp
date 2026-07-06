import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import fleetiiMarker from "../assets/fleetii-marker.png";

const fleetiiIcon = L.icon({
  iconUrl: fleetiiMarker,
  iconSize: [24, 30],
  iconAnchor: [12, 30],
  popupAnchor: [0, -30],
});

type LeafletMapProps = {
  lat: number;
  lng: number;
  zoom?: number;
  className?: string;
  extraMarkers?: { lat: number; lng: number }[];
};

export function LeafletMap({ lat, lng, zoom = 13, className, extraMarkers = [] }: LeafletMapProps) {
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
    const bindNotImplementedPopup = (marker: L.Marker) => {
      marker.bindPopup("Endnu ikke implementeret");
      marker.on("click", () => {
        marker.openPopup();
        setTimeout(() => marker.closePopup(), 3000);
      });
    };

    bindNotImplementedPopup(L.marker([lat, lng], { icon: fleetiiIcon }).addTo(map));
    extraMarkers.forEach((marker) => {
      bindNotImplementedPopup(L.marker([marker.lat, marker.lng], { icon: fleetiiIcon }).addTo(map));
    });

    if (extraMarkers.length > 0) {
      const bounds = L.latLngBounds([
        [lat, lng],
        ...extraMarkers.map((marker): [number, number] => [marker.lat, marker.lng]),
      ]);
      map.fitBounds(bounds, { padding: [40, 40] });
    }

    mapRef.current = map;

    // Container size can change after init (flex/animated layouts), which
    // Leaflet doesn't pick up on its own — without this the tiles render
    // at a stale (sometimes zero) size and the map appears blank.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, zoom]);

  return <div ref={containerRef} className={className} />;
}
