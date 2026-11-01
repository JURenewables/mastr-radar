# Handover — 1 Nov 2026

Branch `claude/blissful-cannon-t3pa07` (restarted from `main` after PR #5).
Live site: https://mastr-radar.vercel.app (from `main`, contract v1.7).
Branch preview (Vercel login needed):
https://mastr-radar-git-claude-blissful-cannon-t3pa07-re-s-ma-str.vercel.app

Roadmap and ticks: `docs/PLAN.md`. Data formats: `docs/contracts.md`.
Sources and licences: `docs/sources.md`.

## Done

**Live on `main`**
- Part 1 (WP1–25): download → extract → explorer files → website, daily
  GitHub Actions run, Energy-Charts cross-check.
- Phase 6: scrolling monitor (light-up map, 2030 targets, this year, solar
  types, turbine growth, states, storage, pipeline, repowering).
- Phase 7 (except WP41): data hub with SMARD and DWD day files, "Germany in
  24 hours", open data (`/open-data`, `/catalog.json`, `/llms.txt`).
- Daily hub run on `main` after the last merge: succeeded.

**Contract v1.5 (approved and live since 31 Oct 2026, PR #5)**
- WP49–51 turbine makers: `wind_industry` in `monitor/stats.json`, a bar
  chart race (fleet or yearly additions), market share since 2000, most-built
  models since 2024 with hub height and rotor, sizes per maker.
- WP44–45 auctions: `mastr-radar auctions-fetch` (BNetzA round pages and
  award lists, cached in `data/auctions/`). The build runs inside `aggregate`
  and writes `auctions/onshore.json` and `auctions/awards.json`. Website
  sections "Auctions" (prices per round) and "Winners" (top groups, bidder
  types, turbine makers). Methodology and catalogue are updated, the v1.5
  draft is in `docs/contracts.md`, and the daily workflow has an
  auctions-fetch step.
- Checks: pytest 85 passed, ruff clean, web lint and build clean.

**Contract v1.6 (approved 1 Nov 2026, live with PR #6)**
- WP52 all 34 onshore rounds since May 2019 (tolerant parser for the older
  page wordings and list layouts).
- WP53 yield estimate per awarded turbine (`wind.py`,
  `config/wind_yield.yaml`): DWD 200 m wind grid + MaStR coordinates, hub
  height, rotor, rating → full-load hours, Gütefaktor, Korrekturfaktor,
  estimated received value; merit order per round.
- WP54 five bidder types (utilities and Stadtwerke split; Alterric = IPP;
  enercity = Stadtwerk); winners include "Not attributed" and "Citizen &
  local (all)" as striped bars; year and type selectable.
- WP55 winners race (companies or bidder types, since 2019 or per year) and
  share-of-the-cake chart.
- WP56 "Players": operating capacity by group (from auctions and whole
  fleet), data table by bidder type, editorial drivers matrix.
- Checks: pytest 100 passed, ruff clean, web lint and build clean, station 3
  check passes.

**Contract v1.7 (approved 1 Nov 2026, merged to main)**
- WP62 `data/extract/unit_details.parquet` (internal): grid voltage and
  capacity, award number, declared wind yield ratio, permit date, solar type,
  tracker, land use, battery on site (`mastr-radar extract-details`).
- WP63–64 solar auctions (`solar_auctions.py`): ground-mounted since 2019
  (awards since 2023), innovation since 2020; yield from the DWD radiation
  grid; batteries on site; portfolios; solar company groups.
- WP65 wind success drivers and calibration: model quality × 0.79 (median of
  4,431 declared MaStR ratios; correlation 0.44); declared value used where
  present. Findings: 95 % of turbines permitted 2021–23 won regardless of
  site quality; volume vs site quality rank correlation +0.18.
- WP66 `/solar` page and wind/solar cross-technology section.
- WP68 rise and fall (`dynamics` in onshore.json and solar.json): share
  early vs late, rounds with an award, year-to-year swing, status per group.
- WP69 business models and exits: `pipeline/config/company_facts.yaml` →
  `auctions/company_facts.json` (every statement sourced). Big news found:
  Enerparc, the top solar auction winner, filed for insolvency in Sept 2026;
  SoWiTec in July 2026; ABO Energy and BayWa r.e. are restructuring.
- WP70 "A market under strain" (`auctions/market_risk.json`): wind prices
  −35 % Feb 24 → Aug 26 with 2.1× bids; 29 GW of wind awards not yet
  running, 3.3 GW due within 12 months; 1.7 GW of unbuilt solar awards sit
  with insolvent Enerparc (15 % of the solar backlog), 0.5 GW of wind with
  ABO. ABO is in out-of-court restructuring (bank standstill to 30 Nov
  2026), not insolvent, as of the sources found on 1 Nov 2026: re-check.
- WP71 `/grid`: new station 2 command `extract-grid` (grid operator, TSO
  control area and voltage per large unit; grid operator roles; 1,058 large
  consumers) → `grid/grid.json`. 6 grid operators connect half of large
  wind/solar/storage; 476 large consumers planned. Context (congestion costs,
  rules incl. Redispatchvorbehalt bill) in `config/grid_facts.yaml`.
- WP72 `/players`: 18 companies in `config/players.yaml` (sourced), joined
  with German auction results. Wind/Solar now titled "Germany's …".
- WP73a AI guide on `/open-data` and `/llms.txt`; plan in
  `docs/platform-plan.md`. Architecture map:
  https://claude.ai/artifact/XyzJEANiHVLTQojAnRPMUz

## In progress / resolved during this session

- **The wind analysis edit that didn't land:** a Python text replacement in
  `monitor.py` (around `population_reference`) silently didn't match, so
  `wind_industry` was missing from `build_stats` at first. It was fixed and
  verified: `stats.json` contains `wind_industry`, and a test covers it
  (`tests/test_monitor.py::test_wind_industry`). Lesson: make text
  replacements `assert` that the old text exists, or use the Edit tool.
- **The style issue:** ruff flagged formatting and long lines, and a totals
  helper was simplified. `ruff check` and `ruff format --check` now pass.
- **Resolved:** contract v1.5 approved and locked; `contract_version` is
  `"1.5"`. The website accepts 1.4 and 1.5 files (1.5 only adds files).
- **Resolved:** the MaStR daily run on `main` after the last merge
  succeeded (data as of 31 Oct 2026).

## Key decisions and why

- **Historical turbine brands keep their own place (Tacke, NEG Micon, Enron
  Wind, Bonus, …).** The race should show who actually built the turbines at
  the time. Folding Tacke into GE, or Bonus into Siemens Gamesa, would rewrite
  history and inflate today's makers. Only legal-entity variants and true
  renames are merged: REpower → Senvion; Siemens, Gamesa and Siemens Gamesa
  together. Rules: `pipeline/config/wind_brands.yaml`.
- **The maker size chart shows the 5 makers with most capacity since 2015.**
  It counts only years with at least 10 turbines and leaves out the running
  year. All-time rankings brought in Senvion, whose last thin years produced a
  fake drop to 0 m.
- **Bidders are grouped by company-name keywords** in
  `pipeline/config/auction_groups.yaml` (first match wins). Groups marked
  `bucket` (citizen wind farms, cooperatives, Stadtwerke without a group
  name, …) are shown as striped bars standing for many companies (v1.6;
  in v1.5 they were left out of the ranking).
- **Five bidder types (v1.6, your call):** Alterric counts as an IPP (it
  develops and finances like one); enercity as a Stadtwerk (Hannover's
  municipal utility); big utilities (RWE, EnBW, Vattenfall, Uniper, E.ON,
  EWE, …) separate from Stadtwerke. JUWI counts as a developer although MVV
  owns it.
- **Auction rounds start in May 2019:** earlier lists use old register
  numbers (A…) that our data cannot link to MaStR.
- **Yield model kept simple and transparent:** DWD grid (1981–2000 climate),
  generic power curve, 12 % losses, no curtailment. Good for comparing sites
  and rounds, not a yield report. EEG correction tables live in
  `config/wind_yield.yaml`; the 50 % step is applied only in BW, BY and SL as
  an approximation of the southern region.
- **Received value = round average award × project correction factor,**
  because single bids are not published.
- **The "why developers win" matrix is labelled editorial,** separate from
  the measured figures.
- **Bidder names without a company legal form are withheld** (privacy rule
  D4). GbR partnerships count as "Citizen & local".
- **Round prices are taken from the BNetzA round pages, not the award
  lists.** The lists can include later awards (court rulings), so they may
  differ from the published figures by up to 10%.
- **A failed auction fetch fails the daily run.** This follows the rule that a
  broken station must never reach the website. The trade-off: if BNetzA's
  site is down, the MaStR update is blocked too.
- **Earlier, still in force:** English only; public repo; free domain;
  pumped hydro counts as storage; secrets only in GitHub Secrets, never in
  chat or the repo.

## Known bugs and limits

1. **45% of awarded capacity (2019–2026) is "not attributed":** project
   companies such as "Windpark X GmbH & Co. KG" don't name their owner.
   Groups that bid this way look smaller than they are (UKA, for example).
   For the whole operating fleet it is 71%.
   Cross-check with company press releases (`docs/auction-crosscheck.md`):
   exact matches for groups bidding under their own name (RWE, PNE, ABO,
   EnBW); wpd, Qualitas and Alterric undercounted. "UGE … Umweltgerechte
   Energie" companies turned out to be UKA and are now merged. WP57 added
   `config/auction_reviewed.yaml` (hand assignments with sources, 20
   company-reported totals) and a comparison table on the site: 8 of 20
   reported totals match within 4 %; wpd sees ~50 % by name.
   WP58 office attribution (MaStR company register addresses, internal file
   `data/extract/operators.parquet`) cut "not attributed" to 30 % and brought
   13 of 20 reported totals within ~4 %. WP59 split the site: `/` energy
   transition, `/wind` wind & auctions (incl. WP60 auction map). WP61 turned
   `/wind` into a five-chapter storyline (`WindStory.tsx`) with takeaways and
   caveats computed from the data, an animated award map, a company map by
   year with profile, and a turbine-maker matrix per company.
2. **Award list totals differ from published totals** for Nov 2025 (+5%) and
   Aug 2025 (+1.4%). The check tolerates this up to ±10%.
3. **Nov 2025 `volume_kw` is null:** that page words the tender volume
   differently. Nothing uses it yet.
4. **Prices per company are impossible:** BNetzA does not publish single bid
   values.
5. **Expired Vercel CLI token** in `/root/.local/share/com.vercel.cli/auth.json`
   (the API answers "invalidToken"). Use GitHub commit statuses, or log in
   again.
6. **Merge conflicts in `web/public/data/` are likely:** the branch commits
   data files, and the daily run on `main` also commits them. Fix: on merge,
   take `main`'s data and re-run `aggregate`, or let the daily run
   regenerate it.
7. **Cosmetic issues:**
   - The dashed ceiling line in the price chart slopes between Nov 25 and
     Feb 26, because the ceiling changed from 7.35 to 7.25 ct.
   - Labels in the maker size chart are nudged apart only when they end in
     the same year.
8. **`auctions/awards.json` is about 3 MB** (34 rounds). Fine within the
   50 MB budget (total data 35 MB), but it could be trimmed.
9. **Yield estimates are model values:** median site quality ~93–96 % may be
   a little high, since tall hubs extrapolate the DWD 100 m wind with the
   80–100 m shear. Correction tables for EEG 2017/2021/2023 should be checked
   against the law text before anyone relies on single values.
10. **Realisation shares by type are close to 100 %** because only turbines
    still in MaStR are counted; projects that were dropped and deregistered
    are invisible.

## Open decisions (yours)

1. **OpenStreetMap ODbL** for the WP41 grid map. Recommendation: accept.
2. **Store the API keys in GitHub Secrets:** `ENTSOE_TOKEN`,
   `NETZTRANSPARENZ_CLIENT_ID` and `NETZTRANSPARENZ_CLIENT_SECRET`. Rotate the
   netztransparenz secret that was pasted in chat.

## Next steps

1. Check that the daily MaStR and hub runs after the v1.6 merge succeeded
   (they rewrite all files with contract 1.6, including `operators.parquet`
   and the auction files with the newest data).
2. WP45b: keep shrinking "not attributed" (30 %): review the largest
   unlabelled office addresses, add sourced entries to
   `pipeline/config/auction_reviewed.yaml`; optionally link 2017–Feb 2019
   rounds via the old register numbers (needs a new station 2 column).
3. WP41 grid map, once the OSM decision and the API keys are in place.
4. When a new auction round is published (Nov 2026: awards expected
   Jan 2027), add its id and path to `settings.yaml → auctions.onshore_rounds`
   and, if available, the company-reported totals to `auction_reviewed.yaml`.
