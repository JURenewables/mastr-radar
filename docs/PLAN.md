# MaStR Radar: roadmap

**You are here: WP35 of 48 · Phase 7 · Hub contract v1.4 (draft)**

Progress: Part 1 done (25 / 25) · Part 2: 9 / 23

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
- [x] **WP7. Station 3: First explorer file.** `manifest.json` (as-of date)
  and `kpis.json` (total installed onshore wind), validated.
  *Done when:* files are generated and checked.
  *Result:* as of 30 Oct 2026: onshore 71.5 GW installed, +4.2 GW in 2026,
  54 GW planned; offshore 11.6 GW, +1.9 GW. Check passed.
- [x] **WP8. Station 4: Website shell.** Next.js + Tailwind on Vercel showing
  that number, the as-of date and the licence footer.
  *Done when:* a public Vercel URL shows the correct number.
  *Result:* built and deployed as a Vercel preview of our branch (behind
  Vercel login, the default for previews); shows 71.5 GW, as-of date and
  footer. The public URL shows it once the branch is merged into `main`.
- [x] **WP9. Daily automation.** GitHub Action runs stations 1–3 each morning
  and commits new files; Vercel redeploys.
  *Done when:* a manual run succeeds and the site updates by itself.
  *Result:* first run on `main` (31 Oct 2026) succeeded end to end: download
  70 min, extract 9 min, checks passed, data committed, Vercel deployed; the
  live site showed data as of 31 Oct 2026 by itself.

🏁 **Milestone: a live public site with one correct number that updates daily.**

## Phase 3: Explorer data

- [x] **WP10. Extract all technologies.** Solar, storage, biomass, hydro,
  offshore wind added to `units.parquet`.
  *Result:* 9.6 M units in ~17 min; all checks passed.
- [x] **WP11. Explorer files.** Unit-level Parquet for larger units, summary
  tables covering all units (incl. small rooftop solar), state and district
  boundaries.
  *Result:* 156 646 units ≥ 100 kW, 449 862 summary rows, BKG outlines;
  11 MB in total.
- [x] **WP12. Data quality notes.** Late registrations (sets each technology's
  "possibly incomplete" date), missing coordinates, placeholder dates,
  outliers: measured and written up for the methodology page.
  *Result:* storage split per plant, plausibility limits, impossible
  dates; batteries now match Energy-Charts (34.7 vs 34.6 GWh).

## Phase 4: Explorer website

- [x] **WP13. Design system.** Fonts, colours, technology palette, dark mode,
  chart and map styling.
  *Result:* colour tokens, chart frame, chips, map style.
- [x] **WP14. Data engine.** DuckDB-WASM loads the explorer files in the
  browser; the current filter lives in the URL so every view is shareable.
  *Result:* DuckDB-WASM over HTTP range requests; filters in the URL,
  validated before reaching SQL (5 tests).
- [x] **WP15. Filters.** Technology, status, state/district, size class,
  commissioning date range (year or month).
- [x] **WP16. Map 1: units.** Points for larger units, sized by MW, coloured
  by technology. *E.g. "everything that went online in 2026".*
- [x] **WP17. Map 2: regions.** States and districts shaded by MW, including
  small units.
- [x] **WP18. Charts 1: build-out over time.** Monthly and yearly additions by
  technology, with the late-registration caveat.
- [x] **WP19. Charts 2: structure.** Size classes, regional ranking, largest
  units.
- [x] **WP20. Table and download.** Sortable table of the current selection,
  CSV export.
- [x] **WP21. Start page.** Headline numbers and ready-made views ("Went
  online this month", "Largest solar parks of 2026", …).
- [x] **WP22. Methodology and licence page.**

## Phase 5: Launch

- [x] **WP23. Quality pass.** Mobile, accessibility, speed.
  *Result:* map first on phones, share link, map description for screen
  readers. Follow-up: speed check on a real phone.
- [x] **WP24. Sharing.** Link previews, shareable views.
  *Result:* link preview image with headline numbers, sitemap, robots.
- [x] **WP25. Launch checks.** Domain, warning banner if data is older than
  48 h, contributor README.
  *Status:* banner and README done; free domain kept (decision 8).

🏁 **Milestone: public MaStR exploration suite.**

---

# Part 2: Monitor, data hub, auctions

Order agreed on 31 Oct 2026: monitor and maps first, then the data hub, then
auctions. English. The scrolling monitor becomes the start page (can change).
Style goal: state of the art, futuristic; inspiration from Zeit Online's
energy monitor and Fraunhofer Energy-Charts (flow and storytelling, not their
look).

## Phase 6: Monitor and maps

- [x] **WP26. Design session.** Three visual directions (Paper, Night,
  Product) as a clickable page with real data: animated "Germany lights up"
  map, key figures, build-out vs 2030 target. You choose or mix.
  *Result:* you chose **C · Product** (map reads best). The running total
  stays top right on the map. Light by default, automatic dark version when
  the phone is in dark mode. Mock-up: https://claude.ai/artifact/Eoju75aXD7jXJAvgMh7Evq
- [x] **WP27. Animation data.** Build-out per year by district/municipality,
  plus plant points; contract update (v1.3).
  *Result:* `monitor/buildout.json`, `points.json`, `stats.json` (0.9 MB);
  contract v1.3 approved.
- [x] **WP28. "Germany lights up": solar.** Play button, year slider.
  *Result:* canvas map, play 1990–today, year slider, districts per km²,
  plants ≥ 1 MW flash in their year.
- [x] **WP29. Same for onshore wind, offshore wind, storage.**
  *Result:* switch for solar, onshore, offshore, storage, all.
- [x] **WP30. Monitor page.** One scrolling page, section navigation; becomes
  the start page.
  *Result:* scrolling monitor is the new start page; sticky section bar;
  whole site restyled to Product (Manrope, white, blue accent).
- [x] **WP31. Section: build-out per year vs 2030 targets.**
  *Result:* progress to target, annual additions and 2030 pace line; plus
  "this year vs previous years" race chart.
- [x] **WP32. Section: states compared** (per km² and per resident).
  *Result:* states per km² or total, densest districts. Per resident needs
  population data: moves to the data hub (WP34+).
- [x] **WP33. Section: the storage boom.**
  *Result:* batteries per year: home, commercial, large; GW or GWh.
- [x] **Extra sections (your request for more analyses):** balcony-solar boom,
  turbines keep growing (drawn to scale), the next wave (planned onshore wind
  map), the ageing fleet (repowering candidates).

## Phase 7: Data hub and "Germany in 24 hours"

Decided 31 Oct 2026: any day of the last 12 months selectable; clearly
labelled estimates are fine for district maps; the grid map shows lines and
real stress signals (line loading itself is not published).

- [x] **WP34. Sources and licences.** SMARD, Energy-Charts, DWD,
  netztransparenz (redispatch), ENTSO-E (free key), OpenStreetMap grid
  (ODbL), Destatis (population), IEA. Write `docs/sources.md`.
  *Result:* `docs/sources.md`. SMARD and DWD are CC BY 4.0 and ready; SMARD
  prices excluded (HEDWIG); population via BKG VG1000-EW; ENTSO-E and
  netztransparenz need your free accounts; OSM share-alike needs your OK.
- [ ] **WP35. Hub contract v1.4 (draft).** Day files, catalogue, size budget.
- [ ] **WP36. SMARD import.** 15-minute generation per technology and demand
  per grid area; back-filled for the last 12 months.
- [ ] **WP37. DWD import.** Hourly sunshine and wind per weather station;
  back-filled.
- [ ] **WP38. Section "Germany in 24 hours".** Date picker, generation stacked
  against demand with a play head, map of the 4 grid areas.
- [ ] **WP39. Estimated solar map per district** (MaStR capacity × DWD
  sunshine, scaled to measured output per grid area).
- [ ] **WP40. Estimated wind map per district.**
- [ ] **WP41. Grid map.** High-voltage lines (OpenStreetMap), cross-border
  flows, redispatch hotspots for the chosen day. Needs your ENTSO-E key for
  flows.
- [ ] **WP42. Optional: estimated line loading** with a power-flow model
  (several WPs).
- [ ] **WP43. Access for agents:** catalogue page, `llms.txt`, stable links.

## Phase 8: Auctions

- [ ] **WP44. Import award lists** (onshore since 2017), link to MaStR via the
  EEG number.
- [ ] **WP45. Rounds overview:** volumes, competition, published prices.
- [ ] **WP46. Winners map and time to going online.**
- [ ] **WP47. Run-up before bid dates.**
- [ ] **WP48. Optional: energy yield estimate.**

---

## Follow-ups noted

- [x] Automatic cross-check: each `aggregate` run compares installed capacity
  per technology with the Energy-Charts API (±2%, warning only) and writes
  `data/reports/crosscheck.json`. WP9: show these warnings in the daily
  GitHub run summary. Storage not compared yet (ours includes pumped hydro).
- Explorer: show both gross additions and net additions (after
  decommissioning), since public sources such as Energy-Charts quote net.

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
4. **Repo:** public. Site public on Vercel: project `mastr-radar`, linked to
   GitHub, root directory `web`, Next.js, Node 22. Live site (from `main`):
   https://mastr-radar.vercel.app. Other branches get preview links.
   *(Custom domain still open.)*
5. **Scope:** exploration suite first; auctions and yield later.
6. **Contract v1.1** (after WP4): own reader instead of open-mastr; offshore
   regions from MaStR's `Seelage`; storage includes pumped hydro;
   "possibly incomplete" per technology.
7. **Contract v1.2** (31 Oct 2026, approved): data quality rules (storage
   capacity split per plant, plausibility limits, impossible dates);
   operator names on the website only from 1 MW.
8. **Domain:** keep the free https://mastr-radar.vercel.app for now. To change
   later: add the domain in Vercel (Settings → Domains) and update
   `web/lib/site.ts`.

9. **Contract v1.3** (31 Oct 2026, approved): monitor files and region areas.