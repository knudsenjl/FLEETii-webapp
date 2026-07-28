-- One-time migration: seeds a single dedicated vehicle_profiles row used
-- only by TwoHireTestPage.tsx ("/2hire-test") for poking at the 2hire
-- integration (lock/unlock, live telemetry) without touching a real,
-- in-service vehicle. It's a copy of WB20418 (AUDI A3 (Breakout),
-- 2020-2025) with its own vehicle_id, a distinct number_plate (WB20499,
-- confirmed free), and NULL iot_id/costumer_id/department_id — it isn't a
-- real 2hire-registered device and isn't attached to any customer/
-- department, so it can't be reached by real 2hire webhook traffic or show
-- up in customer/department-scoped fleet views.
--
-- Safe to re-run: the insert upserts on vehicle_id (do update) rather than
-- failing on a second run.

insert into public.vehicle_profiles
  (vehicle_id, number_plate, iot_id, brand, model, model_year, costumer_id, department_id, created_at)
values
  ('3fc8bbd8-c55c-401d-aa3d-318f156363f1', 'WB20499', null, 'AUDI', 'A3 (Breakout)', '2020-2025', null, null, now())
on conflict (vehicle_id) do update set
  number_plate = excluded.number_plate,
  iot_id = excluded.iot_id,
  brand = excluded.brand,
  model = excluded.model,
  model_year = excluded.model_year,
  costumer_id = excluded.costumer_id,
  department_id = excluded.department_id;
