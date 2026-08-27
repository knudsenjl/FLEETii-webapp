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

## Working conventions
