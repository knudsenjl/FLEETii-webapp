import { supabase } from "../supabase";
import type { Vehicle2Hire, VehicleDataSource, VehicleGPS2Hire } from "./types";

// getGpsPositions() reads the `vehicle_signals` table, kept up to date by
// netlify/functions/2hire-webhook.mts (see supabase/vehicle_signals_table.sql
// for the RLS policy that allows this direct, authenticated browser read —
// the same pattern every other page uses for Supabase reads).
//
// getVehicles() has no real implementation yet: 2hire's Adapter API has no
// endpoint that returns vehicle metadata (alias, brand, model,
// connectivityProvider, iotIdentifier, tags) — PUT /api/v1/vehicle/register
// only ever returns a vehicleId. Populating Vehicle2Hire from a live source
// needs a separate, FLEETii-owned vehicle-metadata table and an admin flow
// to fill it in, which is out of scope for this pass.

/** VehicleDataSource backed by real 2hire signals for GPS; vehicle metadata isn't available from 2hire at all yet (see file header) so this half still fails loudly rather than silently falling back to mock data. */
export const liveVehicleDataSource: VehicleDataSource = {
  getVehicles(): Promise<Vehicle2Hire[]> {
    throw new Error(
      "Live 2hire-køretøjsmetadata (alias, mærke, model, ...) er ikke tilgængelig fra 2hire's API — kræver en separat FLEETii-vedligeholdt tabel. Sæt VITE_DATA_SOURCE=mockup-data indtil videre.",
    );
  },
  async getGpsPositions(): Promise<VehicleGPS2Hire[]> {
    const { data, error } = await supabase
      .from("vehicle_signals")
      .select("vehicle_id, lat, lng")
      .not("lat", "is", null)
      .not("lng", "is", null);

    if (error) {
      throw new Error(`Kunne ikke hente 2hire GPS-positioner: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      vehicleId: row.vehicle_id as string,
      lat: row.lat as number,
      lng: row.lng as number,
    }));
  },
};
