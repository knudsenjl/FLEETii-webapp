-- Test-data anonymization, two parts, mirroring the same changes just made
-- to src/data/mock/2hireVehicleData.json (its "tags"/"alias" fields):
--
-- 1. Renames costumer "Jonas Hjort" (986ecc69-2ade-4406-8796-b3bb1fa42c60) to
-- "Delta Group" — the name alone; costumer_id and every relationship
-- (departments, users, vehicles) are untouched. Historical migrations under
-- supabase/applied/ that reference "Jonas Hjort" (e.g.
-- costumer_backfill_from_departments.sql, seed_vehicle_profiles.sql) are
-- deliberately left as-is — they're an immutable record of what was run at
-- the time, not live state.
--
-- 2. Replaces all 40 mock-seeded vehicles' number_plate with a freshly
-- generated, unique random plate — format LL (2 random uppercase letters) +
-- a 5-digit number strictly above 09999 (10000-99999) — generated once in
-- Node alongside the JSON file's "alias" update, so both stay in sync
-- (same vehicle_id -> plate mapping in both places).
--
-- Safe to re-run: both are plain UPDATEs, idempotent (re-running just
-- reapplies the same values).

update public.costumers
set name = 'Delta Group'
where costumer_id = '986ecc69-2ade-4406-8796-b3bb1fa42c60';

update public.vehicle_profiles
set number_plate = case vehicle_id
    when '7c6a05e9-1c49-41ae-bbea-afe6b09ff74f' then 'FN19113'
    when 'b1cc8cfe-3488-4599-8bff-c9124e471d07' then 'GO63328'
    when '17ca8630-e7f2-4de8-be79-b749038484dc' then 'XY94207'
    when 'a2204350-1239-4618-9370-312e6b1f4f4f' then 'EK28861'
    when 'd7556486-b219-4a2e-9115-a7e57d89c061' then 'SO91536'
    when 'cab6a2bb-d6c9-47ae-9f73-3944d26693c6' then 'KD38830'
    when '42e6cb5b-992a-4ecc-99d2-fb79837db7b0' then 'IS10398'
    when '2ee775ea-c87c-413d-8457-46597de94388' then 'RK65223'
    when '50932543-7f58-48c3-8ab8-aae64b35eee9' then 'YF30429'
    when '9ff40316-311d-474b-bc8f-ed46fe2cc4b2' then 'DX82197'
    when 'f70d43b3-b6e4-4ba8-9317-eed88de2192c' then 'NX25399'
    when '3bd94187-37a5-4dab-807a-528208cd71e8' then 'JW11539'
    when '58fefa4d-468a-4182-b228-6d360f1565c4' then 'IP80601'
    when 'c11d7fa4-2260-4430-bf7d-30febd58a096' then 'LW41426'
    when '527aaa8e-d0ae-495b-8a75-7088627d0ea6' then 'SQ99026'
    when 'bb830dcd-86b3-437e-888a-f84901e1c946' then 'KI94019'
    when '3e9817ea-b47a-4925-b01b-b8e178a6cc38' then 'MW68263'
    when '8bde5f33-584e-4bde-8415-db683b2d6014' then 'BK80675'
    when '0ccc9225-0464-43ca-b131-677cdd3f64db' then 'LB15036'
    when '833b3613-c439-468e-a6fb-ff1d21f91062' then 'YA75862'
    when '7ab2aeb7-3e39-499a-8b31-bd71c8650f80' then 'PR94408'
    when '3d9b1b13-b50c-4c66-9d63-983147384ec6' then 'NL38682'
    when '4043e1bc-c80c-45f2-966f-5d0ad34c04ce' then 'NS73205'
    when 'ff195324-d762-46ff-9423-591bf4991ea7' then 'GA74676'
    when '1366401c-7be0-454c-8681-bf7432862249' then 'ED32823'
    when 'b743af99-7e53-4954-aed1-61d4ea339d42' then 'KM59225'
    when '6d1e8d5b-a689-4310-b92f-c097561cbbb4' then 'PD91044'
    when 'ad7070d7-fdae-4184-890c-e9a891e85bda' then 'YI61058'
    when 'd387e221-f650-4403-a4c2-e092f6076d05' then 'CH73533'
    when '1dbcd8d9-b5da-400d-b7f3-87caf4a127c9' then 'NH46485'
    when '8cbd8f29-75f0-4dac-8690-a0afd24b2317' then 'WB20418'
    when '669c2f61-169b-483a-aac8-1f985b4eb6fe' then 'MF47957'
    when '0d248bbb-0996-4251-ab2c-a4e355e11d41' then 'CN61538'
    when 'b8c0844c-c51b-4517-a183-c3dbf11e0d51' then 'CS30731'
    when '9b9a7c44-a5e8-409a-b0b4-f4a3958ae2f3' then 'QI73831'
    when '876c91c8-f60f-4993-aafa-28e478b76ea1' then 'HH44555'
    when '8d2a5013-9442-49f1-abea-f87dfa6db282' then 'RK45113'
    when '52adf79a-7168-408b-b6b2-e84c5c8837a6' then 'UR89387'
    when '669ca0fa-d13d-4f29-8f75-79169c899887' then 'BI47381'
    when '4425a604-8233-41cf-a82d-bd877d43b749' then 'JW80709'
  end
where vehicle_id in (
    '7c6a05e9-1c49-41ae-bbea-afe6b09ff74f',
    'b1cc8cfe-3488-4599-8bff-c9124e471d07',
    '17ca8630-e7f2-4de8-be79-b749038484dc',
    'a2204350-1239-4618-9370-312e6b1f4f4f',
    'd7556486-b219-4a2e-9115-a7e57d89c061',
    'cab6a2bb-d6c9-47ae-9f73-3944d26693c6',
    '42e6cb5b-992a-4ecc-99d2-fb79837db7b0',
    '2ee775ea-c87c-413d-8457-46597de94388',
    '50932543-7f58-48c3-8ab8-aae64b35eee9',
    '9ff40316-311d-474b-bc8f-ed46fe2cc4b2',
    'f70d43b3-b6e4-4ba8-9317-eed88de2192c',
    '3bd94187-37a5-4dab-807a-528208cd71e8',
    '58fefa4d-468a-4182-b228-6d360f1565c4',
    'c11d7fa4-2260-4430-bf7d-30febd58a096',
    '527aaa8e-d0ae-495b-8a75-7088627d0ea6',
    'bb830dcd-86b3-437e-888a-f84901e1c946',
    '3e9817ea-b47a-4925-b01b-b8e178a6cc38',
    '8bde5f33-584e-4bde-8415-db683b2d6014',
    '0ccc9225-0464-43ca-b131-677cdd3f64db',
    '833b3613-c439-468e-a6fb-ff1d21f91062',
    '7ab2aeb7-3e39-499a-8b31-bd71c8650f80',
    '3d9b1b13-b50c-4c66-9d63-983147384ec6',
    '4043e1bc-c80c-45f2-966f-5d0ad34c04ce',
    'ff195324-d762-46ff-9423-591bf4991ea7',
    '1366401c-7be0-454c-8681-bf7432862249',
    'b743af99-7e53-4954-aed1-61d4ea339d42',
    '6d1e8d5b-a689-4310-b92f-c097561cbbb4',
    'ad7070d7-fdae-4184-890c-e9a891e85bda',
    'd387e221-f650-4403-a4c2-e092f6076d05',
    '1dbcd8d9-b5da-400d-b7f3-87caf4a127c9',
    '8cbd8f29-75f0-4dac-8690-a0afd24b2317',
    '669c2f61-169b-483a-aac8-1f985b4eb6fe',
    '0d248bbb-0996-4251-ab2c-a4e355e11d41',
    'b8c0844c-c51b-4517-a183-c3dbf11e0d51',
    '9b9a7c44-a5e8-409a-b0b4-f4a3958ae2f3',
    '876c91c8-f60f-4993-aafa-28e478b76ea1',
    '8d2a5013-9442-49f1-abea-f87dfa6db282',
    '52adf79a-7168-408b-b6b2-e84c5c8837a6',
    '669ca0fa-d13d-4f29-8f75-79169c899887',
    '4425a604-8233-41cf-a82d-bd877d43b749'
);
