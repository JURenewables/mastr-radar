# MaStR Radar: roadmap

**You are here: contract v1.14 (26 Nov 2026): champions without corporate finance, lean vs heavy, battery builders. Phase 12 built: champions on /players, technology combinations on /wind, new /hubs page (hubs, siting, power/gas/hydrogen networks). Open: more financials for private developers (WP99 follow-up), WP83 evals (budget), WP93, MCP registry listings**

Progress: Part 1 done (25 / 25) · Part 2: 16 / 23

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
  *Result:* states per km², per resident (BKG VG250-EW population, added in
  Phase 7) or total; densest districts.
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
- [x] **WP35. Hub contract v1.4 (draft).** Day files, catalogue, size budget.
  *Result:* separate chain H1 fetch → H2 day files; budget 50 MB; approved.
- [x] **WP36. SMARD import.** 15-minute generation per technology and demand
  per grid area; back-filled for the last 12 months.
  *Result:* 364 days, 10 MB; nuclear left out (no values since Apr 2023); 6
  night-time solar spikes cleaned; own daily workflow `hub-daily.yml`.
- [x] **WP37. DWD import.** Hourly sunshine and wind per weather station;
  back-filled.
  *Result:* every day file has hourly radiation (≈65 stations) and wind
  (≈285 stations); `days/stations.json`; 20 MB for the year.
- [x] **WP38. Section "Germany in 24 hours".** Date picker, generation stacked
  against demand with a play head, map of the 4 grid areas.
  *Result:* date picker (last 12 months), play through the day, generation
  stacked against demand for Germany or each grid area, key figures.
- [x] **WP39. Estimated solar map per district** (MaStR capacity × DWD
  sunshine, scaled to measured output per grid area).
  *Result:* district solar estimate (MaStR capacity × DWD radiation, scaled
  to each grid area's measured output).
- [x] **WP40. Estimated wind map per district.**
  *Result:* district wind estimate (MaStR capacity × DWD wind, rough power
  curve, scaled to measured output); renewable-share map of the grid areas.
- [ ] **WP41. Grid map.** High-voltage lines (OpenStreetMap), cross-border
  flows, redispatch hotspots for the chosen day. Needs your ENTSO-E key for
  flows.
- [ ] **WP42. Optional: estimated line loading** with a power-flow model
  (several WPs).
- [x] **WP43. Access for agents:** catalogue page, `llms.txt`, stable links.
  *Result:* `/llms.txt`, `/catalog.json` (built from the manifest), `/open-data`
  page with quick-start code; CORS open on `/data/*`.

## Phase 8: Turbine makers and auctions

- [x] **WP49. Turbine makers data:** brands from registered manufacturer
  names, additions and fleet per brand and year, most-built models, sizes.
  *Result:* `wind_industry` in `stats.json` (contract v1.5 draft); 1.4 % of
  capacity has no clear maker.
- [x] **WP50. Makers race:** bar chart race (fleet or yearly additions, play
  button), market share of new capacity since 2000.
- [x] **WP51. Turbine models:** most-built models since 2024 with hub height
  and rotor; rotor, hub height and rating per maker since 2005.

- [x] **WP44. Import award lists** (onshore 2025–2026 so far), link to MaStR via
  the register numbers.
  *Result:* `auctions-fetch` + build in station 3; 7 rounds, 2,541 awards,
  ~100 % of turbines found in MaStR; bidders grouped by name (42 % of capacity
  not attributable from the name alone).
- [x] **WP45. Rounds overview:** published prices per round (lowest, average,
  highest vs ceiling), top winning groups per year, bidder types, turbine
  makers in the awards.
- [x] **WP52. Older rounds:** all 34 onshore rounds since May 2019 (earlier
  lists use unlinkable register numbers).
- [x] **WP53. Yield estimate:** DWD wind grid + MaStR turbine data →
  full-load hours, Gütefaktor, Korrekturfaktor, received value; merit order
  per round.
- [x] **WP54. Five bidder types:** utilities and Stadtwerke split, Alterric as
  IPP, enercity as Stadtwerk; winners with "not attributed" and "citizen"
  bars, selectable by year and type.
- [x] **WP55. Winners race and share of the cake** since 2019 (companies and
  bidder types).
- [x] **WP56. Players:** operating capacity by group (from auctions and whole
  fleet), data by bidder type, editorial drivers analysis.
- [x] **WP57. Reviewed attributions and company cross-check:**
  `config/auction_reviewed.yaml` (hand assignments with sources, company-
  reported totals); comparison table on the site. UGE → UKA.
- [x] **WP58. Office attribution:** station 2 writes `operators.parquet`
  (organisations with office address, internal); unknown bidders grouped by
  the office of their operator company. "Not attributed" 45 % → 30 %;
  13 of 20 company-reported totals match within ~4 %.
- [x] **WP59. Site split:** start page = energy-transition monitor and maps;
  new `/wind` page = turbines, makers, models, repowering and all auction
  sections.
- [x] **WP60. Auction map:** awarded projects per round (or all), by bidder
  type and company, with details on tap.
- [x] **WP61. Wind page as a storyline:** five chapters (machines, price,
  where, who wins, why) with generated takeaways and caveats per section;
  animated award map (round by round, no company colours); company map
  coloured by year with profile and takeaways; turbine makers per company.
- [x] **WP62. Unit details (station 2, internal):** grid connection voltage
  and capacity, award number, declared yield ratio, permit date, solar type,
  tracker, land use, battery on site.
- [x] **WP63. Solar auctions:** ground-mounted rounds since 2019 (awards since
  2023) and innovation rounds; links via award numbers; solar groups added.
- [x] **WP64. Solar yield, batteries, portfolios** (DWD radiation grid).
- [x] **WP65. Wind success drivers:** calibration with declared yield ratios;
  permitted turbines awarded vs not by year, site quality, grid voltage;
  company volume vs site quality.
- [x] **WP66. Solar page** (`/solar`, five chapters) and cross-technology
  view (groups in wind and solar) on both pages; nav Monitor | Solar | Wind.
- [x] **WP68. Rise and fall:** share early vs late, rounds with an award,
  year-to-year swing and status (new, rising, steady, fading, dropped) per
  group, on the wind and solar pages.
- [x] **WP69. Business models and exits:** sourced company facts (develop and
  sell vs IPP, project vs corporate finance), retreats and insolvencies
  (Senvion, Siemens Gamesa, BayWa r.e., ABO Energy, SoWiTec, Enerparc) and
  turbine makers worldwide (GWEC). Follow-up: add JUWI, PNE, Energiekontor,
  ENERTRAG, Anumar once sources are checked.
- [x] **WP70. A market under strain:** price slide vs ceiling, submitted
  bids vs volume, awarded-but-unbuilt backlog with the 36-month wind
  deadline, unbuilt awards held by companies in insolvency or restructuring,
  what led up to it and the dangers (new chapter on both pages).
- [x] **WP71. Grid page** (`/grid`): grid operators and concentration, TSO
  control areas map, voltage levels, large consumers and the demand wave,
  congestion costs, connection rules; from new MaStR grid fields (station 2
  `extract-grid`) plus sourced context. Next: line-level model (needs OSM
  decision, Netztransparenz and ENTSO-E access).
- [x] **WP72. Players worldwide** (`/players`): 18 utilities, IPPs,
  investors and developers with staff, earnings, debt, capacity, markets,
  mix, momentum; Wind and Solar pages labelled as Germany. Follow-up: add
  Iberdrola, Engie, Encavis, Trianel/enercity, Nordex/Enercon/Vestas
  orders by customer.
- [x] **WP74. Grid APIs** (contract v1.8): Netztransparenz redispatch
  since 2021 and ENTSO-E cross-border flows, fetched with GitHub Secrets by a
  separate daily workflow; Grid page sections "Redispatch by the TSOs" and
  "Cross-border flows". Open: written permission from the TSOs (optional).
- [x] **WP73a. AI guide** on `/open-data` and `/llms.txt` (question → file map, primary-source directory). The rest of WP73 is Phase 9.
- [ ] **WP67. Grid distance:** distance to the nearest substation (needs the
  OpenStreetMap ODbL decision).
- [ ] **WP45b. Better attribution (continue):** map project companies to their parent
  groups (e.g. from MaStR operator data or a reviewed list) to shrink the
  "not attributed" share. Older rounds (2017–2024).
- [ ] **WP46. Winners map and time to going online.**
- [ ] **WP47. Run-up before bid dates.**
- [ ] **WP48. Optional: energy yield estimate.**


---

## Phase 8b: Auction timing, outlook, phone report

- [x] **WP85. Auction run-up:** when permits and units of awarded projects
  appear in MaStR relative to the bid date and the permit deadline (wind),
  first registration of awarded solar parks; weekly registration waves.
  Sections high up on Wind and Solar. *Contract v1.9.*
- [x] **WP86. Outlook page: repowering potential** (`/outlook`): map of
  turbines past EEG support and the next wave, models, owners, retirements,
  illustrative potential with stated assumptions.
- [x] **WP87. Outlook page: auction outlook:** next bid dates, permitted pool
  without award vs round volume, price direction (assessment).
- [x] **WP88. Phone report:** daily Telegram summary and failure alert from
  the daily workflow (secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).

---

## Phase 12: Champions, technology combinations, multi-asset hubs

Goal: "Who are the champions of the energy transition, how do players
combine technologies, and where are (and should be) hubs that join wind,
solar, batteries, hydrogen, gas and large consumers?" Contract v1.13.

- [x] **WP99. Champions.** Fill financials from primary sources; scoring
  framework (scale, breadth, execution, momentum, financial strength).
- [x] **WP100. Technology combinations.** wind+battery (same grid location,
  no solar), wind+solar, wind+solar+battery; by company group.
- [x] **WP101. More of the register.** Combustion, electrolysers, gas
  consumers and storage, large consumers, locations (station 2).
- [x] **WP102. Multi-asset hubs.** Sites with ≥ 3 asset types.
- [x] **WP103. Siting score.** By district, adjustable weights.
- [x] **WP104. Infrastructure layers.** Power lines, gas, hydrogen core
  network (decisions needed: OSM ODbL, SciGRID_gas, H2 data).
- [x] **WP105. Pages.** Champions on `/players`, combinations on `/wind`,
  new `/hubs`.

---

## Phase 11: Profitability and co-location (Outlook)

Goal: "What does an awarded wind or solar project earn, and where and in
which rounds were projects most valuable?" Plus wind with batteries or
solar on the same grid connection. Contract v1.12.

- [x] **WP94. Assumptions and contract v1.12.** Capex per project (WindGuard
  formula), revenue, financing, IRR method. *Approved 25 Nov 2026.*
- [x] **WP95. Profitability model.** `costs/profitability.json`: capex,
  revenue, project and equity IRR, NPV per award; by round, by state,
  sensitivities; checks and tests.
- [x] **WP96. Co-location.** `auctions/colocation.json` with wind+storage and
  wind+solar sites (same grid location, or within 500 m).
- [x] **WP97. Pages.** Profitability sections on `/costs/wind` and
  `/costs/solar`; co-location section on `/wind` (user's choice; the
  Outlook stays as it is).
- [x] **WP98. Find the solar costs.** Separate "Wind costs" / "Solar costs"
  menu entries, links from the wind and solar pages.

---

## Phase 10: Cost benchmarks (onshore wind, solar PV)

Goal: "What does a wind or solar project cost to build and run in Germany,
what is it made of, and how do the main sources compare?" Contract v1.11.

- [x] **WP89. Sources and contract v1.11.** WindGuard 2024, Fraunhofer ISE
  2024/2021/2018, Danish Energy Agency (Aug 2026), IRENA 2025: editions,
  licences, which source leads per technology. *Approved 25 Nov 2026.*
- [x] **WP90. Cost config and station 3.** `config/costs.yaml` with every
  value and its source; `costs/costs.json` with breakdowns, comparison,
  trends, projections, auction link; checks; dictionary entry; tests.
- [x] **WP91. `/costs/wind` page.** Capex and opex breakdown (WindGuard),
  sources compared, turbine price trend 2015–2024, costs vs award prices.
- [x] **WP92. `/costs/solar` page.** Capex breakdown (DEA), Fraunhofer
  range, IRENA Germany trend, ground-mounted vs rooftop, costs vs award
  prices.
- [ ] **WP93 (optional). More trend data.** Quarterly turbine selling prices
  (Vestas, Nordex reports), monthly module prices (pvXchange), an MCP tool
  `cost_benchmarks`.

---

## Phase 9: Open data for AI agents (MCP)

Goal: "Point your AI at MaStR Radar and it finds the answer." A public,
read-only MCP server plus the context an agent needs to use the data
correctly. Design and decisions: `docs/platform-plan.md`.

- [x] **WP75. Semantic layer (one data dictionary).** Every published file
  and column in one machine-readable file (`docs/data-dictionary.yaml`):
  meaning, type, unit, allowed values, source, licence, caveats, example
  questions. The check fails if a published column is undescribed.
  Everything below is generated from it. *Contract v1.10.*
- [x] **WP76. Agent context pack.** Generated from WP75: `/llms-full.txt`
  (all datasets with columns), `/schema.json` (JSON Schema per dataset),
  one short "dataset card" per file, a citation line, known gaps (late
  registrations, private units without location, TSO-only redispatch) and
  20 starter questions with the query that answers each.
- [x] **WP77. Query engine prototype.** DuckDB in a Vercel Node function
  reading the published Parquet/JSON. Measure cold start, memory and query
  time on the 5 heaviest questions. Fallback if too slow: precomputed
  answers only. Decide hosting of larger files (WP78). *Done: DuckDB
  fits (start 23 ms, queries ≤ 85 ms, 154 MB); details in platform-plan.*
- [x] **WP78. Daily snapshots (history).** Keep a dated copy of the explorer
  files every day (decision 2: GitHub Release assets) so agents can ask
  "what changed since …" and answers stay reproducible. Snapshot index in
  the catalogue.
- [x] **WP79. MCP contract (v1.10).** Tool names, input/output schemas,
  limits and error messages written down and approved before code
  (contracts first). *Approved 25 Nov 2026.*
- [x] **WP80. MCP server v1.** Remote, read-only, Streamable HTTP, no login,
  at `https://mastr-radar.vercel.app/mcp`. Tools: `list_datasets`,
  `describe_dataset`, `run_sql` (SELECT only, row cap, timeout),
  `get_kpis`. Resources: data dictionary, methodology, contract,
  licences. Every answer carries `as_of`, source and licence. *Done: own
  small JSON-RPC handler (no SDK), DuckDB locked to the data folder, flat
  views for awards, rounds, players and redispatch; checked with the
  official MCP client and a test of every tool.*
- [x] **WP81. Domain tools v2.** Typed tools for the common questions so
  agents need no SQL: `find_units` (technology, status, region, size,
  commissioning period), `auction_round`, `auction_winners`,
  `company_profile`, `region_profile`, `grid_redispatch`,
  `cross_border_flows`, `whats_new` (from WP78). Prompts (templates) for
  typical analyses.
- [x] **WP82. Guardrails and operations.** Rate limits, query timeouts, size
  caps, privacy enforced in the tool layer (no natural persons, D4),
  anonymous usage counts (no personal data), a health endpoint and an
  alert when the server fails.
- [ ] **WP83. Agent evals.** 30 real questions with checked answers (e.g.
  "which wind and solar projects went online in March 2026, and where?").
  Run them through Claude with the MCP server after every release and track
  the pass rate. Costs API money: needs your approval and budget.
- [x] **WP84. "Connect your AI" page and listings.** Copy-paste setup for
  Claude (custom connector URL), Claude Code
  (`claude mcp add --transport http mastr-radar https://mastr-radar.vercel.app/mcp`)
  and other MCP clients; an OpenAPI description for agents without MCP;
  listing in public MCP registries. *Built: `/connect`. Still open: OpenAPI
  description and registry listings (listings need your account).*

---

## Follow-ups noted

- Players: net debt for Energiekontor (€549 m) and PNE (€731 m) filled from
  the 2025 reports; Alterric publishes no group EBITDA; ABO's audited 2025
  figures not yet found; wpd and UKA publish no group figures.

- Web dev tools: `npm audit` shows 7 moderate warnings in a linting dependency
  (minimatch via typescript-eslint); none in production packages. Fix when
  eslint-config-next updates.
- MCP function bundle includes `public/data/days/` (about 21 MB) because
  `outputFileTracingExcludes` had no effect in Next 16; total about 41 MB,
  far below the 250 MB limit.

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
10. **Contract v1.4** (31 Oct 2026, approved): data hub day files (SMARD,
    DWD), population, budget 50 MB.