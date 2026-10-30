# MaStR Radar

A public dashboard on German renewables data from the Bundesnetzagentur's
**Marktstammdatenregister (MaStR)**, built to surface **M&A and pipeline
signals** for energy investors and strategy teams.

The question every page should answer: *"What changed, who is behind it, and
why does it matter for deal flow?"* Volume charts are context; changes are
the product.

## Audience

Energy investors, M&A advisors, corporate strategy and business development
teams. They know the market and are short on time. They want:

- **Pipeline:** what is planned or permitted but not yet built, where, how
  many MW, and by whom.
- **Transactions:** operator changes on existing assets (a sign of
  acquisitions), who is buying and selling, and how many MW changed hands.
- **Concentration:** who the large operators are, how their portfolios grow,
  and in which regions and technologies.
- **Trust:** a clear as-of date, sources and method, and known limitations.

## Stack

| Layer | Choice |
|---|---|
| Data pipeline | Python 3.12, [`open-mastr`](https://github.com/OpenEnergyPlatform/open-MaStR) (bulk XML export → SQLite), pandas/pyarrow, `uv` for envs |
| Schedule | GitHub Actions, daily cron (BNetzA publishes the bulk export daily) |
| Outputs | Slim **Parquet** (snapshots, for diffing) + small aggregated **JSON** (what the site reads) |
| Frontend | Next.js (App Router, TypeScript) + Tailwind CSS |
| Hosting | Vercel. Pages are statically generated from the JSON at build time, with no runtime database or API |
| Charts | Observable Plot (D3 underneath); MapLibre or D3-geo for maps |

### Data flow

```
BNetzA bulk export ──open-mastr──▶ SQLite (runner disk, discarded)
        │
        ▼ extract.py
  slim Parquet snapshot (today) ──diff vs yesterday──▶ change events
        │                                              │
        ▼ aggregate.py                                 ▼
  web/public/data/*.json  ◀────────────────────────────┘
        │  (committed by the Action → Vercel redeploys)
        ▼
  Next.js static pages
```

- Raw downloads and SQLite never get committed. Only aggregates and the slim
  snapshots leave the runner.
- Every JSON output is described by a schema in `pipeline/src/mastr_radar/schemas.py`
  (pydantic). TypeScript types in `web/lib/types.ts` mirror it. If you change
  one, change the other in the same commit.
- `web/public/data/manifest.json` records the as-of date of the export, the
  pipeline version, row counts and the generated timestamp. The site shows
  this date on every page.
- Keep the committed JSON small (target < 10 MB total). Anything bigger goes
  to a GitHub Release asset, not git.

## Data rules

- **Licence:** MaStR data is © Bundesnetzagentur under the
  [Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0)
  (DL-DE-BY-2.0). Attribution is mandatory, and we must state that the data
  was processed.
- **Privacy:** many small units (rooftop PV, home storage) belong to private
  individuals. Never show operator-level detail for natural persons. Operator
  views and transaction feeds cover legal entities only, and by default only
  units at or above a capacity threshold (set in `pipeline/config`).
- **Honesty about signals:** an operator change in MaStR is a *signal*, not a
  confirmed transaction. It can also be a rename, a merger of entities, a
  data correction or a late registration. The UI must say so, and the
  pipeline should flag likely false positives rather than hide them.
- Use MaStR IDs (`EinheitMastrNummer`, `MastrNummer` of the Marktakteur) as
  keys. Never match on names alone.
- German source column names stay in raw and extract layers. Aggregates use
  clean English `snake_case` names, mapped in one place.

## Design: premium data journalism

Reference points: FT, The Economist, Bloomberg Green, Datawrapper charts.
Calm, editorial, dense with information but never cluttered.

- **Typography:** a serif for headlines (e.g. Source Serif / Newsreader) and a
  neutral sans for UI and body (e.g. Inter). Use **tabular numerals** for all
  figures. Keep the type scale small; hierarchy comes from weight and space.
- **Colour:** off-white paper background, near-black ink, warm greys, one
  accent colour. Technology colours are muted and consistent everywhere
  (solar, wind onshore, wind offshore, storage, biomass, hydro). Full dark
  mode. Colour is never the only carrier of meaning.
- **Charts:** a headline that states the finding ("Solar pipeline doubled
  since 2023"), not the variable. Direct labels instead of legends where
  possible. Light gridlines, no chart junk, annotations for key events. A
  source line under every chart: "Source: Marktstammdatenregister, as of DD
  Mon YYYY".
- **Numbers:** MW/GW with sensible rounding, thin-space thousands separators,
  explicit units, deltas with sign and period ("+1.2 GW vs. 30 days ago").
- **Layout:** generous whitespace, a narrow reading column for text, wide
  breakout for charts, a sticky as-of stamp. Mobile first; tables collapse
  well.
- **Footer (every page):** `© Bundesnetzagentur, DL-DE-BY-2.0` linked to the
  licence, plus "Data processed by MaStR Radar" and a link to the methodology
  page.

## Repository layout

```
pipeline/            Python data pipeline (uv project)
  src/mastr_radar/   download, extract, snapshot, diff, aggregate, schemas, cli
  config/            thresholds, technology mapping, column maps
  tests/             unit tests on small synthetic fixtures
web/                 Next.js + Tailwind site
  app/               routes
  components/        charts/, ui/, layout/
  lib/               data loading, types, formatting
  public/data/       generated JSON (written by the pipeline, do not hand-edit)
docs/                PLAN.md, methodology.md, data-dictionary.md
.github/workflows/   ci.yml, pipeline-daily.yml
data/                local working dir for downloads (git-ignored)
```

## Working conventions

- Work milestone by milestone from `docs/PLAN.md`. Tick off what is done and
  note anything deferred.
- Small, focused commits with imperative messages ("Add pipeline aggregate for
  operator changes").
- Pipeline code is tested against tiny fixtures. Never require the multi-GB
  download for unit tests.
- No secrets are needed: the bulk export is public. If a key ever becomes
  necessary, it goes in GitHub/Vercel secrets, never in the repo.
- Commands (fill in as they are created):
  - Pipeline: `cd pipeline && uv run mastr-radar --help`, `uv run pytest`
  - Web: `cd web && npm run dev`, `npm run build`, `npm run lint`
