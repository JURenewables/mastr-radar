# Handover — 31 Oct 2026

Branch `claude/blissful-cannon-t3pa07`, last feature commit `c1ea5a5`.
Live site: https://mastr-radar.vercel.app (from `main`, contract v1.4).
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

**Contract v1.5 (approved 31 Oct 2026, going live with this merge)**
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
  name, …) count in the category totals but are never ranked as "winners".
- **JUWI counts as a developer even though MVV owns it; Alterric counts as a
  utility (EWE joint venture).** This is stated on the page.
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

1. **42% of awarded capacity is "not attributed":** project companies such as
   "Windpark X GmbH & Co. KG" don't name their owner. Groups that bid this way
   look smaller than they are (UKA, for example).
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
8. **`auctions/awards.json` is about 730 KB.** That is fine within the 50 MB
   budget, but it could be trimmed.

## Open decisions (yours)

1. **OpenStreetMap ODbL** for the WP41 grid map. Recommendation: accept.
2. **Store the API keys in GitHub Secrets:** `ENTSOE_TOKEN`,
   `NETZTRANSPARENZ_CLIENT_ID` and `NETZTRANSPARENZ_CLIENT_SECRET`. Rotate the
   netztransparenz secret that was pasted in chat.
3. **Better auction attribution (WP45b):** decide whether we maintain a
   reviewed list mapping project companies to parent groups.

## Next steps

1. Check that the daily MaStR and hub runs after the v1.5 merge succeeded
   (they rewrite all files with contract 1.5 and the newest data).
2. WP45b: shrink "not attributed". Map project companies to parent groups
   via MaStR operator data or a reviewed list, and add the 2017–2024 rounds.
3. WP41 grid map, once the OSM decision and the API keys are in place.
4. When a new auction round is published (Nov 2026: awards expected
   Jan 2027), add its id to `settings.yaml → auctions.onshore_rounds`.
