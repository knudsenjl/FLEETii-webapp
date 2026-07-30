// Frozen snapshot of each mock vehicle's ORIGINAL dynamic data, keyed by
// number_plate (the one identifier that survives across a 2hire migration —
// vehicle_id/iot_id both change). Sourced from vehicle_signals_backup_2026-07-30.csv,
// taken before any of these vehicles were touched by 2hire.
//
// Why this exists (found live, migrating CS30731): the live vehicle_signals
// row is NOT safe to read as "the value to push to 2hire" once ANY 2hire
// interaction has happened for that vehicle — 2hire's own default initial
// state (same for every simulated device: position ~41.9136,12.5007 — Rome,
// confirmed by 2hire's own docs, since 2hire is an Italian company) arrives
// via webhook and overwrites vehicle_signals.lat/lng/autonomy_percentage
// with that default. If a later retry (2hire-resync-vehicle.mts, or a
// migration whose first push attempt failed with MISSING_CONFIGURATION and
// only succeeded on a later retry) reads the LIVE row at that point, it
// pushes the already-corrupted default straight back to 2hire — a feedback
// loop that can never recover the real original value once overwritten.
// Pushing from this frozen snapshot instead sidesteps the race entirely.
//
// vehicle_signals.locked is NOT included here and doesn't need to be — it's
// never written by 2hire (no lock/door-state signal exists in their API at
// all), only by our own set-vehicle-lock.mts, so the live value is always
// safe to read directly.
export const ORIGINAL_VEHICLE_TELEMETRY: Record<string, { lat: number; lng: number; autonomyPercentage: number | null }> = {
  BI47381: { lat: 56.137056, lng: 8.988827, autonomyPercentage: 95 },
  BK80675: { lat: 55.653238, lng: 12.570959, autonomyPercentage: 69 },
  CH73533: { lat: 56.148938, lng: 10.217612, autonomyPercentage: 30 },
  CN61538: { lat: 55.471888, lng: 8.446795, autonomyPercentage: 76 },
  CS30731: { lat: 56.468701, lng: 10.051182, autonomyPercentage: 74 },
  DX82197: { lat: 55.711082, lng: 12.62266, autonomyPercentage: 90 },
  ED32823: { lat: 56.190617, lng: 10.178689, autonomyPercentage: 58 },
  EK28861: { lat: 55.678212, lng: 12.512592, autonomyPercentage: 100 },
  FN19113: { lat: 55.684331, lng: 12.571471, autonomyPercentage: 30 },
  GA74676: { lat: 56.196324, lng: 10.160637, autonomyPercentage: 100 },
  GO63328: { lat: 55.717594, lng: 12.600094, autonomyPercentage: 60 },
  HH44555: { lat: 55.855131, lng: 9.847961, autonomyPercentage: null },
  IP80601: { lat: 55.70271, lng: 12.642408, autonomyPercentage: 95 },
  IS10398: { lat: 55.69714, lng: 12.595721, autonomyPercentage: 39 },
  JW11539: { lat: 55.710258, lng: 12.495578, autonomyPercentage: 99 },
  JW80709: { lat: 56.168177, lng: 9.542291, autonomyPercentage: 80 },
  KD38830: { lat: 55.654836, lng: 12.647825, autonomyPercentage: 100 },
  KI94019: { lat: 55.631698, lng: 12.531347, autonomyPercentage: 45 },
  KM59225: { lat: 56.124308, lng: 10.202546, autonomyPercentage: 100 },
  LB15036: { lat: 55.626376, lng: 12.580666, autonomyPercentage: 33 },
  LW41426: { lat: 55.706601, lng: 12.506707, autonomyPercentage: 83 },
  MF47957: { lat: 57.0512, lng: 9.909364, autonomyPercentage: 92 },
  MW68263: { lat: 55.676596, lng: 12.61124, autonomyPercentage: 47 },
  NH46485: { lat: 56.181551, lng: 10.21406, autonomyPercentage: 82 },
  NL38682: { lat: 56.187923, lng: 10.171499, autonomyPercentage: 51 },
  NS73205: { lat: 56.189775, lng: 10.195251, autonomyPercentage: null },
  NX25399: { lat: 55.671221, lng: 12.533289, autonomyPercentage: 91 },
  PD91044: { lat: 56.124954, lng: 10.162391, autonomyPercentage: 32 },
  PR94408: { lat: 56.179061, lng: 10.246334, autonomyPercentage: 94 },
  QI73831: { lat: 55.485183, lng: 9.481625, autonomyPercentage: 100 },
  RK45113: { lat: 55.700636, lng: 9.521478, autonomyPercentage: 84 },
  RK65223: { lat: 55.662289, lng: 12.529313, autonomyPercentage: 95 },
  SO91536: { lat: 55.631006, lng: 12.52451, autonomyPercentage: 100 },
  SQ99026: { lat: 55.659802, lng: 12.592229, autonomyPercentage: 100 },
  UR89387: { lat: 55.634439, lng: 12.07597, autonomyPercentage: 95 },
  WB20418: { lat: 55.409938, lng: 10.405637, autonomyPercentage: 95 },
  XY94207: { lat: 55.701408, lng: 12.598609, autonomyPercentage: 100 },
  YA75862: { lat: 55.681615, lng: 12.592534, autonomyPercentage: 99 },
  YF30429: { lat: 55.636557, lng: 12.632213, autonomyPercentage: 74 },
  YI61058: { lat: 56.197867, lng: 10.172809, autonomyPercentage: 100 },
};
