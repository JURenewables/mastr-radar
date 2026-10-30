# MaStR Radar: roadmap

**You are here: WP3 of 24 · Phase 2 · Next: write the station contracts**

Progress: ██░░░░░░░░░░░░░░░░░░░░░░ 2 / 24

Each work package (WP) takes about 30 minutes and ends with something
committed and checked. "Done when" is the test for ticking it off.

---

## Phase 1: Setup ✅

- [x] **WP1. Project docs.** CLAUDE.md and this roadmap.
- [x] **WP2. Pipeline skeleton.** `uv` project, CLI stub, tests, CI.

## Phase 2: One number, live, end to end

Push a single figure through all four stations to a live website before
building anything wide. That way every problem in the chain shows up early.

- [ ] **WP3. Station contracts.** Write `docs/contracts.md`: for each station,
  the output files, every column, its type and meaning. No code. You review
  it, then it's locked (v1).
  *Done when:* you've approved v1.
- [ ] **WP4. Data check.** Real open-mastr download. Measure size, time and
  disk use on a GitHub runner. Confirm every contract column exists. Count
  units per technology and size class (this decides the size limit for
  unit-level map data). Record findings in `docs/data-dictionary.md`.
  *Done when:* we know the daily job fits on a free GitHub runner and the
  contract holds (or we've adjusted it, as its own step).
- [ ] **WP5. Station 2: Extract (wind).** SQLite → `units.parquet` for wind,
  validated against the contract.
  *Done when:* runs on the real data and a fixture test passes.
- [ ] **WP6. Station 3: First explorer file.** `manifest.json` (as-of date)
  and `kpis.json` (total installed onshore wind), validated.
  *Done when:* files are generated and checked.
- [ ] **WP7. Station 4: Website shell.** Next.js + Tailwind on Vercel showing
  that number, the as-of date and the licence footer.
  *Done when:* a public Vercel URL shows the correct number.
- [ ] **WP8. Daily automation.** GitHub Action runs stations 1–3 each morning
  and commits new files; Vercel redeploys.
  *Done when:* a manual run succeeds and the site updates by itself.

🏁 **Milestone: a live public site with one correct number that updates daily.**

## Phase 3: Explorer data

- [ ] **WP9. Extract all technologies.** Solar, storage, biomass, hydro,
  offshore wind added to `units.parquet`.
- [ ] **WP10. Explorer files.** Unit-level Parquet for larger units, summary
  tables covering all units (incl. small rooftop solar), state and district
  boundaries.
- [ ] **WP11. Data quality notes.** Late registrations, missing coordinates,
  outliers: measured and written up for the methodology page.

## Phase 4: Explorer website

- [ ] **WP12. Design system.** Fonts, colours, technology palette, dark mode,
  chart and map styling.
- [ ] **WP13. Data engine.** DuckDB-WASM loads the explorer files in the
  browser; the current filter lives in the URL so every view is shareable.
- [ ] **WP14. Filters.** Technology, status, state/district, size class,
  commissioning date range (year or month).
- [ ] **WP15. Map 1: units.** Points for larger units, sized by MW, coloured
  by technology. *E.g. "everything that went online in 2026".*
- [ ] **WP16. Map 2: regions.** States and districts shaded by MW, including
  small units.
- [ ] **WP17. Charts 1: build-out over time.** Monthly and yearly additions by
  technology, with the late-registration caveat.
- [ ] **WP18. Charts 2: structure.** Size classes, regional ranking, largest
  units.
- [ ] **WP19. Table and download.** Sortable table of the current selection,
  CSV export.
- [ ] **WP20. Start page.** Headline numbers and ready-made views ("Went
  online this month", "Largest solar parks of 2026", …).
- [ ] **WP21. Methodology and licence page.**

## Phase 5: Launch

- [ ] **WP22. Quality pass.** Mobile, accessibility, speed.
- [ ] **WP23. Sharing.** Link previews, shareable views.
- [ ] **WP24. Launch checks.** Domain, warning banner if data is older than
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
