// Reverse-geocoding of a vehicle's GPS position into a human-readable
// address, shared by VehicleDetailsPage.tsx and BookingDetailsPage.tsx (both
// show this in a row directly below their map).
import { useEffect, useState } from "react";

/**
 * Shape of a DAWA (Danmarks Adressers Web API, api.dataforsyningen.dk —
 * Denmark's own free, authoritative, no-API-key-required address registry)
 * `/adgangsadresser/reverse` response — only the fields needed to format
 * "street number, postal code city" for the row below the map.
 *
 * Used INSTEAD OF Nominatim/OSM here (unlike LeafletMap's tiles, which
 * still come from OSM) — Nominatim's `suburb`/`town`/`city` tags are
 * crowdsourced and don't reliably match Denmark's actual registered postal
 * town per postcode (confirmed wrong twice: "Sydbyen" instead of
 * "Silkeborg" for 8600, and "Strømmen" instead of "Randers NØ" for 8930).
 * DAWA's `postnummer.navn` IS that official registered name directly, no
 * suburb-vs-town guessing needed. Every FLEETii vehicle is in Denmark, so
 * there's no coverage gap from dropping Nominatim's worldwide reach here.
 */
type DawaReverseResponse = {
  vejstykke?: { navn?: string };
  husnr?: string;
  postnummer?: { nr?: string; navn?: string };
};

/** Formats a DAWA reverse-geocoding response as "street number, postal code city" (e.g. "Vejnavn 12, 8000 Aarhus C"), omitting any parts that are missing. Falls back to null if nothing usable came back at all. */
function formatDawaAddress(data: DawaReverseResponse | null): string | null {
  if (!data) return null;
  const street = [data.vejstykke?.navn, data.husnr].filter(Boolean).join(" ");
  const place = [data.postnummer?.nr, data.postnummer?.navn].filter(Boolean).join(" ");
  const parts = [street, place].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Reverse-geocodes the given GPS position (DAWA) into a human-readable
 * address, refetching whenever the coordinates change. Pass `enabled: false`
 * to skip fetching entirely and clear any previous address (e.g. while a
 * page-level gate like `isAdmin` or "map not currently visible" is active) —
 * callers don't need to null out `position` themselves for that. Keyed on
 * the raw lat/lng rather than the position object's own identity, so an
 * unrelated re-render that produces a new-but-equal position object doesn't
 * refire the fetch.
 */
export function useReverseGeocode(
  position: { lat: number; lng: number } | null | undefined,
  enabled: boolean,
): { address: string | null; addressLoading: boolean } {
  const [address, setAddress] = useState<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !position) {
      setAddress(null);
      return;
    }

    let cancelled = false;
    setAddressLoading(true);

    void fetch(
      `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${position.lng}&y=${position.lat}`,
    )
      .then((response) => response.json() as Promise<DawaReverseResponse>)
      .then((data) => {
        if (cancelled) return;
        setAddress(formatDawaAddress(data));
      })
      .catch(() => {
        if (!cancelled) setAddress(null);
      })
      .finally(() => {
        if (!cancelled) setAddressLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, position?.lat, position?.lng]);

  return { address, addressLoading };
}
