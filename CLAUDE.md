# FLEETii webapp — agent notes

Danish-language fleet/vehicle-reservation admin tool. The domain terms below appear verbatim throughout the UI and code comments — not translated, and not typos.

## Domain glossary
**Afdeling** department · **Anvendelse** reservation's purpose/usage · **Bruger** user · **Reservation** booking (same thing) · **Slut** end (of a booking) · **Årgang** model year · **Nummerplade** number plate · **Kilometerstand** mileage/odometer · **Brændstofniveau** fuel/battery level · **Ledig** available/free · **Låst / Lås op** locked / unlock · **Fortryd** cancel/undo · **Bekræft** confirm.

## Gotchas — look wrong, aren't
- **"costumer"/"costumers"** is the actual spelling used throughout the DB schema and code (tables, columns, variable names) — not "customer". Don't "fix" it; a real fix would require a coordinated rename across migrations, RLS policies, and the client.
- **Naive wall-clock timestamps in `src/lib/bookings.ts`**: reservation start/end are compared as plain string prefixes (`isoPrefix`), never `new Date(iso)`. Supabase round-trips values with a real UTC offset while freshly-typed values don't — parsing both as real `Date`s would silently apply a timezone shift to only one side. If you touch booking time comparisons, follow this convention rather than "cleaning it up" with real `Date` parsing.
- **`vehicle_profiles.vehicle_id` IS 2hire's own real vehicleId**, not a locally-generated id — 2hire's webhook payloads and lock/unlock commands address a vehicle by this same value. Never regenerate it independently of the vehicle's actual 2hire registration.
- **"permission denied for table X" right after a rename** — check `role_table_grants`, not just RLS policies. A renamed table keeps its RLS policies but loses its grants.
- **`netlify dev` has a reliable ENOENT crash** after edits to `create-user.mts` — if it happens, check port 8888 and restart rather than assuming a real bug.

## 2hire integration
- Three separate hosts — don't confuse them: `test.adapter.2hire.io` (auth, registration, commands, webhook subscription — picked via `VITE_DATA_SOURCE`, see `getTwoHireBaseUrl()`), `e2e.adapter.2hire.io` (device creation + trip simulation, `netlify/functions/_shared/twoHireClient.ts`), and `adapter.2hire.io` (the real production fleet).
- WB20499 (`vehicle_profiles.vehicle_id` `6ae6ac0e-b918-4843-b3c4-eae02560c06b`) is a dedicated, real 2hire-registered test vehicle with `costumer_id`/`department_id` both NULL — safe to poke at via `/2hire-test` without touching real customer data.
- The e2e simulator's `distance_covered`/`autonomy_percentage` don't reliably reach our webhook, even though `position` does and even though `GET /state` shows the values genuinely changed — confirmed as an open issue with 2hire support (as of 2026-07-29). Don't assume it's been fixed without checking.

## Working conventions
- Comment every file, type, and function, and keep comments updated as code changes — this project wants heavier commenting than a typical default.
- Never do a raw/full read of `.env` or run `netlify env:list` — always use a targeted, redacted lookup for a single key.
