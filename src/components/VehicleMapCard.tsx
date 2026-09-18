import { LeafletMap } from "./LeafletMap";
import { MapOverlayMessage } from "./MapOverlayMessage";

interface VehicleMapCardProps {
  lat: number;
  lng: number;
  zoom: number;
  markerLat: number;
  markerLng: number;
  /** Whether there's a real GPS fix — drives the marker, the "no GPS
   * position" overlay, and whether the address row below renders at all. */
  hasPosition: boolean;
  onViewChange?: (view: { lat: number; lng: number; zoom: number }) => void;
  markerTooltip: string;
  onMarkerClick?: () => void;
  liveToggle?: { active: boolean; onToggle: () => void };
  addressLoading: boolean;
  liveEnabled: boolean;
  address: string | null;
}

/** The vehicle-location map card (LeafletMap + "no GPS" overlay + a
 * reverse-geocoded address row underneath) shown on both BookingDetailsPage
 * and VehicleDetailsPage — previously two byte-for-byte identical copies,
 * each carrying a comment pointing at the other ("see X's identical wrapper
 * for why") instead of being centralized. `flex-1 flex-col gap-1` (not
 * `min-h-0`) on the outer wrapper is load-bearing: this wrapper's own
 * automatic minimum height must stay content-based, so it can never be
 * flex-shrunk below the map's explicit min-h-[12rem] floor. With min-h-0,
 * overflow-y-auto on the scrolling ancestor could let this wrapper collapse
 * toward zero while the map (bounded by its own min-height) still rendered
 * full-size — but since a shrunk PARENT doesn't clip a child sized by its
 * own min-height, the map would visually spill downward past where the
 * flex layout thought this wrapper ended, painting over whatever sits
 * directly below it (the Lås/Blink/Horn row on both pages). */
export function VehicleMapCard({
  lat,
  lng,
  zoom,
  markerLat,
  markerLng,
  hasPosition,
  onViewChange,
  markerTooltip,
  onMarkerClick,
  liveToggle,
  addressLoading,
  liveEnabled,
  address,
}: VehicleMapCardProps) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <div className="relative isolate min-h-[12rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
        <LeafletMap
          lat={lat}
          lng={lng}
          zoom={zoom}
          markerLat={markerLat}
          markerLng={markerLng}
          onViewChange={onViewChange}
          showMarker={hasPosition}
          markerTooltip={markerTooltip}
          onMarkerClick={onMarkerClick}
          className="absolute inset-0"
          liveToggle={liveToggle}
          followMarker
        />
        {!hasPosition && <MapOverlayMessage>Der er ingen GPS position tilgængelig for dette køretøj</MapOverlayMessage>}
      </div>

      {hasPosition && (
        <div className="w-full shrink-0 rounded-2xl border border-brand-100 bg-white px-3 py-1.5 text-center text-xs text-brand-600">
          {addressLoading ? "Henter adresse…" : liveEnabled ? "" : (address ?? "Ingen adresse fundet")}
        </div>
      )}
    </div>
  );
}
