// Reverse-geocoding of a vehicle's GPS position into a human-readable
// address, shared by VehicleDetailsPage.tsx, BookingDetailsPage.tsx, and
// BookingPage.tsx (all show this in a row directly below their map).
import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

/**
 * Shape of geoapify-reverse-geocode.mts's own response — a thin proxy
 * around Geoapify's reverse-geocoding endpoint (see that Function's own doc
 * comment for why this goes through a server-side proxy at all: the API key
 * can't reach the client bundle).
 *
 * Previously used DAWA (Danmarks Adressers Web API, Denmark's own free,
 * no-API-key-required address registry) directly from the browser instead —
 * switched away from it because DAWA only covers Danish addresses, and this
 * fleet's vehicles do sometimes travel outside Denmark, which DAWA silently
 * returns nothing useful for.
 */
type ReverseGeocodeResponse = { address?: string | null; error?: string };

/**
 * Reverse-geocodes the given GPS position into a human-readable address,
 * refetching whenever the coordinates change. Pass `enabled: false` to skip
 * fetching entirely and clear any previous address (e.g. while a page-level
 * gate like `isAdmin` or "map not currently visible" is active) — callers
 * don't need to null out `position` themselves for that. Keyed on the raw
 * lat/lng rather than the position object's own identity, so an unrelated
 * re-render that produces a new-but-equal position object doesn't refire
 * the fetch.
 */
export function useReverseGeocode(
  position: { lat: number; lng: number } | null | undefined,
  enabled: boolean,
): { address: string | null; addressLoading: boolean } {
  const { session } = useAuth();
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
      `/.netlify/functions/geoapify-reverse-geocode?lat=${position.lat}&lng=${position.lng}`,
      {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      },
    )
      .then((response) => response.json() as Promise<ReverseGeocodeResponse>)
      .then((data) => {
        if (cancelled) return;
        setAddress(data.address ?? null);
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
  }, [enabled, position?.lat, position?.lng, session?.access_token]);

  return { address, addressLoading };
}
