# FLEETii webapp — agent notes

Danish-language fleet/vehicle-reservation admin tool. The domain terms below appear verbatim throughout the UI and code comments — not translated, and not typos.


## Domain glossary
**Afdeling** department · **Anvendelse** reservation's purpose/usage · **Bruger** user · **Reservation** booking (same thing) · **Slut** end (of a booking) · **Årgang** model year · **Nummerplade** number plate · **Kilometerstand** mileage/odometer · **Drivmiddel** propellant/fuel type (`vehicle_profiles.drivmiddel`/`costumer_orders.drivmiddel` — one of Benzin, Diesel, El, Hybrid, Hybrid/Benzin, Hybrid/Diesel, Brint) · **Drivmiddelniveau** fuel/battery level (0–100%, from 2hire telemetry — a different concept from Drivmiddel, don't conflate them) · **Ledig** available/free · **Låst / Lås op** locked / unlock · **Fortryd** cancel/undo · **Bekræft** confirm.

## Gotchas — look wrong, aren't

## 2hire integration

## Environments
Two real deployments, both starting from this one codebase:

Gotchas from setting this split up (2026-08-09), worth knowing before touching either environment's database directly:

## Environments — production promotion
Promoting `main` → `production` requires two separate, explicit requests from the user — never chain them automatically, even when a change looks trivial or CI is green:
1. The user asks to promote/release — only then open the PR.
2. CI passes — report it and STOP. Merge only after the user separately confirms.

Routine commits/pushes to `main` need no mention of `production` at all — most `main` work is just iterative testing on `dev.fleetii.dk`.

**Mechanics of the promotion PR itself** (confirmed against #44/#45, both merged): `gh pr create --base production --head main --title "Promote main to production"` — that exact title is the established convention, reused verbatim each time rather than describing the contents. Merge with `gh pr merge <number> --merge` (a real merge commit, not squash/rebase — confirmed by checking a prior promotion merge commit's parent count: 2 parents). No need to re-derive this from `gh pr list --base production` each time.

## Working conventions

**Time handling: all times are UTC; Danish time only at the edges.** Every timestamp inside the app and in the database is a real UTC instant: an ISO string with `Z`/an offset, or epoch ms. Compare times as instants (`toUtcMs`/`Date.now()`), never as text. Danish time (Europe/Copenhagen) is used in exactly three places, always through `src/lib/time.ts`:
- **Showing a time to the user:** `utcToDanishParts`, `formatDanishDateTime`, `splitIsoDateTime`.
- **Reading a time the user typed:** `danishLocalToUtcIso`/`danishPartsToUtcMs`. Typed times are always Danish, even if the browser is set to another timezone.
- **Deciding which calendar day something is on:** `danishDayKey`.

Never use `Date`'s local getters (`getHours`, `getDate`, …), `toLocaleString` without a `timeZone`, or build an ISO string from typed parts by hand. All of these silently depend on the runtime's timezone, and Netlify Functions run in UTC. Until 2026-09-24, bookings stored the typed Danish wall-clock time labelled as UTC; the `bookings.legacy_wallclock` column tracks rows not yet converted (see `supabase/applied/bookings_*legacy_wallclock*.sql`).
