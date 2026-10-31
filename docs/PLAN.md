# MaStR Radar: roadmap

**You are here: WP7 of 25 · Phase 2 · Next: station 3, first explorer files (manifest + headline numbers)**

Progress: ██████░░░░░░░░░░░░░░░░░░░ 6 / 25

Each work package (WP) takes about 30 minutes and ends with something
committed and checked. "Done when" is the test for ticking it off.

---

## Phase 1: Setup ✅

- [x] **WP1. Project docs.** CLAUDE.md and this roadmap.
- [x] **WP2. Pipeline skeleton.** `uv` project, CLI stub, tests, CI.

## Phase 2: One number, live, end to end

Push a single figure through all four stations to a live website before
building anything wide. That way every problem in the chain shows up early.

- [x] **WP3. Station contracts.** Write `docs/contracts.md`: for each station,
  the output files, every column, its type and meaning. No code. You review
  it, then it's locked (v1).
  *Done when:* you've approved v1.
- [x] **WP4. Data check.** Real open-mastr download. Measure size, time and
  disk use on a GitHub runner. Confirm every contract column exists. Count
  units per technology and size class (this decides the size limit for
  unit-level map data). Record findings in `docs/data-dictionary.md`.
  *Done when:* we know the daily job fits on a free GitHub runner and the
  contract holds (or we've adjusted it, as its own step).
  *Result:* runner is fine (86 GB disk); download needs resume/retry;
  open-mastr 1.0.0 fails on all solar files. Details in
  `docs/data-dictionary.md`.
- [x] **WP5. Station 1: Download.** Own downloader for the BNetzA export:
  resumes after a broken connection, retries with increasing waits, then
  checks the zip (integrity, required files, date, size) and writes
  `download_meta.json`.
  *Done when:* the real export downloads and passes the check, and tests on
  a tiny fixture zip pass (incl. a simulated broken download).
  *Result:* full export 3.26 GB in 50 min; the connection broke at 3.12 GB
  and the download resumed and finished; check passed (189 files, CRC).
- [x] **WP6. Station 2: Extract (wind).** Export zip → `units.parquet` for wind,
  validated against the contract.
  *Done when:* runs on the real data and a fixture test passes.
  *Result:* 44 344 turbines in 84 s; check passed; totals match WP4
  (71.54 GW onshore, 11.64 GW offshore operating).
- [ ] **WP7. Station 3: First explorer file.** `manifest.json` (as-of date)
  and `kpis.json` (total installed onshore wind), validated.
  *Done when:* files are generated and checked.
- [ ] **WP8. Station 4: Website shell.** Next.js + Tailwind on Vercel showing
  that number, the as-of date and the licence footer.
  *Done when:* a public Vercel URL shows the correct number.
- [ ] **WP9. Daily automation.** GitHub Action runs stations 1–3 each morning
  and commits new files; Vercel redeploys.
  *Done when:* a manual run succeeds and the site updates by itself.

🏁 **Milestone: a live public site with one correct number that updates daily.**

## Phase 3: Explorer data

- [ ] **WP10. Extract all technologies.** Solar, storage, biomass, hydro,
  offshore wind added to `units.parquet`.
- [ ] **WP11. Explorer files.** Unit-level Parquet for larger units, summary
  tables covering all units (incl. small rooftop solar), state and district
  boundaries.
- [ ] **WP12. Data quality notes.** Late registrations (sets each technology's
  "possibly incomplete" date), missing coordinates, placeholder dates,
  outliers: measured and written up for the methodology page.

## Phase 4: Explorer website

- [ ] **WP13. Design system.** Fonts, colours, technology palette, dark mode,
  chart and map styling.
- [ ] **WP14. Data engine.** DuckDB-WASM loads the explorer files in the
  browser; the current filter lives in the URL so every view is shareable.
- [ ] **WP15. Filters.** Technology, status, state/district, size class,
  commissioning date range (year or month).
- [ ] **WP16. Map 1: units.** Points for larger units, sized by MW, coloured
  by technology. *E.g. "everything that went online in 2026".*
- [ ] **WP17. Map 2: regions.** States and districts shaded by MW, including
  small units.
- [ ] **WP18. Charts 1: build-out over time.** Monthly and yearly additions by
  technology, with the late-registration caveat.
- [ ] **WP19. Charts 2: structure.** Size classes, regional ranking, largest
  units.
- [ ] **WP20. Table and download.** Sortable table of the current selection,
  CSV export.
- [ ] **WP21. Start page.** Headline numbers and ready-made views ("Went
  online this month", "Largest solar parks of 2026", …).
- [ ] **WP22. Methodology and licence page.**

## Phase 5: Launch

- [ ] **WP23. Quality pass.** Mobile, accessibility, speed.
- [ ] **WP24. Sharing.** Link previews, shareable views.
- [ ] **WP25. Launch checks.** Domain, warning banner if data is older than
  48 h, contributor README.

🏁 **Milestone: public MaStR exploration suite.**

---

## Later options (parked, not scheduled)

Each becomes its own phase once the explorer is live.

- **Pipeline & competitors:** planned and permitted projects, operator
  portfolios and rankings.
- **Repowering:** wind turbines past 20 years or their EEG end date.
- **Grid connection:** capacity by grid operator and voltage level.
- **Auction analysis:** BNetzA award lists link to MaStR via the EEG register
  number (checked on the Aug 2026 onshore list: one row per turbine with
  `EEG…` number). Run-up before bid dates, winner maps, published round
  averages for award prices.
- **Yield estimate:** Global Wind Atlas + windpowerlib power curves → annual
  energy, full-load hours and EEG site quality for winning turbines; possibly
  calibrated with netztransparenz.de actual output.
- **Change tracking:** daily snapshots (GitHub Release assets) and diffs.

## Decisions

1. **UI language:** English for now; UI text kept in one place so German can
   be added. *(Still open.)*
2. **Snapshot storage (for later change tracking):** GitHub Release assets.
   No setup needed.
3. **Operator names:** legal entities only, units ≥ 1 MW.
4. **Repo:** public. Site public on Vercel. *(Domain still open.)*
5. **Scope:** exploration suite first; auctions and yield later.
6. **Contract v1.1** (after WP4): own reader instead of open-mastr; offshore
   regions from MaStR's `Seelage`; storage includes pumped hydro;
   "possibly incomplete" per technology.
