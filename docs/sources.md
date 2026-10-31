# Data sources and licences

Checked live on 31 Oct 2026 (WP34). Every source the site or the data hub
uses is listed here, with its licence, the attribution it requires and how
we access it. A source is only used once it appears in this file.

## In use

| Source | What | Licence | Attribution (exact) | Access |
|---|---|---|---|---|
| **Marktstammdatenregister** (Bundesnetzagentur) | Every generation and storage unit | DL-DE-BY-2.0 | © Bundesnetzagentur, DL-DE-BY-2.0, data processed | Daily bulk export, no account |
| **BKG VG2500** | State and district boundaries | dl-de/by-2-0 | © GeoBasis-DE / BKG (2026) | Download, no account |
| **Fraunhofer ISE Energy-Charts** | Cross-check only (installed capacity) | Licence page not machine-readable (JS); not redistributed by us | Named on the methodology page | API, no account |

## Planned for Phase 7

| Source | What | Licence | Attribution (exact) | Access | Status |
|---|---|---|---|---|---|
| **SMARD** (Bundesnetzagentur) | Generation per technology and demand (*Netzlast*), 15 min, Germany and the 4 grid areas | CC BY 4.0 | "Bundesnetzagentur \| SMARD.de" | JSON API, no account | ✅ ready (WP36) |
| **DWD** Open Data | Measured sunshine (global radiation) and wind speed per weather station | CC BY 4.0 | "Deutscher Wetterdienst" (source must be named) | opendata.dwd.de, no account | ✅ ready (WP37) |
| **BKG VG1000-EW** | Population per state and district (for "per resident") | dl-de/by-2-0 | © GeoBasis-DE / BKG; population: © Statistisches Bundesamt (Destatis) | Download, no account | ✅ ready |
| **OpenStreetMap** | High-voltage power lines and substations (grid map) | ODbL 1.0 | "© OpenStreetMap contributors" | Overpass / extracts, no account | ⚠️ decision needed (share-alike, see below) |
| **netztransparenz.de** (the 4 TSOs) | Redispatch measures (grid congestion interventions) | Terms to be checked when the account exists | – | WebAPI needs a **free account** (OAuth) | ⏳ needs your registration |
| **ENTSO-E Transparency Platform** | Cross-border physical flows | Reuse allowed with attribution (ENTSO-E terms) | "ENTSO-E Transparency Platform" | API needs a **free security token** | ⏳ needs your registration |

## Not used

| Source | Why |
|---|---|
| **SMARD wholesale prices** | The Bundesnetzagentur asks not to reuse price data until the HEDWIG procedure is settled. |
| **Destatis GENESIS API** | Needs an account; the same population figures come with BKG VG1000-EW. |
| **IEA** | Most datasets are paid or restrict redistribution; Germany-level figures are covered by the sources above. |

## Decisions needed

1. **OpenStreetMap share-alike (ODbL):** if we publish a file derived from
   OSM grid data (e.g. `grid/lines.geojson`), that file must itself be offered
   under ODbL with attribution. This is common practice and only affects that
   one file, not the rest of the site. **Recommendation: accept.**
2. **Accounts (only you can create them):**
   - ENTSO-E: register at transparency.entsoe.eu, then e-mail
     transparency@entsoe.eu with the subject "Restful API access" to get a
     token.
   - netztransparenz: register in the WebAPI portal on netztransparenz.de to
     get client credentials.

   Tokens go into GitHub → Settings → Secrets, never into the code.
