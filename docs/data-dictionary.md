# Data dictionary & WP4 data check

Findings from the real MaStR bulk export of **30 Oct 2026**
(`Gesamtdatenexport_20261030.zip`), checked against station contracts v1.

## 1. Can the daily job run on a free GitHub runner?

| Measure | Result |
|---|---|
| Export size (zip) | 3.26 GB full export (open-mastr only fetched the 2.55 GB it needed) |
| Download time | 48 min locally, at roughly 1 MB/s; the BNetzA server is the bottleneck |
| GitHub runner download | **Failed after 35 min**: BNetzA dropped the connection mid-file |
| open-mastr processing into SQLite | 36 min, SQLite file 5.6 GB |
| Own streaming parser (solar only, 6.6 M units) | **4 min** |
| Peak disk | 7.9 GB (zip + SQLite) |
| Peak memory | 2.1 GB |
| Free disk on GitHub runner | 86 GB |

**WP5 update:** our own downloader fetched the full 3.26 GB in 50 min. The
connection broke once at 3.12 GB; it resumed and finished, and the check
(189 files, CRC) took about 3.5 min.

**Verdict:** the GitHub runner has plenty of disk and memory. The weak point is
the download, which is slow and can break. It needs resume and retry.

## 2. open-mastr cannot load solar from today's export

open-mastr 1.0.0 (the latest release) failed on **all 67 solar files**, so
the solar table is empty. The cause is a field BNetzA added after July 2026,
`VorlaeufigeRegelzonenDerEinheit`, which can hold several values in one cell
(e.g. `711 3183`). open-mastr also couldn't read the current schema files
and fell back to a stored copy from July 2026.

All other tables loaded correctly.

A 60-line streaming parser read the solar files straight from the zip in
4 minutes, with no errors.

## 3. Row counts (all statuses, active registrations)

| Technology | Units | Operating | Planned | Temp. shut down | Perm. shut down | Units ≥ 100 kW |
|---|---|---|---|---|---|---|
| Wind (on + offshore) | 44 344 | 32 253 | 8 836 | 87 | 3 168 | 42 863 |
| Solar | 6 616 354 | 6 450 756 | 66 143 | 8 109 | 91 346 | 87 393 |
| Storage | 2 907 318 | 2 860 551 | 29 340 | 1 282 | 16 145 | 3 301 |
| Biomass | 24 452 | 21 701 | 499 | 368 | 1 884 | 20 259 |
| Hydro | 8 822 | 8 589 | 31 | 53 | 149 | 2 830 |

Every unit has system status *Aktiviert*: the export contains active
registrations only.

**Plausibility (operating, gross):** onshore wind 71.5 GW (30 435 turbines),
offshore wind 11.6 GW (1 818 turbines). Onshore wind commissioned in 2026 so
far: 4.24 GW (797 turbines).

**Map points (D5, ≥ 100 kW):** about **157 000 units** across all
technologies, nearly all with coordinates. That fits the 25 MB budget. The
100 kW limit holds.

### Solar by type (`ArtDerSolaranlage`)

| Type | Units | Of which ≥ 100 kW |
|---|---|---|
| Building (`Gebäudesolaranlage`) | 4 968 233 | 71 330 |
| Balcony (`Steckerfertige Solaranlage`) | 1 626 494 | 4 |
| Ground-mounted (`Freiflächensolaranlage`) | 21 463 | 15 968 |
| Other | 164 | 91 |

### Solar by size class

| Class | Units | GW |
|---|---|---|
| < 10 kW | 4 487 870 | 21.0 |
| 10–100 kW | 2 041 091 | 42.1 |
| 100 kW–1 MW | 77 326 | 24.0 |
| 1–10 MW | 8 797 | 28.9 |
| ≥ 10 MW | 1 270 | 26.2 |

### Storage by technology (`Technologie`)

| Technology | Units | GW |
|---|---|---|
| Battery | 2 906 667 | 35.5 |
| Pumped hydro | 120 | 10.1 |
| Hydrogen, compressed air, flywheel, unknown | 531 | ~0 |

Storage capacity in kWh (`AnlagenStromSpeicher.NutzbareSpeicherkapazitaet`,
linked via `SpeMastrNummer`) is present for 100% of storage units ≥ 100 kW.

## 4. Offshore wind

- Wind units have no `Lage` column. On/offshore is in
  **`WindAnLandOderAufSee`**, and MaStR already provides the sea area in
  **`Seelage`** (`Nordsee` / `Ostsee`), so no longitude rule is needed.
- **No offshore unit has a municipality code**, including 96 turbines in
  coastal waters that MaStR assigns to Niedersachsen (48) or
  Mecklenburg-Vorpommern (48).

| Sea | State field | Status | Turbines | GW |
|---|---|---|---|---|
| Nordsee | AWZ | operating | 1 441 | 9.28 |
| Nordsee | AWZ | planned | 91 | 1.36 |
| Nordsee | Niedersachsen | operating | 48 | 0.22 |
| Ostsee | AWZ | operating | 281 | 1.84 |
| Ostsee | Mecklenburg-Vorpommern | operating | 48 | 0.31 |

## 5. Operators and privacy

- `Marktakteure.Personenart` reliably separates natural persons (5.46 M)
  from organisations (294 k).
- BNetzA already withholds names of natural persons: first name, last name
  and company name are empty for all of them.
- But units of natural persons can still carry a **unit name** and
  **coordinates**. For example, 1 343 of 2 340 privately owned wind turbines
  have coordinates. Our D4 rule (blank both) is therefore needed and must be
  enforced by the station 2 check.
- 2 652 wind units have no operator at all. All of them are permanently shut
  down.

## 6. Late registrations

Days between commissioning and registration, for units ≥ 100 kW
commissioned between Jan 2025 and Jun 2026:

| Technology | Median | 90% registered within | 99% within |
|---|---|---|---|
| Wind | 4 days | 22 days | 63 days |
| Biomass | 7 days | 99 days | 330 days |
| Storage | 12 days | 134 days | 415 days |

The delay differs a lot by technology, so "possibly incomplete after"
should be set **per technology** (measured fully, including solar, in WP11).

## 7. Data quality notes (for WP11)

- Placeholder commissioning dates: `1900-01-01` appears in storage and
  hydro, and batteries with dates like 1923 are impossible.
- 11 wind units have a 4-digit municipality code instead of 8 digits.
- 35 solar, 36 storage and 30 hydro units have no municipality code.
- Column names differ in capitalisation between tables, e.g.
  `EegMaStRNummer` in solar vs `EegMastrNummer` in wind.

## 8. Source column corrections (mapping only, no contract change)

| Contract column | Expected source | Actual source |
|---|---|---|
| `technology` (wind on/offshore) | `Lage` | `WindAnLandOderAufSee` |
| `solar_type` | `Lage` / `ArtDerSolaranlage` | `ArtDerSolaranlage` |
| `eeg_id` (solar) | `EegMastrNummer` | `EegMaStRNummer` |

## 9. Station 2 run (WP6, wind)

- 44 344 wind units (42 435 onshore, 1 909 offshore) in 84 s. Most of that
  time goes into reading 5.75 M operators.
- Totals match WP4: 71.54 GW onshore and 11.64 GW offshore operating; 4.24 GW
  onshore commissioned in 2026. Offshore: 1 580 Nordsee, 329 Ostsee.
- Fixes counted in `data/extract/extract_report.json`: 7 coordinates outside
  Germany nulled, 11 broken municipality codes, 0 dates out of range.
- **Unknown operators are treated as private (D4, safe default).** 2 652
  permanently shut-down turbines have no operator, so they lose name and
  coordinates. Together with 2 340 privately owned turbines, 4 992 units are
  blanked.
- Names are Unicode-normalised: some operator names use a full-width
  ampersand (`＆`), which becomes `&`.

## 10. Station 3 run (WP7)

- Station 2 stores the export date inside `units.parquet` (file metadata
  `export_date`). Station 3 reads it from there, so it never has to look
  outside station 2's output.
- First explorer files, as of 30 Oct 2026:

| Technology | Installed | Units | Added 2026 | Planned |
|---|---|---|---|---|
| Onshore wind | 71.5 GW | 30 435 | 4.2 GW | 54.0 GW |
| Offshore wind | 11.6 GW | 1 818 | 1.9 GW | 1.4 GW |

- Provisional "possibly incomplete" dates (90% of units registered within
  this time; refined in WP12): onshore after 5 Oct 2026 (25 days),
  offshore after 14 Oct 2026 (16 days).
