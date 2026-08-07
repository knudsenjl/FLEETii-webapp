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

/** A small downward-pointing triangle in FLEETii navy (--color-brand-600) — used instead of the full FLEETii pin when showMarkerIcon is false (e.g. FleetManagementPage, whose permanent tooltip pills already carry the identifying text, so the full pin graphic is redundant clutter). The triangle's tip is the anchor, same convention as fleetiiIcon's own bottom-center anchor, so it still marks the exact lat/lng and a permanent tooltip's [0, -28] offset still lands in the same spot. The white drop-shadow keeps it visible against dark map tiles. */
const positionMarkerIcon = L.divIcon({
  className: "",
  html: '<div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid #18385b;filter:drop-shadow(0 0 1px white)"></div>',
  iconSize: [12, 9],
  iconAnchor: [6, 9],
  popupAnchor: [0, -9],
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
  markerTooltip?: string;
  /** Called when the primary marker is clicked; the marker just isn't clickable if omitted. */
  onMarkerClick?: () => void;
  /** Groups extraMarkers (and the primary marker) into a Leaflet marker cluster instead of showing them individually. */
  cluster?: boolean;
  /** Shows every marker's tooltip permanently above it instead of only on hover — hover has no equivalent on a touchscreen (iPhone/iPad), so a map relying on hover-only tooltips leaves those labels completely unreachable there. Off by default since a permanent label isn't always wanted (e.g. a single "you are here" marker doesn't need one). */
  permanentTooltips?: boolean;
  /** False renders every marker as a small FLEETii-blue position triangle instead of the full FLEETii pin — still clickable/tooltip-bearing, just a smaller position indicator. On by default. */
  showMarkerIcon?: boolean;
  /** Skips the very-first-mount fitBounds-to-every-marker behavior, using the lat/lng/zoom props as the initial view exactly as given instead — for a caller restoring a view it saved itself (via onViewChange) across an unmount/remount, e.g. FleetManagementPage after a browser-back from VehicleDetailsPage. Off by default (the normal "fit everything on first load" behavior). */
  skipInitialFitBounds?: boolean;
  /** Fired whenever the map's own center/zoom settles (Leaflet's "moveend" — covers the initial view, a user's own pan/zoom, and every programmatic setView/fitBounds alike). Lets a caller remember what the admin was actually looking at across an unmount, since this component's own view-preservation refs (see below) only survive re-renders, not a full unmount/remount — e.g. FleetManagementPage snapshots the latest value into router state right before navigating to VehicleDetailsPage, so browser-back can restore it instead of recentering on the fleet's default fit-all-vehicles view. */
  onViewChange?: (view: { lat: number; lng: number; zoom: number }) => void;
};

/** Renders an OpenStreetMap tile map with a primary marker and optional extra markers/clustering. See LeafletMapProps for what each prop controls. */
export function LeafletMap({
  lat,
  lng,
  zoom = 13,
  className,
  extraMarkers = [],
  showMarker = true,
  markerTooltip,
  onMarkerClick,
  cluster = false,
  permanentTooltips = false,
  showMarkerIcon = true,
  skipInitialFitBounds = false,
  onViewChange,
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
  // Same reasoning as onMarkerClickRef just above.
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
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
  // Every prop change below tears down and rebuilds the WHOLE Leaflet map
  // (simplest way to keep marker/cluster/tooltip rendering in sync — see the
  // effect's own dependency array), which would normally also reset pan/zoom
  // back to the lat/lng/zoom props on every single one of those changes —
  // e.g. FleetManagementPage's "Vis enkeltvis"/"Saml køretøjer" toggle only
  // changes `cluster`, not where the admin was actually looking, so
  // rebuilding from the props alone would zoom back out to all of Denmark
  // every time it's pressed. These two refs let the effect tell "the center/
  // zoom props themselves genuinely changed" (a real recenter, e.g. this
  // vehicle's live GPS position moved, or FleetManagementPage picked a new
  // primary vehicle) apart from "some other, non-view prop changed" (cluster,
  // tooltip config, marker positions/content) — only the former re-applies
  // the incoming lat/lng/zoom and re-fits bounds; the latter restores
  // whatever view the map actually had right before its teardown.
  const lastViewPropsRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  const savedViewRef = useRef<{ center: L.LatLngTuple; zoom: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const viewPropsUnchanged =
      lastViewPropsRef.current !== null &&
      lastViewPropsRef.current.lat === lat &&
      lastViewPropsRef.current.lng === lng &&
      lastViewPropsRef.current.zoom === zoom;
    const initialView =
      viewPropsUnchanged && savedViewRef.current ? savedViewRef.current : { center: [lat, lng] as L.LatLngTuple, zoom };

    const map = L.map(containerRef.current).setView(initialView.center, initialView.zoom);
    lastViewPropsRef.current = { lat, lng, zoom };
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    const clusterGroup = cluster ? L.markerClusterGroup().addTo(map) : null;
    const addMarkerToMap = (marker: L.Marker) => {
      if (clusterGroup) {
        clusterGroup.addLayer(marker);
      } else {
        marker.addTo(map);
      }
    };

    const icon = showMarkerIcon ? fleetiiIcon : positionMarkerIcon;
    // The -28 offset was tuned for fleetiiIcon's 30px height; positionMarkerIcon
    // is only 9px tall, so the same offset would leave a large gap between the
    // triangle and its tooltip.
    const tooltipOffset: [number, number] = showMarkerIcon ? [0, -28] : [0, -6];

    if (showMarker) {
      const marker = L.marker([lat, lng], { icon });
      addMarkerToMap(marker);
      // Binding the SAME logical click on both the marker and its own
      // interactive tooltip below (two genuinely separate Leaflet layers,
      // each independently registered with the map's own click-target
      // resolution) has been observed to occasionally fire the handler
      // twice for what the admin experiences as one physical click —
      // enough to push two history entries onto the router instead of one,
      // so a single browser-back landed back on the very page it came
      // from. Coalescing anything within the same 300ms swallows a
      // duplicate without ever being able to block two genuinely separate,
      // deliberate clicks.
      let lastHandledAt = 0;
      const handleClick = () => {
        const now = Date.now();
        if (now - lastHandledAt < 300) return;
        lastHandledAt = now;
        onMarkerClickRef.current?.();
      };
      if (markerTooltip) {
        // A PERMANENT tooltip is the actual visible, legible label the user
        // aims for (e.g. FleetManagementPage's "Køretøj-ID / Reg.nr" pill
        // sitting above the tiny positionMarkerIcon triangle) — by default a
        // Leaflet tooltip is `pointer-events: none` and purely decorative, so
        // a click that lands on the label itself (very easy to do, given how
        // small the triangle icon is beneath/beside it) would silently fall
        // through to the map instead of registering as a marker click.
        // `interactive: true` plus forwarding its own "click" here makes the
        // label just as clickable as the marker it's attached to. A
        // non-permanent (hover-only) tooltip skips this — the cursor is
        // already over the marker's own hit area whenever it's visible.
        marker.bindTooltip(markerTooltip, {
          direction: "top",
          offset: tooltipOffset,
          permanent: permanentTooltips,
          interactive: permanentTooltips,
        });
        if (permanentTooltips) marker.getTooltip()?.on("click", handleClick);
      }
      marker.on("click", handleClick);
    }
    extraMarkers.forEach((marker) => {
      const extraMarker = L.marker([marker.lat, marker.lng], { icon });
      addMarkerToMap(extraMarker);
      // See the primary marker's identical handling (including the
      // dedupe-guard comment) just above.
      let lastHandledAt = 0;
      const handleExtraClick = () => {
        const now = Date.now();
        if (now - lastHandledAt < 300) return;
        lastHandledAt = now;
        marker.onClick?.();
      };
      if (marker.tooltip) {
        extraMarker.bindTooltip(marker.tooltip, {
          direction: "top",
          offset: tooltipOffset,
          permanent: permanentTooltips,
          interactive: permanentTooltips,
        });
        if (permanentTooltips && marker.onClick) {
          extraMarker.getTooltip()?.on("click", handleExtraClick);
        }
      }
      if (marker.onClick) {
        extraMarker.on("click", handleExtraClick);
      }
    });

    // Only fits to every marker's bounds on a genuine center/zoom prop
    // change (or the very first mount) — a rebuild triggered by some OTHER
    // prop (cluster, tooltip config, marker content) restores the saved view
    // above instead, and re-fitting here would immediately override that
    // right back out to fit everything again. skipInitialFitBounds opts a
    // fresh mount out of this too — see its own doc comment.
    if (!viewPropsUnchanged && !skipInitialFitBounds && extraMarkers.length > 0) {
      const bounds = L.latLngBounds([
        [lat, lng],
        ...extraMarkers.map((marker): [number, number] => [marker.lat, marker.lng]),
      ]);
      map.fitBounds(bounds, { padding: [40, 40] });
    }

    mapRef.current = map;

    // Reports the settled view back to the caller (see onViewChange's own
    // doc comment) — fires for the initial view too, harmlessly redundant
    // with whatever the caller already knew at that point.
    const handleMoveEnd = () => {
      const c = map.getCenter();
      onViewChangeRef.current?.({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    };
    map.on("moveend", handleMoveEnd);

    // Container size can change after init (flex/animated layouts), which
    // Leaflet doesn't pick up on its own — without this the tiles render
    // at a stale (sometimes zero) size and the map appears blank.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      // Captured before map.remove() (which tears down its internal state) —
      // read back above if the map gets rebuilt again purely due to a
      // non-view prop change, so that rebuild doesn't lose the user's pan/zoom.
      savedViewRef.current = { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() };
      map.remove();
      mapRef.current = null;
    };
    // extraMarkers itself is intentionally omitted — extraMarkersKey (a
    // content-based signature, see its own comment above) is the real
    // dependency here, so the rule's raw "extraMarkers"/"extraMarkers.length"
    // suggestion would be wrong (using the array reference directly would
    // rebuild the whole map on every caller re-render, see the comment above).
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, zoom, showMarker, markerTooltip, cluster, permanentTooltips, showMarkerIcon, skipInitialFitBounds, extraMarkersKey]);

  return <div ref={containerRef} className={className} />;
}
