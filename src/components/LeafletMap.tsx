// Thin React wrapper around a plain Leaflet map. Leaflet manages its own DOM
// inside containerRef imperatively (not through React's render cycle), so
// the map is created once in a "structural" effect and torn down on
// unmount/structural-prop change — see that effect's own dependency-array
// comment for exactly which prop changes are allowed to trigger that
// teardown/rebuild. Marker POSITION changes (e.g. FleetManagementPage's
// Live-toggle polling every 10s) deliberately do NOT go through that
// effect at all — see the position-sync effect further down — so a live
// GPS update just slides the existing marker to its new spot instead of
// tearing down and redrawing the whole map (tiles included), which used to
// look like the whole thing "blinking" every poll.
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

type ExtraMarker = {
  /** Stable per-marker identity (e.g. a vehicleId) — used to match this marker back to the SAME Leaflet marker instance across a position-only update (see the position-sync effect below), so a live GPS poll can't accidentally reposition the wrong marker if the caller's own array happens to reorder between renders (e.g. an unordered DB query). Falls back to `tooltip` when omitted — callers that never reposition markers after creation (i.e. everyone except FleetManagementPage.tsx today) don't need to set this. */
  id?: string;
  lat: number;
  lng: number;
  tooltip?: string;
  onClick?: () => void;
};

type LeafletMapProps = {
  /** Center coordinate — also the primary marker's position when showMarker is true, UNLESS markerLat/markerLng are given (see their own doc comment). */
  lat: number;
  lng: number;
  zoom?: number;
  /** The primary marker's actual position, when it needs to differ from `lat`/`lng` (the map's own center) — e.g. VehicleDetailsPage.tsx/BookingDetailsPage.tsx/BookingPage.tsx restoring a saved pan/zoom across a browser refresh (see useMapViewSnapshot), or FleetManagementPage.tsx keeping the map's own center pinned to whichever vehicle is "primary" while the marker itself tracks that vehicle's live position independently (see this component's position-sync effect below for how a change here moves the marker WITHOUT recentering the map or rebuilding anything). Defaults to `lat`/`lng` (the marker sits exactly where the map is centered) — the original behavior any caller that doesn't set these still gets. */
  markerLat?: number;
  markerLng?: number;
  className?: string;
  /** Additional markers besides the primary one (e.g. every vehicle on the fleet map besides the "primary"/selected one). */
  extraMarkers?: ExtraMarker[];
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
  /** Optional "Live" toggle control, stacked below Recenter (which is itself below Leaflet's own zoom buttons) — LeafletMap has no opinion on what "live" means (polling, a Realtime subscription, etc.); it just renders the button and reports clicks via `onToggle`, and highlights it whenever `active` is true. Omitted entirely (no button rendered) when this prop isn't given — see FleetManagementPage.tsx for the one caller that currently uses it. */
  liveToggle?: { active: boolean; onToggle: () => void };
};

/** Renders an OpenStreetMap tile map with a primary marker and optional extra markers/clustering. See LeafletMapProps for what each prop controls. */
export function LeafletMap({
  lat,
  lng,
  zoom = 13,
  markerLat,
  markerLng,
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
  liveToggle,
}: LeafletMapProps) {
  // Falls back to the map's own center whenever markerLat/markerLng aren't
  // given — see their own doc comment above.
  const effectiveMarkerLat = markerLat ?? lat;
  const effectiveMarkerLng = markerLng ?? lng;
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
  // Same reasoning again — liveToggle.onToggle is read through a ref so the
  // main effect below only needs to care about WHETHER a live toggle exists
  // (hasLiveToggle, a stable boolean) rather than the whole object, which is
  // typically a fresh literal every render.
  const onLiveToggleRef = useRef(liveToggle?.onToggle);
  onLiveToggleRef.current = liveToggle?.onToggle;
  const hasLiveToggle = liveToggle !== undefined;
  // The Live button's own DOM node, so the lightweight effect below can
  // restyle it in place (active/inactive) without tearing down and
  // rebuilding the whole map just to reflect a toggle click.
  const liveButtonRef = useRef<HTMLElement | null>(null);
  // The primary/extra marker instances + the cluster group (if any), from
  // the most recent structural build — read (not reacted to) by the
  // position-sync effect below to reposition them in place. extraMarkers is
  // keyed by id (falling back to tooltip) rather than array index, so a
  // caller whose own array happens to reorder between polls (e.g. an
  // unordered DB query — see FleetManagementPage.tsx's own defensive sort)
  // still moves the RIGHT Leaflet marker instance rather than whichever one
  // happened to sit at the same index last time.
  const primaryMarkerRef = useRef<L.Marker | null>(null);
  const extraMarkerRefsById = useRef<Map<string, L.Marker>>(new Map());
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  // Content-based signature for extraMarkers' STRUCTURE (which vehicles are
  // present at all, and their tooltip text) — deliberately excludes lat/lng,
  // and deliberately SORTED (order-independent), so a live GPS poll (which
  // only ever changes position, and whose backing query has no guaranteed
  // row order — see FleetManagementPage.tsx) never counts as a structural
  // change on its own. The actual positions are handled entirely by the
  // separate, lightweight position-sync effect below instead of this
  // whole-map-rebuilding one.
  const extraMarkersStructureKey = extraMarkers
    .map((m) => `${m.id ?? m.tooltip ?? ""}:${m.tooltip ?? ""}`)
    .sort()
    .join("|");
  // Every prop change below tears down and rebuilds the WHOLE Leaflet map
  // (simplest way to keep marker/cluster/tooltip rendering in sync — see the
  // effect's own dependency array), which would normally also reset pan/zoom
  // back to the lat/lng/zoom props on every single one of those changes —
  // e.g. FleetManagementPage's "Vis enkeltvis"/"Saml køretøjer" toggle only
  // changes `cluster`, not where the admin was actually looking, so
  // rebuilding from the props alone would zoom back out to all of Denmark
  // every time it's pressed. These two refs let the effect tell "the center/
  // zoom props themselves genuinely changed" (a real recenter, e.g. a picker
  // choosing a new primary vehicle) apart from "some other, non-view prop
  // changed" (cluster, tooltip config, marker structure) — only the former
  // re-applies the incoming lat/lng/zoom and re-fits bounds; the latter
  // restores whatever view the map actually had right before its teardown.
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
    clusterGroupRef.current = clusterGroup;
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
      const marker = L.marker([effectiveMarkerLat, effectiveMarkerLng], { icon });
      addMarkerToMap(marker);
      primaryMarkerRef.current = marker;
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

      // "Recenter" control, stacked directly below Leaflet's own zoom
      // buttons (same "topleft" corner, added after the map's own default
      // zoom control so it renders underneath it) — now that a restored
      // pan/zoom (see markerLat/markerLng's own doc comment) can leave the
      // marker scrolled out of view entirely, there needs to be a one-click
      // way back to it without hunting for it by hand. Recenters only (does
      // not touch the current zoom level) — a plain L.Control rather than a
      // React element since this whole map is built imperatively; removed
      // automatically along with everything else on map.remove() below, no
      // separate cleanup needed.
      const RecenterControl = L.Control.extend({
        onAdd: () => {
          const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
          const button = L.DomUtil.create("a", "", container);
          button.href = "#";
          button.title = "Centrer på køretøjet";
          button.setAttribute("aria-label", "Centrer på køretøjet");
          button.style.display = "flex";
          button.style.alignItems = "center";
          button.style.justifyContent = "center";
          button.innerHTML =
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';
          L.DomEvent.disableClickPropagation(container);
          L.DomEvent.on(button, "click", (event) => {
            L.DomEvent.preventDefault(event);
            const target: L.LatLngExpression =
              primaryMarkerRef.current?.getLatLng() ?? [effectiveMarkerLat, effectiveMarkerLng];
            map.setView(target, map.getZoom());
          });
          return container;
        },
      });
      new RecenterControl({ position: "topleft" }).addTo(map);
    } else {
      primaryMarkerRef.current = null;
    }

    // "Live" toggle control, stacked below Recenter (added right after it,
    // same "topleft" corner) — unlike Recenter, not gated on showMarker: its
    // presence shouldn't flicker in/out as a filter transiently narrows the
    // visible markers down to zero. LeafletMap itself has no opinion on what
    // "live" means (see liveToggle's own doc comment) — this control is
    // purely the button; a separate, lightweight effect below (not this
    // whole-map-rebuilding one) keeps its highlighted/plain styling in sync
    // with liveToggle.active without tearing anything down.
    if (hasLiveToggle) {
      const LiveControl = L.Control.extend({
        onAdd: () => {
          const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
          const button = L.DomUtil.create("a", "", container);
          button.href = "#";
          button.title = "Vis GPS-positioner live";
          button.setAttribute("aria-label", "Vis GPS-positioner live");
          button.style.display = "flex";
          button.style.alignItems = "center";
          button.style.justifyContent = "center";
          button.innerHTML =
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M8.5 8.5a5 5 0 0 0 0 7"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M5.5 5.5a9 9 0 0 0 0 13"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
          L.DomEvent.disableClickPropagation(container);
          L.DomEvent.on(button, "click", (event) => {
            L.DomEvent.preventDefault(event);
            onLiveToggleRef.current?.();
          });
          liveButtonRef.current = button;
          return container;
        },
      });
      new LiveControl({ position: "topleft" }).addTo(map);
    }

    const extraMarkerRefs = new Map<string, L.Marker>();
    extraMarkers.forEach((marker, index) => {
      const extraMarker = L.marker([marker.lat, marker.lng], { icon });
      addMarkerToMap(extraMarker);
      extraMarkerRefs.set(marker.id ?? marker.tooltip ?? String(index), extraMarker);
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
    extraMarkerRefsById.current = extraMarkerRefs;

    // Only fits to every marker's bounds on a genuine center/zoom prop
    // change (or the very first mount) — a rebuild triggered by some OTHER
    // prop (cluster, tooltip config, marker structure) restores the saved
    // view above instead, and re-fitting here would immediately override
    // that right back out to fit everything again. skipInitialFitBounds
    // opts a fresh mount out of this too — see its own doc comment.
    if (!viewPropsUnchanged && !skipInitialFitBounds && extraMarkers.length > 0) {
      const bounds = L.latLngBounds([
        [effectiveMarkerLat, effectiveMarkerLng],
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
      liveButtonRef.current = null;
      primaryMarkerRef.current = null;
      extraMarkerRefsById.current = new Map();
      clusterGroupRef.current = null;
    };
    // extraMarkers itself is intentionally omitted — extraMarkersStructureKey
    // (a content-based signature, see its own comment above) is the real
    // dependency here, so the rule's raw "extraMarkers"/"extraMarkers.length"
    // suggestion would be wrong (using the array reference directly would
    // rebuild the whole map on every caller re-render, see the comment
    // above). markerLat/markerLng are ALSO deliberately omitted — a
    // position-only change is handled entirely by the effect below instead,
    // without tearing down and rebuilding the map at all.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    lat,
    lng,
    zoom,
    showMarker,
    markerTooltip,
    cluster,
    permanentTooltips,
    showMarkerIcon,
    skipInitialFitBounds,
    extraMarkersStructureKey,
    hasLiveToggle,
  ]);

  // Restyles the Live button in place (green when active, plain otherwise)
  // whenever liveToggle.active changes — deliberately its own effect rather
  // than a dependency of the main one above, which would tear down and
  // rebuild the entire map (tiles, markers, both controls) just to reflect
  // a toggle click. Runs after the main effect on the same commit (later
  // declaration order), so liveButtonRef.current is already set by the time
  // this reads it, including on the very first mount.
  useEffect(() => {
    const button = liveButtonRef.current;
    if (!button) return;
    const active = liveToggle?.active ?? false;
    button.style.color = active ? "#16a34a" : "";
    button.style.backgroundColor = active ? "#f0fdf4" : "";
  }, [liveToggle?.active]);

  // Content-based signature for extraMarkers' POSITIONS (id + lat/lng) —
  // triggers the position-sync effect below whenever any marker actually
  // moved, without needing the array reference itself as a dependency (same
  // "fresh array every render" reasoning as extraMarkersStructureKey above).
  const extraMarkersPositionKey = extraMarkers.map((m, i) => `${m.id ?? m.tooltip ?? i}:${m.lat}:${m.lng}`).join("|");

  // Moves the existing marker instances to their new positions IN PLACE
  // (Leaflet's Marker#setLatLng) instead of going through the structural
  // effect above — this is what lets FleetManagementPage's Live toggle (a
  // poll every 10s, see its own doc comment) just slide markers to their
  // new spot rather than tearing down and redrawing the whole map (tile
  // layer included) on every update, which is what used to make the map
  // visibly "blink". Cluster mode needs an explicit refreshClusters() nudge
  // afterward — leaflet.markercluster doesn't recompute cluster membership
  // on its own just because a member marker moved.
  useEffect(() => {
    if (primaryMarkerRef.current) {
      primaryMarkerRef.current.setLatLng([effectiveMarkerLat, effectiveMarkerLng]);
    }
    extraMarkers.forEach((marker, index) => {
      extraMarkerRefsById.current.get(marker.id ?? marker.tooltip ?? String(index))?.setLatLng([marker.lat, marker.lng]);
    });
    clusterGroupRef.current?.refreshClusters();
    // extraMarkers itself is intentionally omitted — extraMarkersPositionKey
    // (a content-based signature) is the real dependency, same reasoning as
    // extraMarkersStructureKey above.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMarkerLat, effectiveMarkerLng, extraMarkersPositionKey]);

  return <div ref={containerRef} className={className} />;
}
