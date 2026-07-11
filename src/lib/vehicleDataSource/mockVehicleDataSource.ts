import vehicleData from "../../data/mock/2hireVehicleData.json";
import gpsData from "../../data/mock/2hireGPSData.json";
import type { Vehicle2Hire, VehicleDataSource, VehicleGPS2Hire } from "./types";

export const mockVehicleDataSource: VehicleDataSource = {
  getVehicles() {
    return Promise.resolve(vehicleData as Vehicle2Hire[]);
  },
  getGpsPositions() {
    return Promise.resolve(gpsData as VehicleGPS2Hire[]);
  },
};
