# FLEETii webapp — agent notes

Danish-language fleet/vehicle-reservation admin tool. The domain terms below appear verbatim throughout the UI and code comments — not translated, and not typos.

## Domain glossary
**Afdeling** department · **Anvendelse** reservation's purpose/usage · **Bruger** user · **Reservation** booking (same thing) · **Slut** end (of a booking) · **Årgang** model year · **Nummerplade** number plate · **Kilometerstand** mileage/odometer · **Drivmiddel** propellant/fuel type (`vehicle_profiles.drivmiddel`/`costumer_orders.drivmiddel` — one of Benzin/Diesel/El/Hybrid/Brint) · **Drivmiddelniveau** fuel/battery level (0–100%, from 2hire telemetry — a different concept from Drivmiddel, don't conflate them) · **Ledig** available/free · **Låst / Lås op** locked / unlock · **Fortryd** cancel/undo · **Bekræft** confirm.

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

## Environments
Two real deployments, both starting from this one codebase:
- **`main` branch → staging** (`dev.fleetii.dk`, Netlify site `fleetii-webapp-staging`, Supabase project `owbbihnbocuczbdogzxv`/"FLEETii-DB-staging", test 2hire adapter). Where development actually happens — commit here directly.
- **`production` branch → production** (`app.fleetii.dk`, Netlify site `fleetii-webapp-production`, Supabase project `adjnqjziyblusrruqigt`, real 2hire production adapter). GitHub-protected: no direct pushes, only a PR from `main` with the `build-and-test` CI check (`.github/workflows/ci.yml`) passing. This is where real costumers eventually live — `main`/staging has none yet.

Gotchas from setting this split up (2026-08-09), worth knowing before touching either environment's database directly:
- **`supabase/applied/*.sql` is incremental-only, NOT a full schema** — only 7 of its 120 files contain `CREATE TABLE`. Core tables (`bookings`, `vehicle_profiles`, `costumers`, `user_profiles`, etc.) predate this migration-tracking convention and only exist in the live databases. Replaying this folder against an empty database will not reproduce the schema — cloning it requires a structural dump (`pg_dump --schema-only --schema=public`) from a live project instead.
- **A `--schema=public` dump silently drops triggers defined on non-public tables**, even when the trigger's own function lives in `public` and gets dumped fine. `handle_new_user`/`handle_auth_user_email_change` exist as functions but do nothing until their `auth.users` triggers (`on_auth_user_created`/`on_auth_user_updated`) are recreated by hand afterward — check `pg_trigger` joined to `pg_namespace where nspname != 'public'` on the source project to catch any others.
- **Supabase's direct DB host (`db.<ref>.supabase.co`) is often IPv6-only** and won't resolve on an IPv4-only network — use the **Session pooler** connection string instead (`postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432`, region varies per project, copy it fresh from that project's own dashboard rather than assuming it matches another project).
- **A freshly reset Supabase DB password can take up to ~a minute to propagate** to the pooler layer — a "password authentication failed" right after a reset isn't necessarily a wrong password, retry once before assuming so.
- **A brand-new Supabase project has no users and no self-signup flow** — bootstrapping the first admin means creating a user via the dashboard's Authentication tab, then manually `insert`/`update`-ing their `public.user_profiles.role` to `'FLEETii admin'` via the SQL editor, since `handle_new_user` always defaults new signups to `role = 'user'`.
- **Marking a Netlify env var "secret" can fail the next build** if that exact value happens to appear anywhere else in the repo (Netlify's build-time secret scanner treats any literal match outside intended use as a leak). Hit this with `TWOHIRE_WEBHOOK_SECRET` matching `.env.example`'s placeholder text, and `SMTP_USER` matching a demo-account email documented in `doc/manualer/*.html`. Fix known-legitimate matches with the `SECRETS_SCAN_OMIT_KEYS` build env var (comma-separated key names) rather than un-marking the variable as secret.
- **`TWOHIRE_WEBHOOK_SECRET` is captured by 2hire at `2hire-subscribe` time, not read live** — 2hire signs future webhook deliveries with whatever secret was in `hub.secret` when you last subscribed. Changing the env var alone breaks signature verification immediately (the webhook handler reads the *new* value, 2hire still sends the *old* signature) until you re-run the one-time `2hire-subscribe` browser-console call (see `2hire-subscribe.mts`'s own header comment) on that environment.

## Environments — production promotion
Promoting `main` → `production` requires two separate, explicit requests from the user — never chain them automatically, even when a change looks trivial or CI is green:
1. The user asks to promote/release — only then open the PR.
2. CI passes — report it and STOP. Merge only after the user separately confirms.

Routine commits/pushes to `main` need no mention of `production` at all — most `main` work is just iterative testing on `dev.fleetii.dk`.

## Working conventions
- Comment every file, type, and function, and keep comments updated as code changes — this project wants heavier commenting than a typical default.
- Never do a raw/full read of `.env` or run `netlify env:list` — always use a targeted, redacted lookup for a single key.
