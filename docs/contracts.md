# Station contracts — v1 (locked)

These contracts define exactly what each station of the data chain outputs.
They are **locked**: changing one is its own work package,
with a version bump, and pipeline and website are updated together.

```
1 Download ──▶ 2 Extract ──▶ 3 Build explorer files ──▶ 4 Website
```

Each station reads **only** the output of the station before it, and each has
a **check** that must pass before the next station runs.

Source column names (German, from the MaStR export) are *expected* names.
WP4 (data check) confirms them against the real download; any difference is
fixed in the column mapping, not in these contracts.

---

## Decisions in this contract (approved 2026-10-30)

| # | Decision | Proposal |
|---|---|---|
| D1 | Which capacity figure | **Gross capacity** (`Bruttoleistung`), as in BNetzA's own statistics. Net capacity is kept as a second column. |
| D2 | What counts as "installed" | Status **operating** only, for headline "installed capacity" figures. All statuses (planned, temporarily and permanently shut down) are kept in all files and are fully explorable via a status filter. |
| D3 | Which registrations | Only **active** registrations. Deleted or deactivated entries are dropped. |
| D4 | Private individuals | Units of natural persons get **no unit name, no operator name and no coordinates**. They appear in regional totals only. |
| D5 | Map points | Units **≥ 100 kW** appear as individual points (final value set in WP4, after counting rows and file size). Smaller units only in regional totals. |
| D6 | Size classes | `<10 kW`, `10–100 kW`, `100 kW–1 MW`, `1–10 MW`, `≥10 MW` |
| D7 | Place names | German, as in the register (Bayern, not Bavaria). Region keys use official municipality codes (AGS). |
| D8 | Offshore wind | Offshore units with no municipality get one of two extra regions: **Nordsee (offshore)** (`state_key` = `OFF_N`) or **Ostsee (offshore)** (`OFF_O`), split by longitude (< 9.5° E = Nordsee). Their `district_key` is the same value. Parks that MaStR assigns to a coastal municipality stay in that state. |
| D9 | Technologies | Onshore wind, offshore wind, solar, battery storage, biomass, hydro. (Phase 2 only builds onshore wind.) |

---

## Station 1 — Download

**Reads:** the BNetzA bulk export (via open-mastr).
**Writes:** `data/raw/` (git-ignored, deleted after each daily run).

| File | Content |
|---|---|
| `data/raw/open-mastr.db` | SQLite database written by open-mastr |
| `data/raw/download_meta.json` | export date, open-mastr version, download size, duration |

Tables used from the database:

| Table | Used for |
|---|---|
| `EinheitenWind` | wind units |
| `EinheitenSolar` | solar units |
| `EinheitenStromSpeicher` | battery storage units |
| `EinheitenBiomasse` | biomass units |
| `EinheitenWasser` | hydro units |
| `AnlagenStromSpeicher` | storage capacity in kWh |
| `Marktakteure` | operator names and whether an operator is a natural person |

**Check:**
- all tables above exist;
- row counts are plausible (e.g. wind ≥ 30 000 units, solar ≥ 3 000 000);
- the export date is no older than 3 days.

---

## Station 2 — Extract

**Reads:** `data/raw/open-mastr.db`
**Writes:** `data/extract/units.parquet`: one row per unit, all technologies,
all statuses, English column names.

### Columns

**Identity and type**

| Column | Type | Meaning | Source |
|---|---|---|---|
| `unit_id` | string, **unique, required** | MaStR unit number, e.g. `SEE912345678901` | `EinheitMastrNummer` |
| `technology` | enum, required | `wind_onshore`, `wind_offshore`, `solar`, `storage`, `biomass`, `hydro` | table + `Lage` for wind |
| `status` | enum, required | `operating`, `planned`, `temporarily_shut_down`, `permanently_shut_down` | `EinheitBetriebsstatus` |
| `name` | string, nullable | unit name (null for natural persons, D4) | `NameStromerzeugungseinheit` |
| `eeg_id` | string, nullable | EEG register number (kept for later auction linking) | `EegMastrNummer` |

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
| `state` | string, nullable | federal state | `Bundesland` |
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
| `operator_name` | string, nullable | operator name (null for natural persons) | `Marktakteure` |
| `operator_is_person` | bool, required | operator is a natural person | `Marktakteure` (Personenart) |

**Technology details** (null where not applicable)

| Column | Type | Applies to | Source |
|---|---|---|---|
| `manufacturer` | string | wind | `Hersteller` |
| `turbine_model` | string | wind | `Typenbezeichnung` |
| `hub_height_m` | float | wind | `Nabenhoehe` |
| `rotor_diameter_m` | float | wind | `Rotordurchmesser` |
| `wind_park` | string | wind | `NameWindpark` |
| `solar_type` | enum: `ground_mounted`, `rooftop`, `balcony`, `other` | solar | `Lage` / `ArtDerSolaranlage` |
| `storage_capacity_kwh` | float | storage | `AnlagenStromSpeicher.NutzbareSpeicherkapazitaet` |
| `battery_technology` | string | storage | `Batterietechnologie` |
| `fuel` | string | biomass | `Hauptbrennstoff` |
| `hydro_type` | string | hydro | `ArtDerWasserkraftanlage` |

### Check

- `unit_id` unique and never empty; required columns have no nulls.
- Enums contain only the listed values.
- `capacity_kw` ≥ 0. Values above 2 000 MW are flagged as outliers.
- Dates are between 1890 and the export date. Planned dates may be in the
  future.
- Coordinates lie inside Germany plus its sea area (lat 47–56, lon 5.5–15.5).
  Anything outside is set to null and counted.
- **Privacy:** if `operator_is_person` is true, then `name`, `operator_name`,
  `lat` and `lon` are null. No exceptions.
- Row count per technology changes by less than 5% from the previous run
  (warning, not failure).

---

## Station 3 — Build explorer files

**Reads:** `data/extract/units.parquet`
**Writes:** `web/public/data/`: the only files the website reads.

| File | Built from | Content |
|---|---|---|
| `manifest.json` | WP6 | as-of date, contract version, file list with row counts |
| `kpis.json` | WP6 | headline numbers per technology |
| `units.parquet` | WP10 | individual units ≥ 100 kW (D5), for map points and tables |
| `summary.parquet` | WP10 | totals for **all** units, incl. small ones |
| `boundaries/states.geojson` | WP10 | state outlines (BKG), keyed by `state_key` |
| `boundaries/districts.geojson` | WP10 | district outlines (BKG), keyed by `district_key` |

### `manifest.json`

| Field | Meaning |
|---|---|
| `contract_version` | `"1"` |
| `as_of` | export date of the MaStR data (`YYYY-MM-DD`) |
| `generated_at` | when the pipeline ran (UTC timestamp) |
| `pipeline_version` | version of the pipeline code |
| `incomplete_after` | date after which data is likely incomplete because of late registrations (as-of minus about 2 months, measured in WP11) |
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
`last_updated` (the site doesn't need them).

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
- mark periods after `incomplete_after` as possibly incomplete in charts;
- refuse to load and show a clear message if `contract_version` is not one it
  understands.

---

## Version history

| Version | Date | Change |
|---|---|---|
| 1 | 2026-10-30 | First version, approved and locked |
