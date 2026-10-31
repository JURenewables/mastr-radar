# MaStR Radar

A public exploration suite for the Bundesnetzagentur's **Marktstammdatenregister
(MaStR)**: maps, charts and tables of every solar, wind, storage, biomass and
hydro unit in Germany, updated daily.

**Live:** https://mastr-radar.vercel.app

## How it works

```
1 Download ──▶ 2 Extract ──▶ 3 Build explorer files ──▶ 4 Website
BNetzA export   9.6 M units     units ≥ 100 kW, totals     Next.js, DuckDB-WASM,
(3.3 GB zip)    units.parquet   for all units, outlines    MapLibre, Observable Plot
```

Each station reads only the previous station's output and has a check that
fails loudly. A GitHub Action (`.github/workflows/pipeline-daily.yml`) runs
stations 1–3 every morning and commits the new files in `web/public/data/`;
Vercel then redeploys the site. Figures are cross-checked against Fraunhofer
ISE Energy-Charts on every run.

## Run it locally

Pipeline (Python 3.12, [uv](https://docs.astral.sh/uv/)):

```bash
cd pipeline
uv sync
uv run mastr-radar download    # ~3.3 GB, resumable
uv run mastr-radar extract     # ~20 min, ~6 GB RAM
uv run mastr-radar aggregate   # writes web/public/data/
uv run pytest
```

Website (Node 22):

```bash
cd web
npm ci
npm run dev                    # http://localhost:3000
npm test && npm run lint && npm run build
```

## Documentation

- `CLAUDE.md`: goals, stack, design rules, working conventions
- `docs/PLAN.md`: roadmap and decisions
- `docs/contracts.md`: the locked data contracts between the stations
- `docs/data-dictionary.md`: source fields, data checks, quality findings

## Licence and attribution

Data: © Bundesnetzagentur, [DL-DE-BY-2.0](https://www.govdata.de/dl-de/by-2-0),
processed by MaStR Radar. Boundaries: © GeoBasis-DE / BKG (2026), dl-de/by-2-0.
Basemap: OpenFreeMap, © OpenMapTiles, data from OpenStreetMap.
