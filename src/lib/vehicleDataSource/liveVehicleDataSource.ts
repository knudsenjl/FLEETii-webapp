import type { VehicleDataSource } from "./types";

// Intentional not-yet-implemented seam: once real 2hire API credentials are
// wired up (see TWOHIRE_CLIENT_ID/SECRET in .env.example), implement these
// methods to fetch live data — likely via a Netlify function, mirroring
// netlify/functions/create-user.mts, so the API credentials never reach the
// client bundle. Until then this fails loudly rather than silently falling
// back to mock data.
function notImplemented(): never {
  throw new Error(
    'Live 2hire-datakilde er ikke implementeret endnu. Sæt VITE_DATA_SOURCE=mock (eller udelad den) indtil rigtige 2hire API-oplysninger er koblet til.',
  );
}

export const liveVehicleDataSource: VehicleDataSource = {
  getVehicles() {
    notImplemented();
  },
  getGpsPositions() {
    notImplemented();
  },
};
