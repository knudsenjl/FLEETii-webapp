// Thin React wrapper around a plain Leaflet map. Leaflet manages its own DOM
// inside containerRef imperatively (not through React's render cycle), so
// the map is created once in an effect and torn down on unmount/dependency
// change — see the dependency-array comment below for exactly which prop
// changes are allowed to trigger that teardown/rebuild.
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import fleetiiMarker from "../assets/fleetii-marker.png";

/** The FLEETii pin icon used for every marker on every map. */
const fleetiiIcon = L.icon({
  iconUrl: fleetiiMarker,
  iconSize: [24, 30],
  iconAnchor: [12, 30],
  popupAnchor: [0, -30],
});

type LeafletMapProps = {
  /** Center coordinate (also the primary marker's position when showMarker is true). */
  lat: number;
  lng: number;
  zoom?: number;
  className?: string;
  /** Additional markers besides the primary one (e.g. every vehicle on the fleet map besides the "primary"/selected one). */
  extraMarkers?: { lat: number; lng: number; tooltip?: string; onClick?: () => void }[];
  /** Whether to render a marker at lat/lng at all (false shows just the tiles, e.g. when no GPS fix exists). */
  showMarker?: boolean;
  /** Whether clicking the primary marker (with no onMarkerClick) should show a "not implemented" popup, vs. doing nothing. */
  markerClickable?: boolean;
  markerTooltip?: string;
  /** Called when the primary marker is clicked; if omitted, falls back to the "not implemented" popup when markerClickable is true. */
  onMarkerClick?: () => void;
  /** Groups extraMarkers (and the primary marker) into a Leaflet marker cluster instead of showing them individually. */
  cluster?: boolean;
};

/** Renders an OpenStreetMap tile map with a primary marker and optional extra markers/clustering. See LeafletMapProps for what each prop controls. */
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
  // Content-based signature for extraMarkers, used as the effect's actual
  // dependency below instead of the array reference — FleetManagementPage.tsx
  // passes a fresh `.map()` array every render even when the underlying
  // vehicle positions haven't moved, and depending on the array reference
  // directly would tear down and rebuild the whole Leaflet map (losing pan/
  // zoom, re-fitting bounds) on every one of those unrelated re-renders.
  // Click-handler identity isn't part of the signature — those are rebound
  // fresh every time the effect actually runs regardless, so their own
  // per-render identity churn shouldn't force a rebuild.
  const extraMarkersKey = extraMarkers.map((m) => `${m.lat}:${m.lng}:${m.tooltip ?? ""}`).join("|");

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
    // extraMarkers itself is intentionally omitted — extraMarkersKey (a
    // content-based signature, see its own comment above) is the real
    // dependency here, so the rule's raw "extraMarkers"/"extraMarkers.length"
    // suggestion would be wrong (using the array reference directly would
    // rebuild the whole map on every caller re-render, see the comment above).
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, zoom, showMarker, markerClickable, markerTooltip, cluster, extraMarkersKey]);

  return <div ref={containerRef} className={className} />;
}
