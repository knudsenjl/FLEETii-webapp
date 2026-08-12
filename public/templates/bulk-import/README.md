# Bulk-import templates

Format templates for bulk-initializing a new customer's data in FLEETii, handed to a customer so they know exactly what to deliver. Either CSV or JSON is accepted — pick whichever the customer's own system exports.

## Brugere (users) — `brugere-template.csv` / `brugere-template.json`

Handled by `netlify/functions/bulk-import-users.mts`.

| Column | Required | Notes |
|---|---|---|
| `Email` | **Yes** | Must be unique — a row with an email that already has a FLEETii account will fail. |
| `Navn` | No | |
| `Telefon` | No | |
| `Bruger-ID` | No | Company-wide vehicle/user identifier, if the customer uses one. |
| `Afdeling` | No | Department name. An unrecognized name **creates that department automatically** — check spelling carefully, since two different spellings of the same department become two separate departments. |
| `Rolle` | No | `Bruger` (default) or `Administrator` — nothing else. |

Every imported user gets a shared temporary password and must set a real one on first login, same as a user created one at a time through FLEETii's own admin screen — no password column is expected or accepted in the file.

## Køretøjer (vehicles) — `koretojer-template.csv` / `koretojer-template.json`

Handled by `netlify/functions/bulk-import-vehicles.mts`.

| Column | Required | Notes |
|---|---|---|
| `Nummerplade` | **Yes** | |
| `Køretøj-ID` | No | |
| `Afdeling` | No | Same auto-create-if-unknown behavior as the user import above. |
| `Brand` | No | |
| `Mærke` | No | |
| `Årgang` | No | |
| `Drivmiddel` | No | One of `Benzin` (default), `Diesel`, `El`, `Hybrid`, `Brint` — nothing else. |
| `P-plads` | No | |
| `Kilometerstand` | No | |
| `Drivmiddelniveau` | No | Fuel/battery level, if known. |

**This import creates a pending vehicle request per row, not a fully working vehicle.** Getting a real, working vehicle in FLEETii requires physically installing a 2hire device and scanning its QR code — an unavoidably one-at-a-time, on-site step. Each imported row shows up exactly where a normal "Ny bestilling" request would, ready for a FLEETii admin to finish registering it once the hardware is installed.
