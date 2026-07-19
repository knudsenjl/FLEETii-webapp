-- ARCHIVED: already applied to the live database. Kept only as a historical
-- record of why vehicle_id is uuid (and the plate->vehicleId backfill map
-- used) — not needed to reproduce the current schema (see the files
-- directly under supabase/ for that).
--
-- One-time migration: converts vehicle_id columns from text to uuid.
--
-- Two different tables have a "vehicle_id" column, holding two DIFFERENT
-- kinds of value up to now:
--
--   * vehicle_signals.vehicle_id already holds 2hire's real UUID vehicleId
--     (written by netlify/functions/2hire-webhook.mts) — a straightforward
--     type change, no data rewrite needed.
--
--   * bookings.vehicle_id actually held the vehicle's PLATE (e.g. "ET83472"),
--     not a vehicleId at all — ConfirmPage.tsx used to insert vehicle.plate
--     instead of the vehicle's real 2hire vehicleId (now fixed alongside
--     this migration, see src/pages/ConfirmPage.tsx). Existing rows must be
--     backfilled from plate to real vehicleId BEFORE the column can become
--     uuid, since a plate string is not a valid uuid literal.
--
-- The backfill below is built from src/data/mock/2hireVehicleData.json,
-- since VITE_DATA_SOURCE=mockup-data is what's actually running in
-- production today — that file's (alias, vehicleId) pairs are the
-- authoritative plate -> vehicleId mapping for any booking created so far.
-- If you switch to a live 2hire data source later, this mapping will need
-- to come from wherever that fleet's real alias/vehicleId pairs live
-- instead (see src/lib/vehicleDataSource/liveVehicleDataSource.ts's header
-- comment on why that isn't queryable from SQL today).
--
-- Safe to re-run: each step is guarded to no-op once already applied.
--
-- ALSO DISCOVERED (only when this migration was first run against the real
-- database): vehicle_signals.vehicle_id has a foreign key
-- ("vehicle_signals_vehicle_id_fkey") to a vehicle_profiles.vehicle_id
-- column — a table that appears NOWHERE else in this repo (no create-table
-- script, no app code referencing it). It was empty (0 rows) when checked,
-- so there's no data-migration risk, but its purpose is unclear — worth
-- investigating separately (leftover from an earlier design? scaffolding
-- for a not-yet-built feature?). This migration converts its vehicle_id to
-- uuid too since the FK requires both sides to match, but doesn't otherwise
-- touch it. The FK is captured and recreated with its exact original
-- definition (via pg_get_constraintdef) so its on-delete/update behavior
-- doesn't need to be known in advance.
--
-- RESIDUAL RISK — not verified by this file: bookings has a booking-overlap
-- exclusion constraint (see supabase/booking_overlap_constraint.sql,
-- referenced in ConfirmPage.tsx's comments but never checked into this
-- repo, so its exact definition is unknown here). Postgres should carry an
-- exclusion constraint through a column type change transparently (btree_gist
-- supports uuid equality same as text), but after running this, check the
-- constraint still exists (Supabase dashboard -> Database -> bookings ->
-- Constraints, or `\d public.bookings`) and that creating an overlapping
-- booking still gets rejected.

do $$
declare
  fk_def text;
  vehicle_profiles_exists boolean;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicle_signals'
      and column_name = 'vehicle_id' and data_type <> 'uuid'
  ) then
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'vehicle_profiles'
    ) into vehicle_profiles_exists;

    select pg_get_constraintdef(oid) into fk_def
    from pg_constraint where conname = 'vehicle_signals_vehicle_id_fkey';

    if fk_def is not null then
      alter table public.vehicle_signals drop constraint vehicle_signals_vehicle_id_fkey;
    end if;

    if vehicle_profiles_exists then
      alter table public.vehicle_profiles alter column vehicle_id type uuid using vehicle_id::uuid;
    end if;

    alter table public.vehicle_signals alter column vehicle_id type uuid using vehicle_id::uuid;

    if fk_def is not null then
      execute format('alter table public.vehicle_signals add constraint vehicle_signals_vehicle_id_fkey %s', fk_def);
    end if;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name = 'vehicle_id' and data_type <> 'uuid'
  ) then
    -- Temporary plate -> vehicleId map, sourced from
    -- src/data/mock/2hireVehicleData.json (see file header).
    create temporary table vehicle_alias_map (alias text primary key, vehicle_id uuid not null) on commit drop;

    insert into vehicle_alias_map (alias, vehicle_id) values
      ('ET83472', '7c6a05e9-1c49-41ae-bbea-afe6b09ff74f'),
      ('DM60732', 'b1cc8cfe-3488-4599-8bff-c9124e471d07'),
      ('DP23231', '17ca8630-e7f2-4de8-be79-b749038484dc'),
      ('ES44003', 'a2204350-1239-4618-9370-312e6b1f4f4f'),
      ('EH79153', 'd7556486-b219-4a2e-9115-a7e57d89c061'),
      ('DY72969', 'cab6a2bb-d6c9-47ae-9f73-3944d26693c6'),
      ('EE71706', '42e6cb5b-992a-4ecc-99d2-fb79837db7b0'),
      ('EP57866', '2ee775ea-c87c-413d-8457-46597de94388'),
      ('EE30939', '50932543-7f58-48c3-8ab8-aae64b35eee9'),
      ('EE88470', '9ff40316-311d-474b-bc8f-ed46fe2cc4b2'),
      ('DB58134', 'f70d43b3-b6e4-4ba8-9317-eed88de2192c'),
      ('EG14969', '3bd94187-37a5-4dab-807a-528208cd71e8'),
      ('DS81080', '58fefa4d-468a-4182-b228-6d360f1565c4'),
      ('DX95436', 'c11d7fa4-2260-4430-bf7d-30febd58a096'),
      ('DX57974', '527aaa8e-d0ae-495b-8a75-7088627d0ea6'),
      ('EJ97169', 'bb830dcd-86b3-437e-888a-f84901e1c946'),
      ('DJ90972', '3e9817ea-b47a-4925-b01b-b8e178a6cc38'),
      ('EK91751', '8bde5f33-584e-4bde-8415-db683b2d6014'),
      ('EJ21939', '0ccc9225-0464-43ca-b131-677cdd3f64db'),
      ('EF45877', '833b3613-c439-468e-a6fb-ff1d21f91062'),
      ('DJ90968', '7ab2aeb7-3e39-499a-8b31-bd71c8650f80'),
      ('CX59592', '3d9b1b13-b50c-4c66-9d63-983147384ec6'),
      ('EA69482', '4043e1bc-c80c-45f2-966f-5d0ad34c04ce'),
      ('DP59763', 'ff195324-d762-46ff-9423-591bf4991ea7'),
      ('DN74504', '1366401c-7be0-454c-8681-bf7432862249'),
      ('DT44961', 'b743af99-7e53-4954-aed1-61d4ea339d42'),
      ('DM60731', '6d1e8d5b-a689-4310-b92f-c097561cbbb4'),
      ('EK91756', 'ad7070d7-fdae-4184-890c-e9a891e85bda'),
      ('EC75741', 'd387e221-f650-4403-a4c2-e092f6076d05'),
      ('EB82600', '1dbcd8d9-b5da-400d-b7f3-87caf4a127c9'),
      ('DP23220', '8cbd8f29-75f0-4dac-8690-a0afd24b2317'),
      ('EJ97168', '669c2f61-169b-483a-aac8-1f985b4eb6fe'),
      ('EG14978', '0d248bbb-0996-4251-ab2c-a4e355e11d41'),
      ('DL47079', 'b8c0844c-c51b-4517-a183-c3dbf11e0d51'),
      ('DM60730', '9b9a7c44-a5e8-409a-b0b4-f4a3958ae2f3'),
      ('EA69484', '876c91c8-f60f-4993-aafa-28e478b76ea1'),
      ('ED26158', '8d2a5013-9442-49f1-abea-f87dfa6db282'),
      ('EB50795', '52adf79a-7168-408b-b6b2-e84c5c8837a6'),
      ('C300de', '669ca0fa-d13d-4f29-8f75-79169c899887'),
      ('E-custom', '4425a604-8233-41cf-a82d-bd877d43b749');

    -- Fail loudly rather than silently orphaning a real booking from its
    -- vehicle if some existing row's plate isn't in the map above.
    if exists (
      select 1 from public.bookings b
      left join vehicle_alias_map m on m.alias = b.vehicle_id
      where m.alias is null
    ) then
      raise exception 'bookings has row(s) whose vehicle_id (plate) has no match in vehicle_alias_map — add them to the map above before re-running this migration';
    end if;

    update public.bookings b
    set vehicle_id = m.vehicle_id::text
    from vehicle_alias_map m
    where m.alias = b.vehicle_id;

    alter table public.bookings alter column vehicle_id type uuid using vehicle_id::uuid;
  end if;
end $$;
