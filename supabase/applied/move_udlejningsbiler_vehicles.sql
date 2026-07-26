-- Test-data reshuffle: moves a random subset of Jonas Hjort's
-- "Udlejningsbiler" vehicles (department_id 9d1a5566-79fb-48bd-9832-a0864b3d362f,
-- costumer_id 986ecc69-2ade-4406-8796-b3bb1fa42c60) into three OTHER
-- departments — confirmed via check_udlejningsbiler_move_candidates.sql to
-- belong to two DIFFERENT costumers, so each vehicle's costumer_id moves
-- along with it, not just its department:
--   - Administration  (ea0634ae-ff88-45a5-bd5a-557d34b75fd8, costumer FLEETII / 8dfa6c51-8ca8-4925-806f-8d1754cbb470) — 3 vehicles
--   - Test biler       (2b01999f-3b8c-4f5d-9661-c87df1b002df, costumer FLEETII / 8dfa6c51-8ca8-4925-806f-8d1754cbb470) — 10 vehicles
--   - Varevogne         (9b6a7af4-e365-43cf-97bb-8f04044916a4, costumer a4729b43-01c4-47aa-8a5c-a9491f817578) — 10 vehicles
-- The 16 not selected stay exactly where they are.
--
-- Random selection: shuffled the 39-vehicle Udlejningsbiler roster with a
-- fixed random seed (reproducible, not cherry-picked) and took the first
-- 3/10/10 off the shuffled order.
--
-- Each vehicle's "move" is three things together: drop its Udlejningsbiler
-- vehicle_departments row, add one for the new department, and update
-- vehicle_profiles' own department_id/costumer_id (its "home") to match —
-- mirrors exactly what HandleVehiclePage.tsx's own save does when an admin
-- reassigns a vehicle by hand.
--
-- Safe to re-run: deletes/inserts are idempotent per vehicle (ON CONFLICT DO
-- NOTHING on the insert; a vehicle already moved just gets its update
-- re-applied as a no-op).

-- Administration (3 vehicles).
delete from public.vehicle_departments
where department_id = '9d1a5566-79fb-48bd-9832-a0864b3d362f'
  and vehicle_id in (
    '58fefa4d-468a-4182-b228-6d360f1565c4',
    '7ab2aeb7-3e39-499a-8b31-bd71c8650f80',
    '8cbd8f29-75f0-4dac-8690-a0afd24b2317'
  );

insert into public.vehicle_departments (vehicle_id, department_id)
values
  ('58fefa4d-468a-4182-b228-6d360f1565c4', 'ea0634ae-ff88-45a5-bd5a-557d34b75fd8'),
  ('7ab2aeb7-3e39-499a-8b31-bd71c8650f80', 'ea0634ae-ff88-45a5-bd5a-557d34b75fd8'),
  ('8cbd8f29-75f0-4dac-8690-a0afd24b2317', 'ea0634ae-ff88-45a5-bd5a-557d34b75fd8')
on conflict (vehicle_id, department_id) do nothing;

update public.vehicle_profiles
set department_id = 'ea0634ae-ff88-45a5-bd5a-557d34b75fd8',
    costumer_id = '8dfa6c51-8ca8-4925-806f-8d1754cbb470'
where vehicle_id in (
  '58fefa4d-468a-4182-b228-6d360f1565c4',
  '7ab2aeb7-3e39-499a-8b31-bd71c8650f80',
  '8cbd8f29-75f0-4dac-8690-a0afd24b2317'
);

-- Test biler (10 vehicles).
delete from public.vehicle_departments
where department_id = '9d1a5566-79fb-48bd-9832-a0864b3d362f'
  and vehicle_id in (
    '669ca0fa-d13d-4f29-8f75-79169c899887',
    '1dbcd8d9-b5da-400d-b7f3-87caf4a127c9',
    '9b9a7c44-a5e8-409a-b0b4-f4a3958ae2f3',
    '8d2a5013-9442-49f1-abea-f87dfa6db282',
    'cab6a2bb-d6c9-47ae-9f73-3944d26693c6',
    'c11d7fa4-2260-4430-bf7d-30febd58a096',
    '0ccc9225-0464-43ca-b131-677cdd3f64db',
    '9ff40316-311d-474b-bc8f-ed46fe2cc4b2',
    '3e9817ea-b47a-4925-b01b-b8e178a6cc38',
    'd387e221-f650-4403-a4c2-e092f6076d05'
  );

insert into public.vehicle_departments (vehicle_id, department_id)
values
  ('669ca0fa-d13d-4f29-8f75-79169c899887', '2b01999f-3b8c-4f5d-9661-c87df1b002df'),
  ('1dbcd8d9-b5da-400d-b7f3-87caf4a127c9', '2b01999f-3b8c-4f5d-9661-c87df1b002df'),
  ('9b9a7c44-a5e8-409a-b0b4-f4a3958ae2f3', '2b01999f-3b8c-4f5d-9661-c87df1b002df'),
  ('8d2a5013-9442-49f1-abea-f87dfa6db282', '2b01999f-3b8c-4f5d-9661-c87df1b002df'),
  ('cab6a2bb-d6c9-47ae-9f73-3944d26693c6', '2b01999f-3b8c-4f5d-9661-c87df1b002df'),
  ('c11d7fa4-2260-4430-bf7d-30febd58a096', '2b01999f-3b8c-4f5d-9661-c87df1b002df'),
  ('0ccc9225-0464-43ca-b131-677cdd3f64db', '2b01999f-3b8c-4f5d-9661-c87df1b002df'),
  ('9ff40316-311d-474b-bc8f-ed46fe2cc4b2', '2b01999f-3b8c-4f5d-9661-c87df1b002df'),
  ('3e9817ea-b47a-4925-b01b-b8e178a6cc38', '2b01999f-3b8c-4f5d-9661-c87df1b002df'),
  ('d387e221-f650-4403-a4c2-e092f6076d05', '2b01999f-3b8c-4f5d-9661-c87df1b002df')
on conflict (vehicle_id, department_id) do nothing;

update public.vehicle_profiles
set department_id = '2b01999f-3b8c-4f5d-9661-c87df1b002df',
    costumer_id = '8dfa6c51-8ca8-4925-806f-8d1754cbb470'
where vehicle_id in (
  '669ca0fa-d13d-4f29-8f75-79169c899887',
  '1dbcd8d9-b5da-400d-b7f3-87caf4a127c9',
  '9b9a7c44-a5e8-409a-b0b4-f4a3958ae2f3',
  '8d2a5013-9442-49f1-abea-f87dfa6db282',
  'cab6a2bb-d6c9-47ae-9f73-3944d26693c6',
  'c11d7fa4-2260-4430-bf7d-30febd58a096',
  '0ccc9225-0464-43ca-b131-677cdd3f64db',
  '9ff40316-311d-474b-bc8f-ed46fe2cc4b2',
  '3e9817ea-b47a-4925-b01b-b8e178a6cc38',
  'd387e221-f650-4403-a4c2-e092f6076d05'
);

-- Varevogne (10 vehicles).
delete from public.vehicle_departments
where department_id = '9d1a5566-79fb-48bd-9832-a0864b3d362f'
  and vehicle_id in (
    '3d9b1b13-b50c-4c66-9d63-983147384ec6',
    'b1cc8cfe-3488-4599-8bff-c9124e471d07',
    '6d1e8d5b-a689-4310-b92f-c097561cbbb4',
    '4425a604-8233-41cf-a82d-bd877d43b749',
    '833b3613-c439-468e-a6fb-ff1d21f91062',
    'b743af99-7e53-4954-aed1-61d4ea339d42',
    '1366401c-7be0-454c-8681-bf7432862249',
    '4043e1bc-c80c-45f2-966f-5d0ad34c04ce',
    '669c2f61-169b-483a-aac8-1f985b4eb6fe',
    'bb830dcd-86b3-437e-888a-f84901e1c946'
  );

insert into public.vehicle_departments (vehicle_id, department_id)
values
  ('3d9b1b13-b50c-4c66-9d63-983147384ec6', '9b6a7af4-e365-43cf-97bb-8f04044916a4'),
  ('b1cc8cfe-3488-4599-8bff-c9124e471d07', '9b6a7af4-e365-43cf-97bb-8f04044916a4'),
  ('6d1e8d5b-a689-4310-b92f-c097561cbbb4', '9b6a7af4-e365-43cf-97bb-8f04044916a4'),
  ('4425a604-8233-41cf-a82d-bd877d43b749', '9b6a7af4-e365-43cf-97bb-8f04044916a4'),
  ('833b3613-c439-468e-a6fb-ff1d21f91062', '9b6a7af4-e365-43cf-97bb-8f04044916a4'),
  ('b743af99-7e53-4954-aed1-61d4ea339d42', '9b6a7af4-e365-43cf-97bb-8f04044916a4'),
  ('1366401c-7be0-454c-8681-bf7432862249', '9b6a7af4-e365-43cf-97bb-8f04044916a4'),
  ('4043e1bc-c80c-45f2-966f-5d0ad34c04ce', '9b6a7af4-e365-43cf-97bb-8f04044916a4'),
  ('669c2f61-169b-483a-aac8-1f985b4eb6fe', '9b6a7af4-e365-43cf-97bb-8f04044916a4'),
  ('bb830dcd-86b3-437e-888a-f84901e1c946', '9b6a7af4-e365-43cf-97bb-8f04044916a4')
on conflict (vehicle_id, department_id) do nothing;

update public.vehicle_profiles
set department_id = '9b6a7af4-e365-43cf-97bb-8f04044916a4',
    costumer_id = 'a4729b43-01c4-47aa-8a5c-a9491f817578'
where vehicle_id in (
  '3d9b1b13-b50c-4c66-9d63-983147384ec6',
  'b1cc8cfe-3488-4599-8bff-c9124e471d07',
  '6d1e8d5b-a689-4310-b92f-c097561cbbb4',
  '4425a604-8233-41cf-a82d-bd877d43b749',
  '833b3613-c439-468e-a6fb-ff1d21f91062',
  'b743af99-7e53-4954-aed1-61d4ea339d42',
  '1366401c-7be0-454c-8681-bf7432862249',
  '4043e1bc-c80c-45f2-966f-5d0ad34c04ce',
  '669c2f61-169b-483a-aac8-1f985b4eb6fe',
  'bb830dcd-86b3-437e-888a-f84901e1c946'
);
