-- One-time migration:
-- seeds it with the 40 vehicles from src/data/mock/2hireVehicleData.json, 
-- the data actually used while VITE_DATA_SOURCE=mockup-data).
--
-- Field mapping (source JSON -> vehicle_profiles column):
--   vehicleId      -> vehicle_id     (uuid, already the PK/FK target for
--                                     vehicle_signals — see
--                                     rename_vehicle_id_to_uuid.sql)
--   alias          -> number_plate
--   iotIdentifier  -> iot_id         (column existed as "ito-id" — a typo,
--                                     fixed below since every other column
--                                     is snake_case)
--   brand          -> brand
--   model          -> model
--   version        -> model_year     (text, not a bare year — source values
--                                     are ranges like "2018-2025")
--   tags           -> departments    (text[] — source is a single string
--                                     per vehicle, wrapped as a one-element
--                                     array)
--
-- Safe to re-run: the insert upserts on
-- vehicle_id (do update) rather than failing on a second run.


insert into public.vehicle_profiles
  (vehicle_id, number_plate, iot_id, brand, model, model_year, departments, created_at)
values
  ('7c6a05e9-1c49-41ae-bbea-afe6b09ff74f', 'ET83472', '2H2000015554', 'VOLVO', 'V60 (Breakout)', '2018-2025', array['com.fleetii.jonashjort'], now()),
  ('b1cc8cfe-3488-4599-8bff-c9124e471d07', 'DM60732', '2H2000013447', 'MERCEDES_BENZ', 'Vito (Breakout)', '2014-2025', array['com.fleetii.jonashjort'], now()),
  ('17ca8630-e7f2-4de8-be79-b749038484dc', 'DP23231', '2H2000016447', 'VOLKSWAGEN', 'T-Roc (Breakout)', '2017-2025', array['com.fleetii.jonashjort'], now()),
  ('a2204350-1239-4618-9370-312e6b1f4f4f', 'ES44003', '2H2000015669', 'VOLKSWAGEN', 'Passat (Breakout)', '2015-2025', array['com.fleetii.jonashjort'], now()),
  ('d7556486-b219-4a2e-9115-a7e57d89c061', 'EH79153', '2H2000015707', 'FORD', 'Kuga (Breakout)', '2019-2025', array['com.fleetii.jonashjort'], now()),
  ('cab6a2bb-d6c9-47ae-9f73-3944d26693c6', 'DY72969', '2H2000015716', 'SEAT', 'Alhambra (70L)(Breakout)', '2010-2020', array['com.fleetii.jonashjort'], now()),
  ('42e6cb5b-992a-4ecc-99d2-fb79837db7b0', 'EE71706', '2H2000013423', 'NISSAN', 'Qashqai (Breakout)', '2022-2025', array['com.fleetii.jonashjort'], now()),
  ('2ee775ea-c87c-413d-8457-46597de94388', 'EP57866', '2H2000013457', 'AUDI', 'Q3 (Breakout)', '2018-2025', array['com.fleetii.jonashjort'], now()),
  ('50932543-7f58-48c3-8ab8-aae64b35eee9', 'EE30939', '2H2000013422', 'VOLKSWAGEN', 'Golf (Breakout)', '2020-2025', array['com.fleetii.jonashjort'], now()),
  ('9ff40316-311d-474b-bc8f-ed46fe2cc4b2', 'EE88470', '2H2000013448', 'NISSAN', 'Qashqai (Breakout)', '2022-2025', array['com.fleetii.jonashjort'], now()),
  ('f70d43b3-b6e4-4ba8-9317-eed88de2192c', 'DB58134', '2H2000013431', 'NISSAN', 'Qashqai (Breakout)', '2017-2022', array['com.fleetii.jonashjort'], now()),
  ('3bd94187-37a5-4dab-807a-528208cd71e8', 'EG14969', '2H2000013455', 'NISSAN', 'Qashqai (Breakout)', '2017-2022', array['com.fleetii.jonashjort'], now()),
  ('58fefa4d-468a-4182-b228-6d360f1565c4', 'DS81080', '2H2000015519', 'MERCEDES_BENZ', 'Vito (Breakout)', '2014-2025', array['com.fleetii.jonashjort'], now()),
  ('c11d7fa4-2260-4430-bf7d-30febd58a096', 'DX95436', '2H2000015517', 'VOLKSWAGEN', 'Passat (Breakout)', '2015-2025', array['com.fleetii.jonashjort'], now()),
  ('527aaa8e-d0ae-495b-8a75-7088627d0ea6', 'DX57974', '2H2000015530', 'AUDI', 'A3 (Breakout)', '2020-2025', array['com.fleetii.jonashjort'], now()),
  ('bb830dcd-86b3-437e-888a-f84901e1c946', 'EJ97169', '2H2000015535', 'VOLKSWAGEN', 'T-Roc (Breakout)', '2017-2025', array['com.fleetii.jonashjort'], now()),
  ('3e9817ea-b47a-4925-b01b-b8e178a6cc38', 'DJ90972', '2H2000015534', 'AUDI', 'A3 (Breakout)', '2020-2025', array['com.fleetii.jonashjort'], now()),
  ('8bde5f33-584e-4bde-8415-db683b2d6014', 'EK91751', '2H2000015550', 'SEAT', 'Ateca (Breakout)', '2017-2025', array['com.fleetii.jonashjort'], now()),
  ('0ccc9225-0464-43ca-b131-677cdd3f64db', 'EJ21939', '2H2000015527', 'BMW', '1 Series (Breakout)', '2019-2025', array['com.fleetii.jonashjort'], now()),
  ('833b3613-c439-468e-a6fb-ff1d21f91062', 'EF45877', '2H2000015555', 'NISSAN', 'Qashqai (Breakout)', '2022-2025', array['com.fleetii.jonashjort'], now()),
  ('7ab2aeb7-3e39-499a-8b31-bd71c8650f80', 'DJ90968', '2H2000015531', 'NISSAN', 'Qashqai (Breakout)', '2017-2022', array['com.fleetii.jonashjort'], now()),
  ('3d9b1b13-b50c-4c66-9d63-983147384ec6', 'CX59592', '2H2000015551', 'MERCEDES_BENZ', 'A-Class (Diesel)(Breakout)', '2018-2025', array['com.fleetii.jonashjort'], now()),
  ('4043e1bc-c80c-45f2-966f-5d0ad34c04ce', 'EA69482', '2H2000015528', 'AUDI', 'A4', '2016-2025', array['com.fleetii.jonashjort'], now()),
  ('ff195324-d762-46ff-9423-591bf4991ea7', 'DP59763', '2H2000015542', 'VOLKSWAGEN', 'Transporter (Breakout)', '2016-2024', array['com.fleetii.jonashjort'], now()),
  ('1366401c-7be0-454c-8681-bf7432862249', 'DN74504', '2H2000015532', 'MERCEDES_BENZ', 'Vito (Breakout)', '2014-2025', array['com.fleetii.jonashjort'], now()),
  ('b743af99-7e53-4954-aed1-61d4ea339d42', 'DT44961', '2H2000015549', 'MERCEDES_BENZ', 'Vito (Breakout)', '2014-2025', array['com.fleetii.jonashjort'], now()),
  ('6d1e8d5b-a689-4310-b92f-c097561cbbb4', 'DM60731', '2H2000015516', 'MERCEDES_BENZ', 'Vito (Breakout)', '2014-2025', array['com.fleetii.jonashjort'], now()),
  ('ad7070d7-fdae-4184-890c-e9a891e85bda', 'EK91756', '2H2000015524', 'MERCEDES_BENZ', 'Vito (Breakout)', '2014-2025', array['com.fleetii.jonashjort'], now()),
  ('d387e221-f650-4403-a4c2-e092f6076d05', 'EC75741', '2H2000015523', 'MERCEDES_BENZ', 'Vito (Breakout)', '2014-2025', array['com.fleetii.jonashjort'], now()),
  ('1dbcd8d9-b5da-400d-b7f3-87caf4a127c9', 'EB82600', '2H2000015526', 'VOLKSWAGEN', 'Passat (Breakout)', '2015-2025', array['com.fleetii.jonashjort'], now()),
  ('8cbd8f29-75f0-4dac-8690-a0afd24b2317', 'DP23220', '2H2000015521', 'AUDI', 'A3 (Breakout)', '2020-2025', array['com.fleetii.jonashjort'], now()),
  ('669c2f61-169b-483a-aac8-1f985b4eb6fe', 'EJ97168', '2H2000015525', 'VOLKSWAGEN', 'Touran (Breakout)', '2015-2025', array['com.fleetii.jonashjort'], now()),
  ('0d248bbb-0996-4251-ab2c-a4e355e11d41', 'EG14978', '2H2000015553', 'VOLKSWAGEN', 'Transporter (Breakout)', '2016-2024', array['com.fleetii.jonashjort'], now()),
  ('b8c0844c-c51b-4517-a183-c3dbf11e0d51', 'DL47079', '2H2000015533', 'RENAULT', 'Trafic (GPO)(Breakout)', '2021-2026', array['com.fleetii.jonashjort'], now()),
  ('9b9a7c44-a5e8-409a-b0b4-f4a3958ae2f3', 'DM60730', '2H2000015536', 'MERCEDES_BENZ', 'Vito (Breakout)', '2014-2025', array['com.fleetii.jonashjort'], now()),
  ('876c91c8-f60f-4993-aafa-28e478b76ea1', 'EA69484', '2H2000015548', 'AUDI', 'A4', '2016-2025', array['com.fleetii.jonashjort'], now()),
  ('8d2a5013-9442-49f1-abea-f87dfa6db282', 'ED26158', '2H2000015522', 'MERCEDES_BENZ', 'A-Class (Breakout)', '2018-2025', array['com.fleetii.jonashjort'], now()),
  ('52adf79a-7168-408b-b6b2-e84c5c8837a6', 'EB50795', '2H2000015529', 'MERCEDES_BENZ', 'E-Class (Breakout)', '2016-2023', array['FLEETii'], now()),
  ('669ca0fa-d13d-4f29-8f75-79169c899887', 'C300de', '2H2000015042', 'MERCEDES_BENZ', 'C-Class (Breakout)', '2014-2021', array['com.fleetii.jonashjort'], now()),
  ('4425a604-8233-41cf-a82d-bd877d43b749', 'E-custom', '2H2000015035', 'FORD', 'Transit e-Custom (Breakout)', '2023-2027', array['com.fleetii.jonashjort'], now())
on conflict (vehicle_id) do update set
  number_plate = excluded.number_plate,
  iot_id = excluded.iot_id,
  brand = excluded.brand,
a  model = excluded.model,
  model_year = excluded.model_year,
  departments = excluded.departments;
