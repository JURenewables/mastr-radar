# MaStR Radar

A public, free-to-use **exploration suite** for the Bundesnetzagentur's
**Marktstammdatenregister (MaStR)**: maps, charts and tables to explore
Germany's renewable energy units the way an energy company or energy
consultancy would.

Example question it must answer well: *"Which wind and solar projects went
online (commissioning date) in 2026, or in March 2026, and where are they?"*

Later, optional modules (not in scope now): pipeline & competitors,
repowering, grid connection, auction analysis with yield estimates, daily
change tracking. See `docs/PLAN.md`.

## Audience

Energy companies, project developers, investors and consultancies. They know
the market and are short on time. They want to:

- filter the register by technology, status, region, size and commissioning
  date, and see the result on a map, in charts and in a table;
- trust what they see: a clear as-of date, sources, method and known gaps;
- share a view by link, and download the data behind it.

## Stack

| Layer | Choice |
|---|---|
| Data pipeline | Python 3.12, own streaming reader for the BNetzA bulk export (XML in a zip), pandas/pyarrow, `uv`. Not open-mastr: v1.0.0 failed on all solar files (WP4) |
| Schedule | GitHub Actions, daily cron (BNetzA publishes the bulk export daily) |
| Outputs | Parquet + small JSON files, served as static files by the website |
| Frontend | Next.js (App Router, TypeScript) + Tailwind CSS, hosted on Vercel |
| In-browser queries | DuckDB-WASM reads the Parquet files directly, so filtering needs no server |
| Charts | Observable Plot (D3 underneath) |
| Maps | MapLibre GL, OpenFreeMap basemap (free, no key), BKG VG250 boundaries for states and districts |

## The data chain (locked structure)

Data moves left to right through four stations. Each station reads **only**
the output of the station before it.

```
1 Download ──▶ 2 Extract ──▶ 3 Build explorer files ──▶ 4 Website
BNetzA export   export zip →    units + summaries +        reads only the
→ export zip    units.parquet   manifest (web/public/data)  explorer files
```

1. **Download:** our downloader fetches the bulk export zip into `data/raw/`
   (git-ignored, discarded after each run), with resume and retry, because
   the BNetzA server is slow and drops connections.
2. **Extract:** the XML files in the zip → `data/extract/units.parquet`, one
   clean table of all units with fixed English column names. Catalogue
   numbers are decoded with `Katalogwerte.xml` from the same zip.
3. **Build explorer files:** `units.parquet` → files in `web/public/data/`:
   unit-level data for larger units, summary tables that include every unit,
   region boundaries and `manifest.json` (as-of date, version, row counts).
4. **Website:** reads only those files.

Rules that keep it locked:

- **Contracts first.** Every station's output is defined in
  `docs/contracts.md` (file, columns, types, meaning) before code is written.
  The user approves a contract, and then it is locked.
- **A check per station.** Each output is validated against its contract by
  a test or a validation step that fails loudly. A broken station must never
  reach the website.
- **Changing a locked contract is its own work package**, never a side
  effect of other work. Bump the contract version and update both pipeline
  and website in the same commit.
- German source column names exist only in station 1–2 code. The mapping to
  English names lives in one place (`pipeline/config/`).
- Committed JSON/Parquet in `web/public/data/` stays small (target < 25 MB).

## Data rules

- **Licence:** MaStR data is © Bundesnetzagentur under the
  [Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0)
  (DL-DE-BY-2.0). Attribution is mandatory, and we must state that the data
  was processed. BKG boundary data carries its own attribution
  (© GeoBasis-DE / BKG).
- **Privacy:** many small units belong to private individuals, and MaStR
  publishes no coordinates for them. Never show names or exact locations of
  natural persons. Show small units only as regional totals. Operator names
  only for legal entities and units ≥ 1 MW.
- **Late registrations:** units can be registered weeks after commissioning,
  so the most recent months are incomplete. Every chart that ends near the
  as-of date must say so.
- Use MaStR IDs (`EinheitMastrNummer`, operator `MastrNummer`) as keys.
  Never match on names alone.

## Design: "Product" style (chosen in WP26, 31 Oct 2026)

Clean, bright, state of the art, like a Google or Anthropic product page;
storytelling flow inspired by Zeit Online's energy monitor (one scrolling
page). Reference mock-up: https://claude.ai/artifact/Eoju75aXD7jXJAvgMh7Evq (tab C).

- **Typography:** one modern sans (Manrope) for headings and body. Big, bold,
  tight headings and numbers (weight 800, negative letter spacing). Tabular
  numerals for all figures.
- **Colour:** white background, light grey-blue panels, near-black ink, one
  vivid blue accent. Fixed technology colours everywhere: solar amber, onshore
  wind blue, offshore navy, storage violet, biomass green, hydro teal.
  Automatic dark version when the device is in dark mode. Colour is never the
  only carrier of meaning.
- **Shapes:** soft rounded panels (about 20 px radius), rounded pill controls,
  thin light borders, no heavy shadows.
- **Maps:** light, quiet basemap; districts shaded by capacity per km²; plants
  as dots in a darker tone of the technology colour; the year large top left
  and the running total top right; play button and year slider for animations.
- **Charts:** a headline that states the finding (e.g. "Solar added 17.4 GW in
  2025; the 2030 target needs 19.9 GW a year"), direct labels, light gridlines,
  no chart junk. A source line under every chart: "Source:
  Marktstammdatenregister, as of DD Mon YYYY".
- **Numbers:** MW/GW with sensible rounding, explicit units, deltas with sign
  and period.
- **Layout:** mobile first, generous whitespace, the as-of date always
  visible.
- **Footer (every page):** `© Bundesnetzagentur, DL-DE-BY-2.0` linked to the
  licence, plus "Data processed by MaStR Radar" and a link to the methodology
  page.

## Repository layout

```
pipeline/            Python data pipeline (uv project)
  src/mastr_radar/   one module per station + cli
  config/            settings, column mapping, technology mapping
  tests/             tests on small synthetic fixtures
web/                 Next.js + Tailwind site
  app/               routes
  components/        map/, charts/, filters/, ui/, layout/
  lib/               data engine, types, formatting
  public/data/       explorer files (written by the pipeline, never hand-edited)
docs/                PLAN.md, contracts.md, data-dictionary.md, methodology.md
.github/workflows/   ci.yml, pipeline-daily.yml
data/                local working dir for downloads (git-ignored)
```

## How we work

- One work package (WP) per session, about 30 minutes, from `docs/PLAN.md`.
- **Start of session:** say where we are ("WP5 of 25, Phase 2") and what
  "done" means for this WP.
- **During:** only that WP. Note anything else as a follow-up in PLAN.md
  instead of doing it.
- **End of session:** checks pass, tick the WP in PLAN.md, update the
  "You are here" line, commit, push, and give a one-line summary plus what's
  next.
- The user works mostly from a phone: keep summaries short and plain.
- Small, focused commits with imperative messages.
- Unit tests use tiny fixtures. Never require the multi-GB download for tests.
- No secrets needed: the bulk export is public.

## Commands

- Pipeline: `cd pipeline && uv run mastr-radar --help`, `uv run pytest`,
  `uv run ruff check . && uv run ruff format --check .`
- Station 1: `uv run mastr-radar download` (newest export, resumable, then
  checked), `uv run mastr-radar check-download <zip>` (check only)
- Station 2: `uv run mastr-radar extract` (newest zip → `data/extract/units.parquet`,
  then checked; report in `extract_report.json`)
- Station 3: `uv run mastr-radar aggregate` (`units.parquet` → `web/public/data/`,
  then checked, then cross-checked against Energy-Charts: warning only,
  report in `data/reports/crosscheck.json`)
- Hub (contract v1.4 draft): `uv run mastr-radar hub-fetch` (SMARD, cached in
  `data/hub/`), `uv run mastr-radar hub-build` (day files in
  `web/public/data/days/`, then checked). Sources and licences: `docs/sources.md`.
- Open data: `/open-data` (people), `/catalog.json` and `/llms.txt` (machines,
  built from the manifest in `web/lib/catalog.ts`); CORS open on `/data/*`.
- Web: `cd web && npm run dev` (local), `npm run lint`, `npm run build`.
  Next.js 16: read `web/node_modules/next/dist/docs/` before using unfamiliar APIs.
  Live: https://mastr-radar.vercel.app (from `main`); branches get preview links.
