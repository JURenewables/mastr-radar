# Station contracts — v1.5 (locked)

These contracts define exactly what each station of the data chain outputs.
They are **locked**: changing one is its own work package,
with a version bump, and pipeline and website are updated together.

```
1 Download ──▶ 2 Extract ──▶ 3 Build explorer files ──▶ 4 Website
```

Each station reads **only** the output of the station before it, and each has
a **check** that must pass before the next station runs.

Source column names (German) were confirmed against the real export of
30 Oct 2026 in WP4 (see `docs/data-dictionary.md`).

---

## Decisions in this contract

| # | Decision | Rule |
|---|---|---|
| D1 | Which capacity figure | **Gross capacity** (`Bruttoleistung`), as in BNetzA's own statistics. Net capacity is kept as a second column. |
| D2 | What counts as "installed" | Status **operating** only, for headline "installed capacity" figures. All statuses (planned, temporarily and permanently shut down) are kept in all files and are fully explorable via a status filter. |
| D3 | Which registrations | Only **active** registrations (`EinheitSystemstatus` = Aktiviert). |
| D4 | Private individuals | Units of natural persons get **no unit name, no operator name and no coordinates**. They appear in regional totals only. |
| D5 | Map points | Units **≥ 100 kW** appear as individual points (about 157 000 units, confirmed in WP4). Smaller units only in regional totals. |
| D6 | Size classes | `<10 kW`, `10–100 kW`, `100 kW–1 MW`, `1–10 MW`, `≥10 MW` |
| D7 | Place names | German, as in the register (Bayern, not Bavaria). Region keys use official municipality codes (AGS). |
| D8 | Offshore wind | **All** offshore wind units go to one of two extra regions, using MaStR's own sea field (`Seelage`): **Nordsee (offshore)** (`state_key` = `OFF_N`) or **Ostsee (offshore)** (`OFF_O`). Their `district_key` is the same value. This includes the 96 coastal-water turbines MaStR lists under Niedersachsen or Mecklenburg-Vorpommern; none of them has a municipality. |
| D9 | Technologies | Onshore wind, offshore wind, solar, storage, biomass, hydro. **Storage covers all electricity storage**: batteries, pumped hydro and other types, told apart by `storage_technology`. (Phase 2 only builds onshore wind.) |
| D10 | "Possibly incomplete" | Set **per technology**, because registration delays differ a lot (90% of wind within 3 weeks, storage about 4.5 months). |
| D12 | Data quality rules (v1.2) | Storage capacity is recorded per storage **plant** and split evenly over the plant's linked units. Storage capacity above 24 h per kW (pumped hydro: 100 h) is emptied. Impossible commissioning dates are emptied: solar before 1983, batteries before 2000. Every rule is counted in `extract_report.json`. |
| D13 | Operator names on the website (v1.2) | In the website's `units.parquet`, `operator_name` is shown only for units of 1 MW or more (and never for natural persons, D4). |
| D11 | How the export is read | **Our own reader**, not open-mastr. Station 1 downloads the export zip with resume and retry; station 2 reads the XML files from the zip directly. (open-mastr 1.0.0 failed on all solar files in WP4.) |

---

## Station 1 — Download

**Reads:** the BNetzA bulk export ("Gesamtdatenexport") from
marktstammdatenregister.de.
**Writes:** `data/raw/` (git-ignored, deleted after each daily run).

| File | Content |
|---|---|
| `data/raw/Gesamtdatenexport_YYYYMMDD.zip` | the export, unchanged |
| `data/raw/download_meta.json` | export date, source URL, size in bytes, SHA-256, duration, number of attempts |

The download resumes where it broke off and retries with increasing waits.

**Check:**
- the zip opens, and the integrity test (CRC) passes for every file we use;
- these files are present: `EinheitenWind*.xml`, `EinheitenSolar_*.xml`,
  `EinheitenStromSpeicher_*.xml`, `AnlagenStromSpeicher_*.xml`,
  `EinheitenBiomasse*.xml`, `EinheitenWasser*.xml`, `Marktakteure_*.xml`,
  `Katalogwerte.xml`;
- the export date is no older than 3 days;
- size is at least 1.5 GB (the 30 Oct 2026 export was 2.55 GB).

---

## Station 2 — Extract

**Reads:** `data/raw/Gesamtdatenexport_YYYYMMDD.zip`
**Writes:** `data/extract/units.parquet`: one row per unit, all technologies,
all statuses, English column names.

The XML stores many values as catalogue numbers (e.g. status `35`). These are
decoded with `Katalogwerte.xml` from the same zip. The source names below are
the decoded fields.

### Columns

**Identity and type**

| Column | Type | Meaning | Source |
|---|---|---|---|
| `unit_id` | string, **unique, required** | MaStR unit number, e.g. `SEE912345678901` | `EinheitMastrNummer` |
| `technology` | enum, required | `wind_onshore`, `wind_offshore`, `solar`, `storage`, `biomass`, `hydro` | file + `WindAnLandOderAufSee` for wind |
| `status` | enum, required | `operating`, `planned`, `temporarily_shut_down`, `permanently_shut_down` | `EinheitBetriebsstatus` |
| `name` | string, nullable | unit name (null for natural persons, D4) | `NameStromerzeugungseinheit` |
| `eeg_id` | string, nullable | EEG register number (kept for later auction linking) | `EegMastrNummer` (`EegMaStRNummer` in solar) |

**Capacity**

| Column | Type | Meaning | Source |
|---|---|---|---|
| `capacity_kw` | float ≥ 0, required | gross capacity in kW (D1) | `Bruttoleistung` |
| `net_capacity_kw` | float ≥ 0, nullable | net rated capacity in kW | `Nettonennleistung` |
| `size_class` | enum, required | D6 classes, from `capacity_kw` | derived |

**Dates**

| Column | Type | Meaning | Source |
|---|---|---|---|
| `commissioning_date` | date, nullable | when the unit went online (COD) | `Inbetriebnahmedatum` |
| `planned_commissioning_date` | date, nullable | planned COD (planned units) | `GeplantesInbetriebnahmedatum` |
| `registration_date` | date, required | when it was entered in MaStR | `Registrierungsdatum` |
| `shutdown_date` | date, nullable | final shutdown | `DatumEndgueltigeStilllegung` |
| `last_updated` | date, required | last change to the entry | `DatumLetzteAktualisierung` |

**Location**

| Column | Type | Meaning | Source |
|---|---|---|---|
| `state` | string, nullable | federal state; `Nordsee (offshore)` / `Ostsee (offshore)` for offshore (D8) | `Bundesland`, `Seelage` |
| `district` | string, nullable | district (Landkreis) | `Landkreis` |
| `municipality` | string, nullable | municipality | `Gemeinde` |
| `municipality_key` | string (8 digits), nullable | official municipality code (AGS) | `Gemeindeschluessel` |
| `district_key` | string, nullable | first 5 digits of the AGS; `OFF_N` / `OFF_O` for offshore (D8) | derived |
| `state_key` | string, nullable | first 2 digits of the AGS; `OFF_N` / `OFF_O` for offshore (D8) | derived |
| `postcode` | string (5 digits), nullable | postcode | `Postleitzahl` |
| `lat`, `lon` | float, nullable | coordinates (null for natural persons, D4) | `Breitengrad`, `Laengengrad` |

**Operator**

| Column | Type | Meaning | Source |
|---|---|---|---|
| `operator_id` | string, nullable | MaStR number of the operator | `AnlagenbetreiberMastrNummer` |
| `operator_name` | string, nullable | operator name (null for natural persons) | `Marktakteure.Firmenname` |
| `operator_is_person` | bool, required | operator is a natural person | `Marktakteure.Personenart` |

**Technology details** (null where not applicable)

| Column | Type | Applies to | Source |
|---|---|---|---|
| `manufacturer` | string | wind | `Hersteller` |
| `turbine_model` | string | wind | `Typenbezeichnung` |
| `hub_height_m` | float | wind | `Nabenhoehe` |
| `rotor_diameter_m` | float | wind | `Rotordurchmesser` |
| `wind_park` | string | wind | `NameWindpark` |
| `solar_type` | enum: `ground_mounted`, `rooftop`, `balcony`, `other` | solar | `ArtDerSolaranlage` (Freifläche / Gebäude / Steckerfertig / Sonstige) |
| `storage_technology` | enum: `battery`, `pumped_hydro`, `other` | storage | `Technologie` |
| `storage_capacity_kwh` | float | storage | the unit's share of its plant's usable capacity: `AnlagenStromSpeicher.NutzbareSpeicherkapazitaet` (linked via `SpeMastrNummer`) divided by the number of units in `VerknuepfteEinheitenMaStRNummern`; emptied if implausible (D12) |
| `battery_technology` | string | storage | `Batterietechnologie` |
| `fuel` | string | biomass | `Hauptbrennstoff` |
| `hydro_type` | string | hydro | `ArtDerWasserkraftanlage` |

### Check

- `unit_id` unique and never empty; required columns have no nulls.
- Enums contain only the listed values.
- Row counts are plausible: wind ≥ 40 000, solar ≥ 6 000 000,
  storage ≥ 2 500 000, biomass ≥ 20 000, hydro ≥ 8 000.
- `capacity_kw` ≥ 0. Values above 2 000 MW are flagged as outliers.
- Dates are between 1890 and the export date. Planned dates may be in the
  future.
- Coordinates lie inside Germany plus its sea area (lat 47–56, lon 5.5–15.5).
  Anything outside is set to null and counted.
- **Privacy:** if `operator_is_person` is true, then `name`, `operator_name`,
  `lat` and `lon` are null. No exceptions.
- Data quality rules D12 are applied before the check; the check verifies
  that no impossible commissioning date remains.
- Row count per technology changes by less than 5% from the previous run
  (warning, not failure).

---

## Station 3 — Build explorer files

**Reads:** `data/extract/units.parquet`
**Writes:** `web/public/data/`: the only files the website reads.

| File | Built from | Content |
|---|---|---|
| `manifest.json` | WP7 | as-of date, contract version, file list with row counts |
| `kpis.json` | WP7 | headline numbers per technology |
| `units.parquet` | WP11 | individual units ≥ 100 kW (D5), for map points and tables |
| `summary.parquet` | WP11 | totals for **all** units, incl. small ones |
| `boundaries/states.geojson` | WP11 | state outlines (BKG), keyed by `state_key` |
| `boundaries/districts.geojson` | WP11 | district outlines (BKG), keyed by `district_key` |

### `manifest.json`

| Field | Meaning |
|---|---|
| `contract_version` | `"1.2"` |
| `as_of` | export date of the MaStR data (`YYYY-MM-DD`) |
| `generated_at` | when the pipeline ran (UTC timestamp) |
| `pipeline_version` | version of the pipeline code |
| `incomplete_after` | **per technology** (D10): `{ "wind_onshore": "YYYY-MM-DD", … }`, the date after which that technology's data is likely incomplete because of late registrations (measured in WP12) |
| `files` | for each file: name, row count, size in bytes |

### `kpis.json`

One entry per technology:

| Field | Meaning |
|---|---|
| `technology` | as in station 2 |
| `installed_capacity_kw` | sum of `capacity_kw`, status operating |
| `installed_units` | number of operating units |
| `planned_capacity_kw` | sum of `capacity_kw`, status planned |
| `added_capacity_kw_ytd` | commissioned since 1 January of the as-of year |

### `units.parquet` (units ≥ 100 kW)

The same columns as station 2, **minus** `eeg_id`, `postcode` and
`last_updated` (the site doesn't need them). `operator_name` is empty for
units below 1 MW (D13).

### `summary.parquet` (all units)

One row per combination of:

| Column | Meaning |
|---|---|
| `technology`, `status`, `size_class` | as in station 2 |
| `state_key`, `district_key` | region (offshore: `OFF_N` / `OFF_O`, D8) |
| `commissioning_month` | `YYYY-MM`, null for units not yet online |

Values: `unit_count`, `capacity_kw`.

### Check

- Each file matches its schema. `manifest.json` lists every file and its
  row count is correct.
- **Totals match:** capacity per technology in `summary.parquet` equals the
  sum in station 2's `units.parquet`.
- **Privacy:** no row in `units.parquet` has a name or coordinates for a
  natural person.
- Total size of `web/public/data/` is below 25 MB.

---

## Station 4 — Website

**Reads:** only `web/public/data/`. No other data source, no server.

The website must always:
- show `as_of` from `manifest.json` on every page;
- show the footer `© Bundesnetzagentur, DL-DE-BY-2.0` (linked to the
  licence), "Data processed by MaStR Radar" and, where maps are used,
  `© GeoBasis-DE / BKG`;
- mark periods after a technology's `incomplete_after` date as possibly
  incomplete in charts;
- refuse to load and show a clear message if `contract_version` is not one it
  understands.

---

## v1.3: monitor files (approved 31 Oct 2026)

Additive only: nothing above changes. Station 3 also writes three compact JSON
files for the scrolling monitor page, so phones don't need the in-browser
database. `manifest.json` lists them and `contract_version` becomes `"1.3"`.
Values are MW, rounded, unless named otherwise. Boundaries gain an
`area_km2` property (equal-area projection, from the unsimplified outline).

**Series units (D14):** yearly series use every unit that is not planned,
except permanently shut-down units without a shutdown date (retirement year
unknown). "Installed at the end of year Y" = commissioned in or before Y and
not shut down by Y; it includes temporarily shut-down units, so it can be up
to ~2 % above the headline "in operation" figure (biomass).

| File | Content |
|---|---|
| `monitor/buildout.json` | `years` (first_year…as-of year), `techs`; `national[tech]` with `added`, `retired`, `installed`, `units_added` per year; `district[tech][district_key]` = installed per year (offshore under `OFF_N`/`OFF_O`) |
| `monitor/points.json` | `operating`: flat integer array, 5 per plant: lon×100, lat×100, commissioning year − first_year, technology index (in `techs`), MW. Only plants in operation, ≥ 1 MW, with public coordinates (never natural persons, D4). `planned_onshore`: 3 per turbine: lon×100, lat×100, MW |
| `monitor/stats.json` | `installed_mw`, `targets_2030_mw` (EEG 2023 §4, WindSeeG §1), `ytd_cumulative_mw[tech][year]` (cumulative by month, as-of year and the 3 before), `solar_by_type` (MW and units per year by type), `onshore_turbines` (count, average MW, hub height and rotor diameter per year), `battery_storage` (MW, MWh, units per year: home < 30 kW, commercial 30 kW–1 MW, large ≥ 1 MW), `states` (operating and planned MW per technology, area), `top_districts` (top 10 by MW per km² per technology), `repowering` (onshore turbines in operation older than 20 years), `planned_mw` |

**Check:**
- all three files present, listed in the manifest with correct sizes;
- series complete for every technology and year, no negative additions;
- installed at the end of the series within 3 % of `kpis.json` per technology;
- point arrays well-formed, coordinates inside Germany and its seas;
- `stats.json` has every key above and the right `as_of`.

---

## v1.4: data hub, "Germany in 24 hours" (approved 31 Oct 2026)

Additive only. A second, independent chain feeds the hub. It never touches
the MaStR chain above, and a failure in it never blocks the MaStR update.

```
H1 Fetch ──▶ H2 Build day files ──▶ Website (24-hour section, catalogue)
SMARD, DWD     data/hub/ cache →      web/public/data/days/
```

### H1 Fetch

Writes a local cache in `data/hub/` (git-ignored): SMARD weekly series files
and DWD station files (10-minute global radiation, hourly wind; the 'recent'
files, about the last 500 days), as downloaded. Only sources listed as ready in
`docs/sources.md` may be fetched.

**Check:** HTTP success; every requested series present; at least 90 % of
the quarter hours of each finished day have values.

### H2 Build day files

One file per calendar day in German local time (Europe/Berlin), for the last
365 days, in `web/public/data/days/`:

**`days/YYYY-MM-DD.json`**

| Field | Meaning |
|---|---|
| `date` | the day (`YYYY-MM-DD`, local time) |
| `slots` | number of quarter hours: 96, or 92 / 100 on clock-change days |
| `start_utc` | first quarter hour, UTC timestamp |
| `regions` | `DE`, `50Hertz`, `Amprion`, `TenneT`, `TransnetBW` |
| `generation_mw[region][tech]` | average power per quarter hour, MW (SMARD MWh × 4), rounded; `null` where missing. Techs: `solar`, `wind_onshore`, `wind_offshore`, `biomass`, `hydro`, `other_renewable`, `lignite`, `hard_coal`, `gas`, `pumped_storage`, `other_conventional` |
| `demand_mw[region]` | grid load (*Netzlast*), MW |
| `residual_load_mw[region]` | demand minus solar and wind, MW (SMARD) |
| `weather` | `hours` (23/24/25), `solar_stations` and `radiation_wm2` (mean global radiation per local hour, W/m², integer), `wind_stations` and `wind_dms` (mean wind speed at 10 m, in 0.1 m/s, integer). Stations with < 80 % of the day's hours are left out that day. Coordinates in `days/stations.json` |
| `cleaned_values` | number of source values emptied by the night-solar rule |
| `sources` | attribution strings, exactly as in `docs/sources.md` |

**`days/stations.json`**: `solar` and `wind`: lists of [station id, lat, lon,
name] (DWD).

**`days/index.json`**: `contract_version`, `first`, `last`, `dates` (all
available days, ascending), and for each day the file size.

**Rules:**
- A day is written only once every series is at least 90 % filled; recent
  days are added by a later run when SMARD has filled them. Today is never
  written.
- Solar values at night (22:00–04:00) above 2 % of the day's peak are source
  errors: emptied and counted in `cleaned_values`.
- Nuclear is not included: no German plant has run since 15 April 2023.
- Series that do not exist for a grid area (e.g. offshore wind in Amprion)
  are zero there.
- Days older than 365 days are deleted.
- Wholesale prices are never included (`docs/sources.md`).

**Check:**
- slot count matches the day's length in local time;
- at most 10 % `null` per series;
- solar generation stays below 2 % of the day's peak between 23:00 and 03:00
  local time;
- the four grid areas add up to `DE` for solar, onshore wind and demand,
  within 5 % of the national value plus 1 % of the day's demand;
- weather: hours match the day, at least 50 radiation and 100 wind stations,
  radiation 0–1500 W/m², wind 0–60 m/s;
- `days/` stays below 30 MB; `web/public/data/` as a whole below 50 MB (raised
  from 25 MB).

### Population (for "per resident")

`monitor/stats.json` `states[]` gains `population` (BKG VG1000-EW,
reference date 31 Dec of the latest available year).

---

## v1.5: turbine makers and auctions (approved 31 Oct 2026)

Additive only: nothing above changes. `contract_version` becomes `"1.5"`
(manifest and day-file index); the website still accepts 1.4 files.

### Turbine makers (`monitor/stats.json` → `wind_industry`)

Onshore wind units of the series (D14). Registered manufacturer names are
grouped into brands with the regular expressions in
`pipeline/config/wind_brands.yaml` (e.g. REpower and Senvion → "Senvion
(REpower)"; Siemens, Gamesa and Siemens Gamesa → "Siemens Gamesa"). Units
without a matching name count as "Other".

| Key | Content |
|---|---|
| `years` | first_year … as-of year |
| `brands` | the 12 brands with the most capacity ever built, then `"Other"` |
| `added_mw[brand]`, `installed_mw[brand]` | MW per year, same definition as `buildout.json` |
| `recent_models_since` | as-of year − 2 |
| `recent_models[]` | top 15 model families since then by MW: `brand`, `model` (rotor-size family, e.g. `V162`), `units`, `mw`, `avg_mw`, `avg_hub_height_m`, `avg_rotor_diameter_m` |
| `brand_specs[brand]` | the 5 brands with most MW since 2015: `years` (since 2005, ≥ 10 turbines), `avg_mw`, `avg_hub_height_m`, `avg_rotor_diameter_m` |
| `unattributed_share` | share of onshore capacity counted as "Other" |

**Check:** key present; series complete for every brand; `unattributed_share`
at most 5 % (else the brand list needs updating).

### Auctions (`auctions/onshore.json`, `auctions/awards.json`)

New input chain: **A1 fetch** (`mastr-radar auctions-fetch`) downloads the
BNetzA page and award list (.xlsx) of every finished onshore round listed in
`settings.yaml → auctions.onshore_rounds` into `data/auctions/` (cached).
**A2 build** runs inside station 3 (`aggregate`), because it links award
turbines to station 2's `units.parquet` via the register numbers (`SEE…` =
`unit_id`, `EEG…` = `eeg_id`). Bidders are grouped with the rules in
`pipeline/config/auction_groups.yaml`.

**`auctions/onshore.json`**

| Key | Content |
|---|---|
| `source`, `categories` | source line; category keys → labels (`developer`, `utility`, `citizen`, `unattributed`) |
| `rounds[]` | `id`, `bid_date`, `published`, `ceiling_ct`, `volume_kw`, `min_ct`, `avg_ct` (volume-weighted), `max_ct`, `awards`, `awarded_kw` (all from the round page); `list_kw`, `list_awards` (from the award list, may include late awards); `kw_by_category`, `kw_by_maker` (kW of linked turbines per brand); `turbines`, `turbines_in_mastr`, `turbines_operating` |
| `winners_by_year[year][]` | top 15 company groups by awarded kW (bucket groups such as "Citizen wind farms" excluded): `group`, `category`, `kw`, `share` (of the year's awarded kW), `awards`, `rounds` |
| `unattributed_share` | share of awarded kW without a group |

**`auctions/awards.json`** → `awards[]`, one per award: `round`, `bid_date`,
`award_no`, `bidder` (null unless the name carries a company legal form, D4),
`group`, `category`, `kw`, `state`, `turbines`, `turbines_in_mastr`,
`turbines_operating`, `maker`, `model` (most common among its turbines).

**Check:** rounds match the settings; every round has dates, ceiling and the
three prices with min ≤ avg ≤ max ≤ ceiling; award list within ±10 % of the
published awarded kW; ≥ 90 % of listed turbines found in MaStR; categories
add up; award rows match the rounds. Licence: see `docs/sources.md`.

---

## v1.6 draft: auction yield, five bidder types, winners over time (waiting for approval)

Changes the v1.5 auction files; nothing else. Until approved, the files exist
only on the branch preview and `contract_version` stays `"1.5"`.

**Rounds:** every onshore round since May 2019 (34 so far), listed in
`settings.yaml → auctions.onshore_rounds` with their page `path`. Earlier
rounds list old register numbers (A…) that cannot be linked to MaStR. Lists
without a kW column take kW from the site text or, failing that, from the
linked MaStR turbines (`kw_source: "mastr"`).

**Bidder types (five):** `developer` (Developers & IPPs, incl. Alterric),
`utility` (RWE, EnBW, Vattenfall, Uniper, E.ON, …), `municipal` (Stadtwerke
and their associations, incl. enercity, Trianel), `citizen`, `unattributed`.

**Yield estimate (A1 also fetches the DWD wind grid):** for every linked
turbine with coordinates, hub height, rotor and rating: DWD 200 m grid mean
wind at 80/100 m and Weibull k at 80 m → speed at hub height (shear from the
two layers) → generic power curve → gross yield; net full-load hours =
gross × (1 − 12 %); quality factor = gross yield / yield of the same turbine
at the EEG reference site; correction factor from the EEG table of the bid
year. Settings: `pipeline/config/wind_yield.yaml`.

**`auctions/onshore.json` changes**

| Key | Content |
|---|---|
| `rounds[]` | adds `kw_source`, `turbines_old_id`, `yield_share`, `full_load_hours_avg`, `quality_pct_avg`, `correction_factor_avg`, `received_ct_est` (= `avg_ct` × correction factor); `min_ct`, `max_ct`, `ceiling_ct`, `published`, `awarded_kw` may be null for older pages |
| `merit_order[round]` | `[MW, full-load hours, quality %, category index]` per award, best sites first |
| `winners_by_year[year \| "all"][]` | top 20 incl. buckets (`"Not attributed"`, `"Citizen & local (all)"`, `"Other Stadtwerke"`) with `bucket: true` |
| `race` | `years`, `groups` (top 15 groups + the three buckets), `categories`, `kw[group][year]` |
| `kw_by_category_year[category][year]` | awarded kW |
| `operating_from_awards[]` | MW of awarded turbines now in operation, by group |
| `fleet` | all onshore wind in operation by operator group (MaStR operator names): `total_mw`, `groups[]`, `mw_by_category` |
| `drivers[category]` | `awarded_mw`, `awards`, `distinct_bidders`, `median_award_mw`, `quality_pct_avg`, `full_load_hours_avg`, `median_months_to_operation`, `realised_share` (awards before `drivers_realised_cutoff`) |
| `model` | wind source, losses, power coefficient, reference site, correction tables |
| `company_reported[]` | company-announced totals per round next to ours: `group`, `round`, `bid_date`, `reported_mw`, `qualifier` (exact/about/over), `ours_mw`, `note`, `source` |
| `reviewed_awards` | number of awards assigned by hand |

**Reviewed attributions:** `pipeline/config/auction_reviewed.yaml` assigns
awards to groups where a public source names the project (overrides the name
rules; each entry cites its source) and lists company-reported totals.

**`auctions/awards.json`** adds per award: `attribution` (`reviewed`, `name`,
`none`), `rank_group`, `kw_source`,
`kw_in_mastr`, `kw_operating`, `months_to_operation`, `hub_height_m`,
`rotor_diameter_m`, `wind_ms`, `full_load_hours`, `quality_pct`,
`correction_factor`, `received_ct_est`, `lat`/`lon` (centre of its turbines,
2 decimals; null unless the bidder is a company, D4).

**Check:** as v1.5, plus ≥ 90 % of turbines with a MaStR id found; yield
estimate for ≥ 80 % of each round's capacity; average full-load hours
between 1,500 and 4,500; no location for a bidder without a company name;
every reviewed assignment matches at least one award and names a known group;
every reported total has a source and a known round.

---

## Version history

| Version | Date | Change |
|---|---|---|
| 1 | 2026-10-30 | First version, approved and locked |
| 1.1 | 2026-10-30 | After WP4 data check: own reader instead of open-mastr (D11); station 1 writes the export zip; offshore regions from `Seelage`, all offshore units included (D8); storage includes pumped hydro, new `storage_technology` column (D9); `incomplete_after` per technology (D10); confirmed source names and plausible row counts |
| 1.2 | 2026-10-31 | Data quality rules D12 (storage capacity split per plant, plausibility limits, impossible dates); operator names on the website only from 1 MW (D13). Approved by the user. |
| 1.3 | 2026-10-31 | Monitor files `monitor/buildout.json`, `points.json`, `stats.json`; boundaries `area_km2`; series definition D14. Approved by the user. |
| 1.4 | 2026-10-31 | Data hub chain H1/H2, day files `days/` with SMARD and DWD weather, `stations.json`, population in `states[]`, size budget 50 MB. Approved by the user. |
| 1.5 | 2026-10-31 | Turbine makers (`wind_industry` in `stats.json`), auctions chain A1/A2 with `auctions/onshore.json` and `auctions/awards.json`. Approved by the user. |
