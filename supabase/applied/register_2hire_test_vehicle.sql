-- One-time migration: reconciles the WB20499 test vehicle_profiles row (see
-- seed_2hire_test_vehicle.sql) with its now-real 2hire registration.
--
-- WB20499 was seeded with a locally-generated placeholder vehicle_id, since
-- at that point it wasn't a real 2hire-registered vehicle at all. It has
-- since been registered against 2hire's TEST adapter
-- (https://test.adapter.2hire.io) as a simulated 2hire-board device:
--   1. POST https://e2e.adapter.2hire.io/devices (connectivityProvider:
--      "2HIRE_BOARD") -> { identifier: "741482310302896",
--      qrCode: "MVQR_741482310302896" }
--   2. PUT https://test.adapter.2hire.io/api/v1/vehicle/register
--      (connectivityProvider: "2HIRE_BOARD", data: { qrCode, profileId:
--      "51ba5b28-28da-435a-b42e-a3931288470c" — the only profile the test
--      environment exposes, "Profile for 2hboard simulator" }) ->
--      { vehicleId: "6ae6ac0e-b918-4843-b3c4-eae02560c06b" }
-- (see netlify/functions/_shared/twoHireClient.ts's registerVehicle/
-- getTwoHireBoardProfiles for the reusable version of these two calls).
--
-- vehicle_id doubles as 2hire's own real vehicleId everywhere else in this
-- schema (see rename_vehicle_id_to_uuid.sql) — webhook signals and lock/
-- unlock commands only reach a vehicle if our row's vehicle_id matches what
-- 2hire assigned it, so the placeholder is swapped for the real one here.
-- iot_id is updated to the real device identifier for the same reason (see
-- seed_vehicle_profiles.sql's "2H..." convention — this simulator's
-- identifier doesn't follow that exact format, but it is the genuine
-- 2hire-assigned device id).
--
-- No vehicle_signals/vehicle_departments/bookings/vehicle_log rows reference
-- the placeholder id yet (confirmed before writing this), so a plain UPDATE
-- is safe — no cascading rename needed.

update public.vehicle_profiles
set
  vehicle_id = '6ae6ac0e-b918-4843-b3c4-eae02560c06b',
  iot_id = '741482310302896'
where vehicle_id = '3fc8bbd8-c55c-401d-aa3d-318f156363f1';
