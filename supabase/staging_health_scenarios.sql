-- STAGING ONLY. Fake 2hire signals that show every vehicle-health category
-- of src/lib/vehicleHealth.ts's trip-aware rule (OK / amber WARNING / red
-- ERROR), for testing on dev.fleetii.dk. Staging's real signals are frozen
-- seed data (2026-08-09) with no signal history, so without this every
-- vehicle there is simply amber.
--
--   select * from public.staging_seed_health_scenarios();   -- (re)seed
--   select public.staging_restore_health_scenarios();        -- undo
--
-- Seeding gives each costumer's vehicles (ordered by Nummerplade) the 10
-- scenarios below in turn, so every costumer — e.g. Alpha Group's 10
-- vehicles for admin@alpha.dk — shows all of them. All times are relative to
-- now(): re-run the seed to refresh them (scenario 4 turns red 15 minutes
-- after seeding, by design). It returns which vehicle got which scenario.
--
-- Only online/position/distance_covered/autonomy_percentage/trip_detected
-- are touched. Every fake row carries "fake": true in signal_value (ignored
-- by the vehicle_signals view), and the first seed saves the original
-- vehicle_signals_latest rows in staging_health_backup, which the restore
-- puts back. The seed refuses to run where recent non-fake position/online
-- history exists — i.e. on production, where webhooks deliver live data.
--
-- Callable only by the database owner (Supabase SQL editor / MCP), never by
-- app users.

create table if not exists public.staging_health_backup (
  vehicle_id uuid not null,
  signal_type text not null,
  signal_value jsonb not null,
  signal_timestamp timestamptz not null,
  primary key (vehicle_id, signal_type)
);
alter table public.staging_health_backup enable row level security;
revoke all on public.staging_health_backup from anon, authenticated;

/** Records one fake signal: into the history, and into the latest-state table if it's the newest of its type. */
create or replace function public.staging_fake_signal(p_vehicle_id uuid, p_type text, p_value jsonb, p_ts timestamptz)
returns void
language sql
as $$
  insert into vehicle_signal_history (vehicle_id, signal_type, signal_value, signal_timestamp)
  values (p_vehicle_id, p_type, p_value || '{"fake": true}', p_ts)
  on conflict (vehicle_id, signal_type, signal_timestamp) do nothing;
  insert into vehicle_signals_latest (vehicle_id, signal_type, signal_value, signal_timestamp)
  values (p_vehicle_id, p_type, p_value || '{"fake": true}', p_ts)
  on conflict (vehicle_id, signal_type) do update
    set signal_value = excluded.signal_value, signal_timestamp = excluded.signal_timestamp
    where excluded.signal_timestamp > vehicle_signals_latest.signal_timestamp;
$$;

/** A fake trip: trip_detected true at p_start, false at p_end (null = still driving). */
create or replace function public.staging_fake_trip(p_vehicle_id uuid, p_start timestamptz, p_end timestamptz)
returns void
language sql
as $$
  select staging_fake_signal(p_vehicle_id, 'trip_detected', '{"value": true}', p_start);
  select staging_fake_signal(p_vehicle_id, 'trip_detected', '{"value": false}', p_end) where p_end is not null;
$$;

create or replace function public.staging_seed_health_scenarios()
returns table (vehicle text, costumer text, scenario text, expected text)
language plpgsql
as $$
declare
  t constant timestamptz := now();
  signal_types constant text[] := array['online', 'position', 'distance_covered', 'autonomy_percentage', 'trip_detected'];
  scenarios constant text[][] := array[
    ['OK - kører nu', 'intet mærke, grøn bil'],
    ['OK - holder stille, seneste tur for 20 dage siden', 'intet mærke (gav advarsel før)'],
    ['OK - data sendt 30 min før seneste tur (6 dage siden)', 'intet mærke (1 times margin)'],
    ['OK - offline i 5 min', 'intet mærke nu, rødt 15 min efter offline'],
    ['ADVARSEL - Drivmiddelniveau ikke opdateret under seneste tur', 'gult: Drivmiddelniveau'],
    ['ADVARSEL - Drivmiddelniveau aldrig modtaget', 'gult: Drivmiddelniveau'],
    ['ADVARSEL - ingen tur registreret, data 10 dage gamle', 'gult: Kilometerstand + Drivmiddelniveau'],
    ['FEJL - offline i 2 timer', 'rødt: Online'],
    ['FEJL + ADVARSEL - offline 1 døgn, data 12 dage gamle', 'rødt: Online, gult: Kilometerstand + Drivmiddelniveau'],
    ['OK - ingen tur registreret, data 1 dag gamle', 'intet mærke']
  ];
  v record;
  km numeric;
  pos jsonb;
begin
  if exists (
    select 1 from vehicle_signal_history
    where signal_type in ('position', 'online')
      and signal_timestamp > t - interval '7 days'
      and not coalesce((signal_value->>'fake')::boolean, false)
  ) then
    raise exception 'Live signal history found — this looks like production. Refusing to write fake signals.';
  end if;

  -- First seed only: keep the original rows for staging_restore_health_scenarios().
  if not exists (select 1 from staging_health_backup) then
    insert into staging_health_backup
    select l.vehicle_id, l.signal_type, l.signal_value, l.signal_timestamp
    from vehicle_signals_latest l
    where l.signal_type = any (signal_types) and not coalesce((l.signal_value->>'fake')::boolean, false);
  end if;

  for v in
    select vp.vehicle_id,
           coalesce(nullif(trim(vp.vehicle_ident), ''), vp.number_plate) as label,
           c.name as costumer_name,
           ((row_number() over (partition by vp.costumer_id order by vp.number_plate) - 1) % 10) + 1 as n
    from vehicle_profiles vp
    left join costumers c on c.costumer_id = vp.costumer_id
    order by c.name, vp.number_plate
  loop
    -- Start from a clean slate for this vehicle (earlier fake rows included).
    delete from vehicle_signal_history h
      where h.vehicle_id = v.vehicle_id and h.signal_type = any (signal_types)
        and coalesce((h.signal_value->>'fake')::boolean, false);
    delete from vehicle_signals_latest l where l.vehicle_id = v.vehicle_id and l.signal_type = any (signal_types);

    select coalesce((b.signal_value->>'meters')::numeric, 20000) into km
      from (select 1) x left join staging_health_backup b
        on b.vehicle_id = v.vehicle_id and b.signal_type = 'distance_covered';
    select coalesce(b.signal_value - 'fake', '{"latitude": 56.1367, "longitude": 8.9737}') into pos
      from (select 1) x left join staging_health_backup b
        on b.vehicle_id = v.vehicle_id and b.signal_type = 'position';

    case v.n
      when 1 then -- driving right now
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": true}', t - interval '1 minute');
        perform staging_fake_trip(v.vehicle_id, t - interval '20 minutes', null);
        perform staging_fake_signal(v.vehicle_id, 'position', pos, t - interval '1 minute');
        perform staging_fake_signal(v.vehicle_id, 'distance_covered', jsonb_build_object('meters', km + 12000), t - interval '2 minutes');
        perform staging_fake_signal(v.vehicle_id, 'autonomy_percentage', '{"percentage": 64}', t - interval '2 minutes');
      when 2 then -- idle for 20 days; its data is from that last trip
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": true}', t - interval '1 minute');
        perform staging_fake_trip(v.vehicle_id, t - interval '25 days', t - interval '25 days' + interval '20 minutes');
        perform staging_fake_trip(v.vehicle_id, t - interval '20 days', t - interval '20 days' + interval '30 minutes');
        perform staging_fake_signal(v.vehicle_id, 'position', pos, t - interval '5 minutes');
        perform staging_fake_signal(v.vehicle_id, 'distance_covered', jsonb_build_object('meters', km + 30000), t - interval '20 days' + interval '25 minutes');
        perform staging_fake_signal(v.vehicle_id, 'autonomy_percentage', '{"percentage": 55}', t - interval '20 days' + interval '25 minutes');
      when 3 then -- data sent 30 min before a short trip 6 days ago, nothing during it
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": true}', t - interval '1 minute');
        perform staging_fake_trip(v.vehicle_id, t - interval '6 days', t - interval '6 days' + interval '10 minutes');
        perform staging_fake_signal(v.vehicle_id, 'position', pos, t - interval '5 minutes');
        perform staging_fake_signal(v.vehicle_id, 'distance_covered', jsonb_build_object('meters', km + 8000), t - interval '6 days' - interval '30 minutes');
        perform staging_fake_signal(v.vehicle_id, 'autonomy_percentage', '{"percentage": 71}', t - interval '6 days' - interval '30 minutes');
      when 4 then -- went offline 5 minutes ago
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": true}', t - interval '10 minutes');
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": false}', t - interval '5 minutes');
        perform staging_fake_trip(v.vehicle_id, t - interval '1 day' - interval '1 hour', t - interval '1 day');
        perform staging_fake_signal(v.vehicle_id, 'position', pos, t - interval '6 minutes');
        perform staging_fake_signal(v.vehicle_id, 'distance_covered', jsonb_build_object('meters', km + 5000), t - interval '1 day' - interval '10 minutes');
        perform staging_fake_signal(v.vehicle_id, 'autonomy_percentage', '{"percentage": 48}', t - interval '1 day' - interval '10 minutes');
      when 5 then -- drove 2 hours ago, but the fuel level stopped 22 days ago
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": true}', t - interval '1 minute');
        perform staging_fake_trip(v.vehicle_id, t - interval '22 days' - interval '30 minutes', t - interval '22 days' - interval '10 minutes');
        perform staging_fake_trip(v.vehicle_id, t - interval '2 hours', t - interval '90 minutes');
        perform staging_fake_signal(v.vehicle_id, 'position', pos, t - interval '5 minutes');
        perform staging_fake_signal(v.vehicle_id, 'distance_covered', jsonb_build_object('meters', km + 15000), t - interval '95 minutes');
        perform staging_fake_signal(v.vehicle_id, 'autonomy_percentage', '{"percentage": 80}', t - interval '22 days' - interval '15 minutes');
      when 6 then -- drives, but has never sent a fuel level
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": true}', t - interval '1 minute');
        perform staging_fake_trip(v.vehicle_id, t - interval '3 hours', t - interval '2 hours');
        perform staging_fake_signal(v.vehicle_id, 'position', pos, t - interval '5 minutes');
        perform staging_fake_signal(v.vehicle_id, 'distance_covered', jsonb_build_object('meters', km + 9000), t - interval '125 minutes');
      when 7 then -- no trip on record, data 10 days old
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": true}', t - interval '1 minute');
        perform staging_fake_signal(v.vehicle_id, 'position', pos, t - interval '5 minutes');
        perform staging_fake_signal(v.vehicle_id, 'distance_covered', jsonb_build_object('meters', km), t - interval '10 days');
        perform staging_fake_signal(v.vehicle_id, 'autonomy_percentage', '{"percentage": 90}', t - interval '10 days');
      when 8 then -- offline for 2 hours, otherwise fine
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": true}', t - interval '3 hours');
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": false}', t - interval '2 hours');
        perform staging_fake_trip(v.vehicle_id, t - interval '1 day' - interval '40 minutes', t - interval '1 day');
        perform staging_fake_signal(v.vehicle_id, 'position', pos, t - interval '2 hours');
        perform staging_fake_signal(v.vehicle_id, 'distance_covered', jsonb_build_object('meters', km + 4000), t - interval '1 day' - interval '5 minutes');
        perform staging_fake_signal(v.vehicle_id, 'autonomy_percentage', '{"percentage": 37}', t - interval '1 day' - interval '5 minutes');
      when 9 then -- offline for a day, no trip, data 12 days old
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": true}', t - interval '1 day' - interval '1 hour');
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": false}', t - interval '1 day');
        perform staging_fake_signal(v.vehicle_id, 'position', pos, t - interval '1 day');
        perform staging_fake_signal(v.vehicle_id, 'distance_covered', jsonb_build_object('meters', km), t - interval '12 days');
        perform staging_fake_signal(v.vehicle_id, 'autonomy_percentage', '{"percentage": 22}', t - interval '12 days');
      else -- 10: no trip on record, data 1 day old
        perform staging_fake_signal(v.vehicle_id, 'online', '{"online": true}', t - interval '1 minute');
        perform staging_fake_signal(v.vehicle_id, 'position', pos, t - interval '5 minutes');
        perform staging_fake_signal(v.vehicle_id, 'distance_covered', jsonb_build_object('meters', km), t - interval '1 day');
        perform staging_fake_signal(v.vehicle_id, 'autonomy_percentage', '{"percentage": 66}', t - interval '1 day');
    end case;

    vehicle := v.label;
    costumer := coalesce(v.costumer_name, '(ingen kunde)');
    scenario := scenarios[v.n][1];
    expected := scenarios[v.n][2];
    return next;
  end loop;
end;
$$;

/** Removes every fake signal and puts the original latest-state rows back. Returns how many rows were restored. */
create or replace function public.staging_restore_health_scenarios()
returns integer
language plpgsql
as $$
declare
  restored integer;
begin
  delete from vehicle_signal_history where coalesce((signal_value->>'fake')::boolean, false);
  delete from vehicle_signals_latest where coalesce((signal_value->>'fake')::boolean, false);
  insert into vehicle_signals_latest (vehicle_id, signal_type, signal_value, signal_timestamp)
  select vehicle_id, signal_type, signal_value, signal_timestamp from staging_health_backup
  on conflict (vehicle_id, signal_type) do update
    set signal_value = excluded.signal_value, signal_timestamp = excluded.signal_timestamp;
  get diagnostics restored = row_count;
  delete from staging_health_backup;
  return restored;
end;
$$;

revoke all on function public.staging_fake_signal(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.staging_fake_trip(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.staging_seed_health_scenarios() from public, anon, authenticated;
revoke all on function public.staging_restore_health_scenarios() from public, anon, authenticated;
