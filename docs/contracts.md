# Station contracts — v1.6 (locked)

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

## v1.6: auction yield, bidder types, office attribution, maps (approved 1 Nov 2026)

Changes the v1.5 auction files and adds the internal station 2 company
register. `contract_version` becomes `"1.6"`; the website still accepts older
files.

**Station 2 adds `data/extract/operators.parquet`** (internal, never
published): every organisation in `Marktakteure` (natural persons left out,
D4) with `operator_id`, `name`, `street`, `house_number`, `postcode`, `city`,
`register_court` (decoded), `register_number`. Check: contract columns,
≥ 100,000 rows, unique ids. Written by `mastr-radar extract` (or
`extract-operators` on its own).

**Office attribution:** an unknown bidder counts for a group when the
operator company of its turbines (or the bidder itself) is registered at an
office where every named company belongs to that group, or at least 2 do and
make up ≥ 60 % of the named companies. Reviewed `addresses` take precedence;
`office_exclusions` (with source) switch the rule off for single bidders.

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
| `attribution_kw` | awarded kW by method: `reviewed`, `name`, `office`, `none` |
| `kw_by_state_year[state][year]` | awarded kW per state and year |
| `company_profiles[]` | named groups with ≥ 50 MW: `kw_by_year`, `awards`, `rounds`, `first_bid`, `last_bid`, `median_award_mw`, `kw_by_state` (top 6), `states`, `kw_by_maker`, `full_load_hours_avg`, `quality_pct_avg`, `realised_share`, `attribution_kw` |
| `median_award_mw` | median award size over all awards |
| `points` | map of awards: `groups[]` and `rounds[round]` = flat integers, 6 per award (lon×100, lat×100, kW/100, category index, group index or −1, full-load hours or 0); only awards with a public location (companies, D4) |

**Reviewed attributions:** `pipeline/config/auction_reviewed.yaml` assigns
awards to groups where a public source names the project (overrides the name
rules; each entry cites its source) and lists company-reported totals.

**`auctions/awards.json`** adds per award: `attribution` (`reviewed`, `name`,
`office`, `none`), `rank_group`, `kw_source`,
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

## v1.7: solar auctions, unit details, success drivers, dynamics, company facts, market risk, players, grid (approved 1 Nov 2026)

Additive. Until approved, the files exist only on the branch preview and
`contract_version` stays `"1.6"`.

**Station 2 adds `data/extract/unit_details.parquet`** (internal, never
published): all onshore wind units, solar units that are not building or
balcony units or are ≥ 100 kW, and storage ≥ 100 kW. Columns: `unit_id`,
`technology`, `location_id`, `grid_voltage` and `grid_capacity_kw` (from
`Netzanschlusspunkte` via the unit's location), `award_no`, `award_kw`,
`yield_ratio_pct` (from the EEG plant record; the declared ratio of estimated
to reference yield for wind), `permit_date`, `permit_kind`
(`EinheitenGenehmigung`), `solar_kind`, `solar_orientation`, `solar_tracker`,
`solar_area_ha`, `solar_land_before`, `solar_features`, `storage_same_site`,
`high_voltage`, `park_name`. Check: contract columns, ≥ 30,000 rows, unique
ids. Written by `mastr-radar extract` (or `extract-details` on its own).

**Solar auctions** (`settings.yaml → auctions.solar_rounds`,
`innovation_rounds`; cached in `data/auctions/solar/`; DWD radiation grid in
`data/auctions/dwd/`). Prices per round since 2019 (innovation since 2021);
award-level analysis where the list gives kW (ground-mounted solar since
2023, innovation since Sept 2023). Awards link to MaStR through the award
number stored in the plant's EEG record (innovation: also register numbers).
Location: centre of the linked units, else the municipality centre from
public unit coordinates. Yield = DWD global radiation 1991–2020 × system
factor (fixed south 1.12, east-west 1.00, tracker 1.30) × performance ratio
0.85 (`config/solar_yield.yaml`). Battery on site = MaStR flag, a linked
battery unit, or a battery ≥ 500 kW within 1 km. Portfolio = ≥ 2 awards of
one group (or one bidder) in the same district and round.

**`auctions/solar.json`**: `rounds[]` (programme, prices, ceiling, awarded
kW, `award_level`, `max_award_kw`, `kw_by_category`, `linked_share`,
`co_located_share`, `co_located_known_kw`, `tracker_share`, `special_share`,
`specific_yield_avg`), `winners_by_year`, `race`, `kw_by_category_year`,
`kw_by_state_year`, `portfolios` (`by_round`, `largest`), `company_profiles`,
`points` (7 integers per award: lon×100, lat×100, kW/100, category, group,
kWh/kWp, battery 1/0/−1), `attribution_kw`, `unattributed_share`,
`grid_voltage_kw`, `cross_tech` (groups in wind and solar since 2023),
`model`. **`auctions/solar_awards.json`**: one row per award (bidder only for
companies, D4).

**Wind additions in `auctions/onshore.json`**: quality factor calibrated with
the declared MaStR ratios (`model.calibration`: factor, n, correlation;
declared value used where present); `success` (award rate of permitted
turbines by permit year, site-quality band and grid voltage; voltage by
bidder type; company volume vs site quality with Spearman correlation).

**Check:** solar rounds match settings; prices in order; award list within
±10 % of the published total; average specific yield 850–1,500 kWh/kWp; no
location for bidders that are not companies; no NaN in published JSON.

**Rise and fall (`dynamics` in `auctions/onshore.json` and `auctions/solar.json`)**
(WP68): per company group with ≥ 100 MW awarded (named groups only):
`kw_by_year`, `share_early` / `share_late` (mean yearly share in the first and
last third of the years), `momentum_pp`, `rounds_won`, `rounds_possible`
(rounds since the first award), `hit_rate`, `volatility` (coefficient of
variation of yearly kW since the first award), `first_bid`, `last_bid`,
`status`: `new` (first award in the last third of the rounds), `dropped` (no
award in the last `recent_rounds` rounds: 6 wind, 4 solar), `rising` /
`fading` (share change ≥ +0.5 / ≤ −0.5 points), else `steady`.

**Company facts (`auctions/company_facts.json`)** (WP69): built from the
hand-checked `pipeline/config/company_facts.yaml`. `as_of`; `companies`
(`group` as in auction_groups.yaml, `model` develop_sell / ipp / mixed /
investor, `finance` project / corporate / fund / mixed / null,
`international`, `note`, `sources`); `events` (`company`, `group`, `date`
YYYY-MM, `kind` insolvency / restructuring / sales_halt / exit, `tech` wind /
solar / both, `issue`, `sources`), sorted by date; `oems` (GWEC ranking:
`source_year`, `scope`, `makers` with `gw` and optional `countries`, `notes`,
`sources`), `market` (`oversubscription`: tech, bid_date, tender_mw,
submitted_mw, bids, source, from BNetzA press releases; `facts`: tech, text,
source). **Check:** every entry has at least one https source; codes from
the lists above; dates YYYY-MM; GW > 0; submitted ≥ tender > 0.

**Market risk (`auctions/market_risk.json`)** (WP70): built from the files
above. `as_of`; per technology (`wind`, `solar`): `deadline_months` (36 for
wind, § 36e EEG; null for solar), `rounds` (id, programme, bid_date,
published, ceiling_ct, avg_ct, awarded_kw, operating_kw = linked units in
operation, unbuilt_kw, expires = published + deadline, past_deadline),
`unbuilt_kw` (rounds not past the deadline), `unbuilt_expiring_12m_kw`,
`past_deadline_unbuilt_kw`, `price_peak` / `price_last` (highest average of
the last 12 main-programme rounds, latest), `exposure` (unbuilt kW of groups
with an insolvency or restructuring event), `market`, `facts`. **Check:**
0 ≤ operating ≤ awarded; unbuilt = awarded − operating; exposure within
awarded.

**Players (`auctions/players.json`)** (WP72): built from the hand-checked
`pipeline/config/players.yaml`. `as_of`; `players` (name, group as in
auction_groups.yaml or null, type utility / municipal / ipp / investor /
developer, hq, owner, year, employees {value, unit, note}, currency, revenue,
ebitda {value, label}, net_debt (negative = net cash), capacity_gw,
renewables_gw, own_portfolio_gw, capacity_note, markets, mix, turbines,
momentum forward / steady / transition / stuck, why, sources) plus `germany`
(wind_awarded_mw, wind_status, solar_awarded_mw, solar_status, wind_fleet_mw,
joined from the auction files). **Check:** known type and momentum; a reason
for every momentum; https sources; money needs a currency; employees a
positive integer with unit; capacities in range.

**Station 2 grid register (internal, never published)** (WP71):
`data/extract/grid_units.parquet` (unit_id, grid_operator_id, control_area,
voltage: extra_high / extra_high_to_high / high / high_to_medium / medium /
medium_to_low / low) for the units in unit_details.parquet, from the grid
connection point with the largest capacity; `grid_operators.parquet`
(operator_id, tso, dso) for electricity grid operators;
`consumers.parquet` (large electricity consumers: unit_id, status, state,
district, district_key, lat, lon, units_over_50mw, commissioning_date,
planned_date, operator_id, control_area). Command `mastr-radar extract-grid`
(also part of `extract`). **Check:** columns; ≥ 20,000 grid units, ≥ 500
consumers; four TSOs.

**Grid (`grid/grid.json`)** (WP71): `as_of`, `scope`, `coverage_share`
(share of large-unit capacity with grid data), `control_areas` (four TSOs:
kW by technology in operation, planned kW, large consumers operating and
planned), `operators` (registered, tsos, with_large_units, top10_share,
operators_for_half, top 25 with name, tso, kW by technology, units, share,
high_voltage_share), `voltage` (kW by technology per level), `areas`,
`districts` (district key → [area index, wind+solar kW, storage kW]),
`consumers` (operating, planned, sites_with_units_over_50mw, by_state,
planned_by_year, points: lon×100, lat×100, status 1/2, over-50-MW flag; no
names), `context` (from `config/grid_facts.yaml`: congestion costs and
volumes by year, 2025 cost split, facts, regulation timeline; every item
sourced). **Check:** the four areas; coverage ≥ 50 %; ≥ 300 districts; points
in fours; every context item has an https source.

---

## v1.8: grid APIs (Netztransparenz redispatch, ENTSO-E flows) (approved 2 Nov 2026)

New sources need credentials, read only from the environment (GitHub
Secrets `NETZTRANSPARENZ_CLIENT_ID`, `NETZTRANSPARENZ_CLIENT_SECRET`,
`ENTSOE_TOKEN`); never logged or stored.

**G1 fetch** (`mastr-radar grid-fetch`): Netztransparenz `data/redispatch`
(TSO redispatch and countertrade measures since Jan 2021), one CSV per month
in `data/grid/nt/`; ENTSO-E physical flows (documentType A11) between DE-LU
and each neighbouring bidding zone (AT, BE, CH, CZ, DK1, DK2, FR, NL, NO2, PL,
SE4) for about 13 months, one JSON per month and neighbour in
`data/grid/entsoe/`. The last two months are fetched again on every run.

**G2 extract (internal)** (`mastr-radar grid-extract`):
`data/extract/redispatch.parquet` (start, end UTC; reason; category current /
voltage / countertrade / test / other; direction down / up; mw_avg, mw_max,
mwh; tso; requesting_tso; asset; asset_is_substation; energy conventional /
renewable / other) and `data/extract/flows.parquet` (time UTC hourly,
neighbour, import_mw, export_mw). German names are mapped in
`config/columns.yaml`. **Check:** columns; ≥ 1,000 measures; ≤ 1 % unknown
direction, ≤ 5 % unknown energy; no negative MWh; ≥ 8 neighbours; no
negative flows.

**G3 build** (`mastr-radar grid-build`, also part of `aggregate` when the
extracts exist): `grid/redispatch.json` (first, last; `monthly` with down and
up MWh by energy, excluding test runs and countertrade, plus countertrade MWh;
`by_tso_down_mwh` per year; `category_mwh`; `last_12m`: down/up MWh by
energy, countertrade, measures, top 15 renewable substations by curtailed
MWh, top 15 conventional plants reduced and increased) and `grid/flows.json`
(first, last, neighbours, `monthly_net_import_gwh` per neighbour,
`last_12m` import and export GWh per neighbour, `net_import_by_hour_utc_mw`
average over the last 12 months). Only aggregates are published; raw
Netztransparenz rows are not redistributed. **Check:** ≥ 12 months in order;
no negative values; reductions present; ≥ 8 neighbours; 24 hourly values.

## v1.9: auction run-up, outlook (repowering, auction outlook), phone report (approved 25 Nov 2026)

**Station 2:** `unit_details.parquet` gains `permit_registered` (date the
permit was entered in MaStR, `Registrierungsdatum` of the permit record).

**Station 3, `auctions/onshore.json`:** each round gains `permit_deadline`
(date by which permits must be issued and registered in MaStR, parsed from
the round page; null where the page gives none, i.e. before 2022).

**`auctions/runup.json`** (WP85): `as_of`; `wind.rounds` (id, bid_date,
permit_deadline, deadline_days, turbines linked via the award lists,
`permit_days` and `unit_days`: days from the bid date to the registration of
each awarded turbine's permit and of the turbine itself, kept within ±365
days, and a summary of each: n, median_days, share_before_bid,
share_last_8_weeks; `eligible_earlier`: n, share_1plus, share_2plus of
awarded turbines whose permit was registered before the deadline of one, or
two or more, earlier rounds; rounds with a deadline only);
`wind.awarded_turbines`, `wind.reawarded_turbines` (turbines on the award
lists of two or more rounds); `wind.weekly_permits` (weeks from 2019, units and MW of
onshore wind whose permit was registered that week); `solar.rounds` (id,
bid_date, awards, `unit_days`: days from the bid date to the first
registration of the awarded park, summary); `solar.weekly_ground_mounted`
(ground-mounted parks ≥ 750 kW registered per week). **Check:** ≥ 10 wind
rounds; ≥ 1,000 awarded turbines with a permit date; weekly arrays aligned
and ≥ 100 weeks; ≥ 5 solar rounds.

**`outlook/outlook.json`** (WP86–87): `as_of`; `repowering` (eeg_years,
next_wave_years from `config/outlook.yaml`; `old` and `next_wave` units and
MW; `potential` with its assumptions; `by_state_mw`; `districts` (key →
[old MW, old units, next-wave MW]); `points` (lon×100, lat×100, kW/10, class
1 = past EEG support, 2 = next wave; public locations only); `models` (top 12
brand and model family of old turbines with hub height and rotor); `owners`
(top 15 groups or legal entities, units ≥ 1 MW only); `retired_mw_by_year`,
`added_mw_by_year`) and `auction_outlook` (wind: next four bid dates,
permitted pool without award in MW and by permit year, awarded but not
built, average volume of the last four rounds, rounds covered, recent rounds,
oversubscription; solar: next bid dates, recent rounds, oversubscription).
**Check:** ≥ 1,000 old turbines; points in fours; ≥ 100 districts; four
ordered bid dates; pool ≥ 0.

**Phone report** (WP88): `mastr-radar notify` sends a short daily summary
(installed capacity per technology with the change since the previous
update, added this year, latest onshore award) through a Telegram bot, and a
message when the daily run fails. Needs GitHub Secrets `TELEGRAM_BOT_TOKEN`
and `TELEGRAM_CHAT_ID`; without them nothing is sent.

## v1.10: data dictionary, agent context, MCP server (approved 25 Nov 2026)

Phase 9 (WP75–WP84). The MCP server reads **only** the published explorer
files (station 4 side), so privacy rules D4 and D13 and the
Netztransparenz aggregates-only rule carry over unchanged.

### Data dictionary (WP75)

**Source:** `pipeline/config/data_dictionary.yaml`, the one place where every
published file and field is described. **Output:** `dictionary.json` in
`web/public/data/` (listed in the manifest) with `site`, `data_base`,
`conventions`, `licences` (id → name, url, attribution), `glossary`,
`datasets[]` (file, title, grain, licence, caveats, questions, `fields`:
name → `{type?, unit?, desc}`; `optional: true` for `days/`) and
`starter_queries[]` (question, DuckDB SQL with a `{data}` placeholder).
**Check (station 3, fails loudly):** every published file has an entry; every
Parquet column, GeoJSON property or top-level JSON key is described and no
described field is missing; every licence id is known; title and grain set.
A test runs every starter query against the published files.

### Agent context (WP76)

Generated by the website from `dictionary.json` and the manifest at build
time: `/llms-full.txt` (all datasets with fields, caveats, licences, starter
queries), `/schema.json` (JSON Schema per dataset plus starter queries),
the field list per dataset on `/open-data`, and a link from `/llms.txt`.

### Query engine (WP77, decided)

DuckDB for Node (`@duckdb/node-api`, exact pin) inside the Vercel function,
reading the published files bundled with the function. Each Parquet/JSON
file is exposed as a read-only **view** named after its path (`units`,
`summary`, `kpis`, `auctions_onshore`, `grid_redispatch`, …), plus flat
views over the main lists: `wind_awards`, `solar_awards`, `wind_rounds`,
`solar_rounds`, `players`, `redispatch_monthly` (all listed by
`list_datasets`). After the views are created the engine is locked:
`allowed_directories` = the data folder, `enable_external_access = false`,
no extension install/load, `lock_configuration = true`, 2 threads, 512 MB.

### MCP server (WP79 contract, built in WP80–81)

- **Endpoint:** `https://mastr-radar.vercel.app/mcp`, MCP Streamable HTTP,
  stateless (no session id), JSON responses, read-only, no login. Server
  name `mastr-radar`, version = `pipeline_version` of the manifest.
- **Every tool result** is a JSON object with `as_of`, `contract_version`,
  `source` (dataset files used), `licence` (attribution lines that apply),
  `caveats` (e.g. "months after `incomplete_after` are incomplete") and
  `data`. Also returned as text for clients without structured output.
- **Errors** (tool result with `isError: true`, `code` + plain message):
  `bad_input`, `not_found`, `query_rejected` (not a single SELECT/WITH),
  `query_timeout`, `too_many_rows` (result truncated: also flagged in a
  normal result as `truncated: true`), `rate_limited`, `internal`.

**Tools v1 (WP80)**

| Tool | Input | Output `data` |
|---|---|---|
| `list_datasets` | – | per dataset: view name, file, title, grain, rows, licence |
| `describe_dataset` | `name` | dictionary entry: fields with type, unit, meaning; caveats; example questions; 5 sample rows (Parquet) |
| `run_sql` | `sql` (≤ 4,000 chars), `max_rows` (1–1,000, default 200) | `columns`, `rows`, `row_count`, `truncated` |
| `get_kpis` | `technology?` | installed and planned capacity and units, added this year, per technology |

**Tools v2 (WP81)** – typed, no SQL needed:

| Tool | Input | Output `data` |
|---|---|---|
| `find_units` | `technology[]?`, `status?`, `state?`, `district?`, `min_mw?`, `max_mw?`, `commissioned_from?`, `commissioned_to?`, `limit` (≤ 500) | matching units (≥ 100 kW, published columns only) + totals (count, MW) by technology and state; units below 100 kW come from `summary` as totals only |
| `auction_round` | `technology` (wind/solar/innovation), `bid_date?` (default latest) | volume, bids, awards, prices, oversubscription, permit deadline |
| `auction_winners` | `technology`, `bid_date?`, `group?` | award rows with bidder group and type |
| `company_profile` | `name` | auction record, players entry, hand-checked facts with sources (legal entities only) |
| `region_profile` | `state` or `district` | capacity by technology, recent additions, MW per km² |
| `grid_redispatch` | `months?` (≤ 60) | monthly TSO redispatch and curtailment aggregates, top substations (last 12 months) |
| `cross_border_flows` | `neighbour?` | monthly and last-12-month imports/exports |
| `whats_new` | `since` (date) | changes between two daily snapshots (needs WP78) |

**Resources:** `mastr-radar://dictionary` (dictionary.json),
`mastr-radar://licences`, `mastr-radar://guide` (same as `/llms-full.txt`),
`mastr-radar://methodology` (short methodology built from the dictionary,
links the full page), `mastr-radar://contract` (this file). **Prompts:** templates for "commissioned in a
period, where?", "auction round summary", "company profile".

**Limits (WP82):** `run_sql` accepts exactly one SELECT or WITH statement
(checked with the DuckDB parser; read-only PRAGMAs that DuckDB turns into
a SELECT are allowed), 10 s timeout, ≤ 1,000 rows, ≤ 1 MB per
result; about 60 requests per minute per client IP (anonymous, no
logging of IPs or query text beyond counts); `/mcp/health` returns the
manifest `as_of`. **Check:** a test calls every tool against the published
files and validates the result envelope; `run_sql` rejects writes, file
access outside the data folder, network and settings changes.

### Daily snapshots (WP78, built 25 Nov 2026)

After each successful daily run on `main`, the explorer files (without
`days/`) are packed into `data-YYYY-MM-DD.tar.zst` and attached to the
GitHub Release `data-YYYY-MM-DD` (title "Data YYYY-MM-DD (contract X)").
`mastr-radar snapshots-index` writes `snapshots.json` in `web/public/data/`:
`repo`, `format`, `snapshots` (date, tag, name, published, url; newest
first) and updates its manifest and dictionary entries. **Check:** the
newest snapshot date equals the manifest `as_of`; no duplicate dates.

### Built (25 Nov 2026)

- **WP81:** typed tools `find_units`, `auction_round`, `auction_winners`,
  `company_profile`, `region_profile`, `grid_redispatch`,
  `cross_border_flows`, `whats_new` (units registered since a date, from
  `units.registration_date`; works without snapshots). Inputs validated and
  quoted; numeric results returned as numbers.
- **WP82:** rate limit 60 requests/minute per client and server instance
  (in memory, IPs never logged); one log line per tool call with the tool
  name only; `.github/workflows/mcp-health.yml` checks `/mcp/health` and a
  tool call every 3 hours and sends a phone alert on failure.
- **WP84:** `/connect` page with setup for Claude apps, Claude Code, the
  Claude API MCP connector and other agents; linked from `/open-data`,
  `/llms.txt` and the landing page.

## v1.11: cost benchmarks, onshore wind and solar PV (approved 25 Nov 2026)

Two new pages, `/costs/wind` and `/costs/solar`: what a project costs to
build (capex) and run (opex), broken down by component, and how the main
public sources compare over time. Cost figures come from published studies,
not from MaStR, so they are entered by hand with their source and checked by
the pipeline (like `company_facts.yaml`).

### Sources (each goes into `docs/sources.md` before use)

| Id | Source | Edition | Scope | Licence / use |
|---|---|---|---|---|
| `windguard` | Deutsche WindGuard for BMWK, "Kostensituation der Windenergie an Land" | Stand 2024 (1 Oct 2024, corr. 2 Dec 2024); trend back to 2015 | Germany, survey of manufacturers and 72 projects (1,470 MW), commissioning 2024–26 | Figures quoted with source (facts); no charts copied |
| `ise` | Fraunhofer ISE, "Stromgestehungskosten erneuerbare Energien" | July 2024, plus editions 2021 and 2018 for the trend | Germany, ranges (low/high) | Figures quoted with source |
| `dea` | Danish Energy Agency, Technology Data for Generation of Electricity and District Heating | Onshore sheet Feb 2024 (€2020); solar sheets Aug 2026 (€2025) | Denmark; component breakdown and projections to 2050 | CC BY 4.0: values may be republished with attribution |
| `irena` | IRENA, Renewable Power Generation Costs in 2024 | July 2025 | Germany (read from country charts), Europe and world (tables), 2024 USD | Free use with acknowledgement of IRENA |

**Which source leads.** Onshore wind: WindGuard (German survey data, the
reference used by the ministry); DEA is shown as an international
comparison, because its onshore sheet reflects Danish rules (grid paid by
the public, neighbour buy-outs) and 2020 prices. Solar PV: DEA for the
component breakdown (most detailed and newest, Aug 2026); Fraunhofer ISE
for the German range. Each page says this in one line.

### Config `pipeline/config/costs.yaml` (hand-checked)

One entry per value: `tech` (wind_onshore, solar_ground, solar_roof),
`source`, `edition`, `metric` (capex, capex_component, opex, opex_component,
lcoe, wacc, lifetime), `component` (for breakdowns), `value` or `low`/`high`,
`unit` (€/kW, €/kWp, €/kW/yr, €/MWh, %, years), `currency`, `price_basis`
(nominal or real, price year), `year` (data year or commissioning period),
`method` (table, text, or chart_read with `tolerance`), `page` (PDF page),
`note`. Built by the daily `aggregate` and on demand by `mastr-radar
costs-build` (updates the manifest entry and the data dictionary).

### Output `costs/costs.json` (station 3)

`as_of` (date of the newest edition used); `sources` (id, title, edition,
url, licence, attribution); `fx` (USD→EUR rate per price year, ECB annual
average) and `deflator` (the DEA price index for converting €2020 values);
per technology (`wind_onshore`, `solar`):

- `capex_breakdown`: lead source, total, components (name, €/kW, share);
- `opex_breakdown`: lead source, components per year (wind: first and
  second decade);
- `capex_compare` and `opex_compare`: one row per source (value or range,
  native unit and price basis, plus a converted `eur_kw` in € of the data
  year for the comparison chart);
- `capex_trend`: series per source (year, value or range, price basis, method);
- `projections`: DEA central and range for 2030, 2040, 2050;
- `auction_link`: the average award price per year from
  `auctions/onshore.json` or `auctions/solar.json` (already published; simple
  mean of the round averages, since some rounds lack the awarded volume), for
  a "costs against award prices" chart.

**Check (fails loudly):** every value has a source in `sources`, a unit and
a price basis; component sums match the stated total within 2 % (or the
rounding of the components, 0.5 per component, where the source rounds); shares sum
to 100 % ± 1; ranges have low ≤ high; chart-read values carry a tolerance;
every converted value states its rate; trend years in order; values within
plausible bounds (wind capex 500–3,000 €/kW, solar 200–2,500 €/kWp, opex
> 0). Dictionary entry for the new file (WP75 rule).

### Website (station 4)

`/costs/wind` and `/costs/solar`, linked from the landing page and the
header ("Costs"). Each page: headline finding; capex breakdown (lead
source); opex breakdown; cross-source comparison (dots and ranges, one row
per source, price basis shown); trend over time (each source as its own
line or range, never merged); outlook (DEA projections); costs against our
auction award prices; a method box (price years, currency conversion,
chart-read values marked "approx."). Source line under every chart.

## v1.12: profitability of awarded projects, co-location (approved 25 Nov 2026)

The cost pages become cost and profitability pages: what each awarded wind
and solar project likely cost, what it earns, which return (IRR) it can
expect, and where and in which rounds projects were most valuable. The wind
page shows wind farms that share a site with a battery or a solar park.

### Assumptions `pipeline/config/profitability.yaml` (hand-checked, sourced)

- **Wind investment per project:** WindGuard 2024 regression for the main
  investment, HIK = 1,743.95 − 81.21·P − 1.66·SFL + 2.91·NH (€/kW; P rated
  power MW, SFL specific power W/m², NH hub height m; clamped to 700–2,000),
  scaled to the bid year with the WindGuard turbine price trend
  (`costs.json`), plus 506 €/kW ancillary investment. Opex 49 €/kW/yr
  (years 1–10), 57 (11–20), 2024 level, indexed 2 %/yr from operation start
  (bid year + 2).
- **Solar investment:** Fraunhofer ISE midpoint per edition (700, 665,
  800 €/kWp for 2018, 2021, 2024), interpolated by bid year; low case Danish
  Energy Agency 458 €/kWp. Opex 13.3 €/kWp/yr; degradation 0.25 %/yr.
- **Revenue, base case:** EEG award value for 20 years: wind award ×
  correction factor (`received_ct_est` in `awards.json`), solar the round's
  average award (no price per award is published), × our modelled yield.
- **Full-life case:** operation until year 25 (wind) or 30 (solar)
  (Fraunhofer ISE 2024); the years after the EEG period earn the SMARD
  capture price of the last 12 complete months, held flat.
- **Finance:** wind 79 % debt at 4.94 % over 19 years, equity target 8 %,
  WACC 5.8 %; solar 80 % debt at 5.0 % over 20 years, equity 6.5 %, WACC
  5.3 % (WindGuard 2024, Fraunhofer ISE 2024). Pre-tax, nominal, no residual
  value.
- **Per project:** investment, first-year opex, revenue, project IRR, equity
  IRR, NPV per kW at the WACC ("value"), full-life IRR, and `max_capex`: the
  highest investment that still earns the WACC over the EEG years.

### Market values (station 1, `mastr-radar market-fetch`)

SMARD (CC BY 4.0) hourly day-ahead price DE-LU (4169) and generation of solar
(4068) and onshore wind (4067) for the last 58 weeks → capture prices per
month and for the last 12 complete months, cached in
`data/market/market_values.json`. **Check:** 12 complete months, values
within −50…500 €/MWh. If the fetch fails, the last published values are kept.

### Output `costs/profitability.json` (station 3)

`as_of`; `assumptions` (inputs, notes, cost sources); `market` (capture
prices); `wind` and `solar`: `projects` as `{fields, rows}` (wind: round,
bid_date, group, state, lat, lon, model, mw_turbine, turbines, hub_m,
rotor_m, flh, quality_pct, ct, capex, opex, revenue, project_irr, equity_irr,
npv, project_irr_full, max_capex; solar: round, bid_date, group, state, lat,
lon, mw, yield, ct, capex, revenue, project_irr, equity_irr, npv,
project_irr_low_capex, project_irr_full, max_capex), `skipped`, `overall`,
`by_round`, `by_state` (p25/median/p75 per metric), `sensitivity`
(representative project from the awards since 2025: investment ±10 %,
price ±0.5 ct, interest ±1 point). Built by `aggregate` and on demand by
`mastr-radar profit-build`. **Check:** fields as listed; ≥ 1,000 wind and
≥ 500 solar projects; IRR solved for ≥ 90 %; investment and IRR within
bounds; overall median and round counts recomputed match.

### Co-location `auctions/colocation.json` (station 3)

Station 2 already carries `location_id` for all storage units ≥ 100 kW
(about two thirds have one in MaStR); no change needed. Sites, active units
only (operating, planned):
- `same_location`: onshore wind and storage or solar registered at the same
  `LokationMaStRNummer` (confirmed);
- `nearby`: a battery or ground-mounted solar park ≥ 1 MW within 500 m of a
  wind turbine (likely).

Per site: tier, kind, partner MW and MWh, partner status and year, wind MW
and units (within 1 km or at the location), wind status, award rounds of
those turbines, distance, state, district, lat/lon and operator (legal
entities only, D4/D13). `totals` per tier × kind × status, `by_year`.
**Check:** every site has wind and a partner; nearby within the rule; no
operator without a public location; totals add up.

### Website

`/costs/wind` and `/costs/solar` ("costs and earns"): sections "What awarded
projects earn" (IRR per round, estimated vs affordable investment), "Where
projects are worth most" (map by value, table by state), "What moves the
return" (sensitivity). `/wind`: section "Wind with batteries and solar"
(map, per year, largest sites). Header: separate "Wind costs" and "Solar
costs". The Outlook page is unchanged.

## v1.13: champions of the energy transition, technology combinations, multi-asset hubs (approved 26 Nov 2026)

### Players: champions (WP99)

`players.yaml` gains filled financials from primary sources (annual reports,
Bundesanzeiger filings, company press releases) with year, label and source
per figure; where a company publishes nothing, the field says
`"not_published"` instead of staying blank. `players.json` gains
`champions`: one row per developer, IPP or utility active in Germany with
five scores (0–100, method stated): **scale** (awarded MW in the last three
years, wind + solar), **breadth** (technologies with meaningful capacity:
wind, solar, storage, hybrids, hydrogen), **execution** (share of awarded MW
in operation; months from award to operation), **momentum** (awards trend),
**financial strength** (EBITDA margin, net debt / EBITDA where published).
Total = weighted mean (weights shown; user can change them on the page).
**Check:** every score in 0–100; every financial figure has a source.

### Technology combinations (WP100)

`auctions/colocation.json` gains `combo` per site: `wind+battery` (same grid
location, no solar), `wind+solar`, `wind+solar+battery`, and `by_group`:
per company group (award lists and operators ≥ 1 MW) the sites and MW per
combination. **Check:** combos match the partner units at the site.

### Station 2: more of the register (WP101)

New internal `data/extract/assets_other.parquet`: combustion units (energy
carrier, MW, CHP flag), gas producers (incl. electrolysers: technology, MW),
gas consumers, gas storage, large electricity consumers (MW, legal entities
only), each with location id, status, coordinates where public, operator.
(Built: combustion units ≥ 1 MW plus all hydrogen-fired units; gas storage
records that also appear as gas producers are kept once, as storage. The
separate locations file was not needed: every unit carries its location id,
and gas, consumer and generation locations use separate numbering, so hubs
are found by distance.) **Check:** known kinds only; ≥ 500 gas plants, ≥ 300
large consumers, ≥ 20 gas storage sites; unique unit ids. Command:
`mastr-radar extract-assets` (also part of `extract`).

### Multi-asset hubs `hubs/hubs.json` (WP102)

Sites combining at least three asset types among wind, solar park
(≥ 1 MW, ground-mounted), battery (≥ 1 MW), gas or hydrogen plant (≥ 1 MW),
electrolyser, gas storage, large consumer, within 2 km of an anchor asset
(everything but wind and solar, companies only); anchors within 1 km form
one hub. Per hub: asset types with MW (and MWh), status
(operating / planned parts), operators (legal entities), state, district,
lat/lon. Totals by combination. **Check:** ≥ 3 types per hub; no natural
persons' locations.

### Siting `hubs/siting.json` (WP103)

Per district: wind and solar parks (≥ 1 MW) per km², curtailed renewables at
TSO substations within 50 km (Netztransparenz top list, geocoded), distance
from the district centre to the hydrogen core network, a ≥ 220 kV
substation and a gas pipeline, large consumers and planned hydrogen
take-off within 25 km. Percentile per factor; score = weighted mean
(default weights 25/15/15/15/15/15, adjustable on the page). **Check:**
≥ 390 districts; all scores 0–100. A screening tool, not site advice.

### Infrastructure layers `hubs/infrastructure.json` (WP104, decided: OSM, SciGRID, H2 schematic)

- Power lines ≥ 220 kV and substations: OpenStreetMap via the PyPSA-Eur
  prebuilt network (Zenodo 23896564, ODbL 1.0; share-alike applies to this
  file).
- Gas transmission pipelines: SciGRID_gas IGGIELGNC-3 (Zenodo 5079748, CC BY
  4.0), segments inside Germany by geometry.
- Hydrogen core network: segments from the Bundesnetzagentur approval
  annexes (start and end place, DN, km, year, conversion or new build),
  drawn as straight lines between geocoded places (register municipalities,
  else OpenStreetMap Nominatim, cached); a segment is left unplaced when the
  straight distance exceeds 2 × its stated length + 10 km. Hydrogen projects
  (annex 1) at their district centre.
- Fibre / internet backbone: no open data for Germany; not shown.

Station 1: `mastr-radar infra-fetch` (data/infra/, with geocoding); station
3: `mastr-radar infra-build` (on demand; the daily run keeps the file).
**Check:** ≥ 300 lines, ≥ 100 substations, ≥ 100 gas segments, ≥ 200
hydrogen segments and ≥ 100 projects, ≥ 50 % of segments placed.

### Website

`/players`: "Champions" section (scores, matrix of technologies by company,
filled financials). `/wind`: combinations by company. New page `/hubs`:
map of multi-asset hubs, infrastructure layers, siting score by district.

## Version history

| Version | Date | Change |
|---|---|---|
| 1 | 2026-10-30 | First version, approved and locked |
| 1.1 | 2026-10-30 | After WP4 data check: own reader instead of open-mastr (D11); station 1 writes the export zip; offshore regions from `Seelage`, all offshore units included (D8); storage includes pumped hydro, new `storage_technology` column (D9); `incomplete_after` per technology (D10); confirmed source names and plausible row counts |
| 1.2 | 2026-10-31 | Data quality rules D12 (storage capacity split per plant, plausibility limits, impossible dates); operator names on the website only from 1 MW (D13). Approved by the user. |
| 1.3 | 2026-10-31 | Monitor files `monitor/buildout.json`, `points.json`, `stats.json`; boundaries `area_km2`; series definition D14. Approved by the user. |
| 1.4 | 2026-10-31 | Data hub chain H1/H2, day files `days/` with SMARD and DWD weather, `stations.json`, population in `states[]`, size budget 50 MB. Approved by the user. |
| 1.5 | 2026-10-31 | Turbine makers (`wind_industry` in `stats.json`), auctions chain A1/A2 with `auctions/onshore.json` and `auctions/awards.json`. Approved by the user. |
| 1.6 | 2026-11-01 | Auctions since May 2019 with yield estimate (DWD), five bidder types, reviewed attributions and company-reported totals, office attribution via the new internal `data/extract/operators.parquet`, race, profiles and map points. Approved by the user. |
| 1.7 | 2026-11-01 | Solar and innovation auctions, internal unit details and grid register, wind calibration and success drivers, rise-and-fall dynamics, company facts, market risk, players worldwide, grid page. Approved by the user. |
| 1.8 | 2026-11-02 | Netztransparenz TSO redispatch since 2021 and ENTSO-E cross-border flows (internal extracts, `grid/redispatch.json`, `grid/flows.json`, aggregates only), fetched with GitHub Secrets by a separate daily workflow. Approved by the user. |
| 1.9 | 2026-11-25 | Auction run-up (`auctions/runup.json`, permit deadlines, `permit_registered` in unit details), Outlook page (`outlook/outlook.json`: repowering, auction outlook), Telegram phone report. Approved by the user. |
| 1.10 | 2026-11-25 | Data dictionary (`dictionary.json`, check), agent context (`/llms-full.txt`, `/schema.json`), MCP server at `/mcp` (tools, resources, prompts, limits), daily snapshots. Approved by the user. |
| 1.11 | 2026-11-25 | Cost benchmarks: `config/costs.yaml` (WindGuard 2024, Fraunhofer ISE 2024/2021/2018, Danish Energy Agency, IRENA 2025), `costs/costs.json` with breakdowns, comparison, trends, projections and award prices; pages `/costs/wind` and `/costs/solar`. Approved by the user. |
| 1.12 | 2026-11-25 | Profitability of awarded wind and solar projects (`costs/profitability.json`, `config/profitability.yaml`, SMARD market values), co-location of wind with batteries and solar (`auctions/colocation.json`); profitability on the cost pages, co-location on the wind page. Approved by the user. |
| 1.13 | 2026-11-26 | Champions scores and filled financials (`players.json`), technology combinations (`colocation.json`), other assets extract (gas plants, electrolysers, gas storage, large consumers), multi-asset hubs, siting screen and infrastructure layers (power grid OSM/ODbL, gas SciGRID, hydrogen core network schematic); new page `/hubs`. Approved by the user. |
