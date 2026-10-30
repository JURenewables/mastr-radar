# MaStR Radar: build plan

Each milestone is sized for one 30–45 minute session and ends with something
committed and checkable. Phases A and B (data) and C (web) can partly run in
parallel once the JSON contract exists (milestone 4).

## Phase A: data foundation

- [x] **1. Pipeline skeleton.** `uv` project in `pipeline/`, package
  `mastr_radar`, `typer` CLI stub, ruff + pytest, `.gitignore` for `data/`,
  `ci.yml` running lint and tests.
  *Done when:* `uv run mastr-radar --help` and `uv run pytest` pass in CI.
- [ ] **2. Data spike (risk check).** Run an open-mastr bulk download for
  wind, solar and storage. Measure download size, SQLite size, runtime and
  peak disk use. Record the relevant tables and columns in
  `docs/data-dictionary.md`.
  *Done when:* we know whether a standard GitHub runner can handle it (disk
  is about 14 GB free) or which workaround we need.
- [ ] **3. Extract to Parquet.** SQLite → one slim Parquet per technology
  with only the columns we use (IDs, operator ID, status, capacity, dates,
  state, district, coordinates where public). Map columns in one place.
  *Done when:* the extract runs on a fixture and on the real DB and is tested.
- [ ] **4. Output contract + first aggregates.** Pydantic schemas for
  `manifest.json` and `capacity.json` (capacity by technology × status ×
  state × commissioning year). Mirror them in TypeScript types.
  *Done when:* the JSON validates against the schema and fixture tests pass.

## Phase B: signals

- [ ] **5. Pipeline aggregates.** Planned and permitted capacity (status "in
  Planung", wind permits from `EinheitGenehmigung`), by state, technology and
  expected commissioning date. Overdue projects (expected date already
  passed).
  *Done when:* `pipeline.json` is generated and tested.
- [ ] **6. Snapshots & diffing.** Persist each day's slim snapshot as a GitHub
  Release asset, load the previous one, and compute change events: new units,
  status transitions (planned → operating, decommissioned) and operator
  changes.
  *Done when:* a diff between two fixture snapshots yields the expected events.
- [ ] **7. M&A signal feed.** Turn operator changes into `transactions.json`:
  seller → buyer, MW, technology, region, date. Apply the size threshold,
  exclude natural persons, and flag likely renames (same address or
  successor entity) as low-confidence.
  *Done when:* the feed is generated, the heuristics are unit-tested, and
  limitations are noted in `docs/methodology.md`.
- [ ] **8. Operator league tables.** `operators.json`: top operators by MW
  per technology, 12-month growth, pipeline share, plus one small profile
  file per large operator.
  *Done when:* generated and size-checked against the JSON budget.
- [ ] **9. Daily GitHub Action.** `pipeline-daily.yml`: cron, free up disk,
  cache the `uv` environment, run the pipeline, validate outputs, commit
  `web/public/data/` only if it changed, upload the snapshot, and open an
  issue on failure.
  *Done when:* a manual `workflow_dispatch` run succeeds end to end.

## Phase C: website

- [ ] **10. Web scaffold & design system.** Next.js (App Router, TS) +
  Tailwind in `web/`. Design tokens (paper/ink/accent, technology colours,
  dark mode), fonts, base layout, header, footer with
  `© Bundesnetzagentur, DL-DE-BY-2.0`. Connect to Vercel.
  *Done when:* an empty styled shell is live on a Vercel preview URL.
- [ ] **11. Data layer & formatting.** Typed loaders for `public/data`,
  number/unit/date formatters (MW/GW, deltas), as-of stamp component, and
  chart wrapper with title, subtitle and source line.
  *Done when:* formatters are unit-tested and the stamp renders from the
  manifest.
- [ ] **12. Overview page.** KPI row (installed GW, pipeline GW, 30-day net
  additions, operator changes in 30 days) and a headline capacity chart by
  technology over time.
- [ ] **13. Pipeline page.** Pipeline by state and technology, expected
  commissioning timeline, overdue projects table.
- [ ] **14. Transactions page.** Filterable feed of operator changes (by
  technology, state, size, confidence) with a short "how to read this" note.
- [ ] **15. Operator pages.** League table plus static profile pages for top
  operators (portfolio mix, growth, recent changes).
- [ ] **16. Map.** State-level choropleth (installed and pipeline MW),
  optionally district level if the size budget allows.
- [ ] **17. Methodology & licence page.** Sources, processing steps,
  definitions, signal caveats, privacy approach, full licence text and link.

## Phase D: polish & launch

- [ ] **18. Quality pass.** Accessibility (contrast, keyboard, chart
  alternatives), mobile layouts, Lighthouse performance, empty and error
  states.
- [ ] **19. Sharing & SEO.** Metadata, OG images per page with the headline
  number, sitemap, CSV download of each chart's data.
- [ ] **20. Launch checklist.** Custom domain, monitoring of the daily job
  (stale-data banner if the manifest is older than 48 h), README for
  contributors.

## Decisions

1. **UI language:** English for now. Keep UI text in one place so German can
   be added later. *(Still open.)*
2. **Snapshot storage:** GitHub Release assets. No accounts or setup needed;
   the daily Action uploads with its built-in token.
3. **Size threshold** for operator and transaction views: **1 MW**.
4. **Repo:** public. The site is publicly accessible on Vercel. *(Domain
   still open.)*
