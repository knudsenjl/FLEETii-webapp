import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
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
  extraMarkers?: { lat: number; lng: number; tooltip?: string; onClick?: () => void }[];
  showMarker?: boolean;
  markerClickable?: boolean;
  markerTooltip?: string;
  onMarkerClick?: () => void;
  cluster?: boolean;
};

export function LeafletMap({
  lat,
  lng,
  zoom = 13,
  className,
  extraMarkers = [],
  showMarker = true,
  markerClickable = true,
  markerTooltip,
  onMarkerClick,
  cluster = false,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // Callers routinely pass a fresh inline closure for onMarkerClick on every
  // render. Reading it through a ref (kept current here, during render) lets
  // the init effect below omit it from its dependency array — otherwise the
  // whole Leaflet map would be torn down and rebuilt (resetting pan/zoom) on
  // every unrelated re-render of the parent.
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

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

    const clusterGroup = cluster ? L.markerClusterGroup().addTo(map) : null;
    const addMarkerToMap = (marker: L.Marker) => {
      if (clusterGroup) {
        clusterGroup.addLayer(marker);
      } else {
        marker.addTo(map);
      }
    };

    if (showMarker) {
      const marker = L.marker([lat, lng], { icon: fleetiiIcon });
      addMarkerToMap(marker);
      if (markerTooltip) {
        marker.bindTooltip(markerTooltip, { direction: "top", offset: [0, -28] });
      }
      if (markerClickable) {
        marker.bindPopup("Endnu ikke implementeret");
      }
      marker.on("click", () => {
        if (onMarkerClickRef.current) {
          onMarkerClickRef.current();
        } else if (markerClickable) {
          marker.openPopup();
          setTimeout(() => marker.closePopup(), 3000);
        }
      });
    }
    extraMarkers.forEach((marker) => {
      const extraMarker = L.marker([marker.lat, marker.lng], { icon: fleetiiIcon });
      addMarkerToMap(extraMarker);
      if (marker.tooltip) {
        extraMarker.bindTooltip(marker.tooltip, { direction: "top", offset: [0, -28] });
      }
      if (marker.onClick) {
        extraMarker.on("click", marker.onClick);
      } else {
        bindNotImplementedPopup(extraMarker);
      }
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
  }, [lat, lng, zoom, showMarker, markerClickable, markerTooltip, cluster]);

  return <div ref={containerRef} className={className} />;
}
