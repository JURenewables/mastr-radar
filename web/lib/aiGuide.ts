// Guide for AI agents and analysts: which file answers which question, and how to
// reach the primary sources yourself. Used by /llms.txt and the open-data page.

export const QUESTIONS: { q: string; files: string[]; how: string }[] = [
  { q: "Which wind and solar units went online in a given month or year, and where?", files: ["units.parquet", "summary.parquet"], how: "Filter units.parquet (≥ 100 kW, with coordinates for companies) on commissioning_date and technology; summary.parquet for totals including small units." },
  { q: "How much capacity was added per year, and how far is the 2030 target?", files: ["monitor/buildout.json", "monitor/stats.json"], how: "buildout.json has added/retired/installed MW per year and district; stats.json has targets and year-to-date curves." },
  { q: "Who wins onshore wind auctions, at what price, on which sites?", files: ["auctions/onshore.json", "auctions/awards.json"], how: "onshore.json: rounds, winners by year, race, dynamics, success drivers; awards.json: one row per award with group, turbines, site quality and estimated received value." },
  { q: "Who wins ground-mounted solar auctions, with batteries or trackers?", files: ["auctions/solar.json", "auctions/solar_awards.json"], how: "solar.json: rounds, winners, portfolios, battery share; solar_awards.json: one row per award." },
  { q: "Which companies are rising, fading, new or dropped out?", files: ["auctions/onshore.json", "auctions/solar.json"], how: "Use the `dynamics` block: share early vs late, rounds with an award, swing, status." },
  { q: "How do the players compare worldwide (staff, EBITDA, debt, markets, mix)?", files: ["auctions/players.json", "auctions/company_facts.json"], how: "players.json: one record per company with sources and German results; company_facts.json: business model, financing, exits, turbine makers worldwide." },
  { q: "Is the market overheating? What is awarded but not built?", files: ["auctions/market_risk.json"], how: "Per round: average award vs ceiling, awarded vs running capacity, wind deadline; exposure of companies in trouble; submitted bids vs volume." },
  { q: "Which grid operators and TSO areas carry the renewables? Where is big demand?", files: ["grid/grid.json"], how: "Operators (top 25, concentration), control areas, voltage levels, district map data, large consumers with locations, congestion costs and rules with sources." },
  { q: "How did generation and demand look on a given day?", files: ["days/YYYY-MM-DD.json"], how: "Quarter-hourly generation per technology and demand for Germany and the four TSO areas (SMARD), plus DWD station weather." },
];

export const SOURCES: { name: string; what: string; access: string; licence: string; url: string; key: boolean }[] = [
  { name: "Marktstammdatenregister (BNetzA)", what: "Every generation unit, storage, large consumer, grid connection point, grid operator", access: "Daily bulk export (zip of XML, ~3 GB): https://www.marktstammdatenregister.de/MaStR/Datendownload. No account. Our station 1–2 code reads it with a streaming parser.", licence: "DL-DE-BY-2.0", url: "https://www.marktstammdatenregister.de/MaStR/Datendownload", key: false },
  { name: "SMARD (BNetzA)", what: "Generation, demand, prices by quarter hour for Germany and TSO areas", access: "Public JSON API without key: https://www.smard.de/app/chart_data/{filter}/{region}/index_quarterhour.json", licence: "CC BY 4.0", url: "https://www.smard.de/home/downloadcenter/download-marktdaten", key: false },
  { name: "BNetzA auctions", what: "Round results and award lists for wind, solar, innovation tenders", access: "Round pages and xlsx award lists under bundesnetzagentur.de/…/Ausschreibungen; submitted bid volumes are only in the press releases.", licence: "DL-DE-BY (lists)", url: "https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Ausschreibungen/start.html", key: false },
  { name: "Netztransparenz.de (TSOs)", what: "EEG plant master data and payments, redispatch measures by grid element, curtailment, market values", access: "REST API with OAuth2 client credentials (free registration at the extranet). Store client id and secret as secrets, never in code or chat.", licence: "Terms of the TSOs", url: "https://www.netztransparenz.de/de-de/Web-API", key: true },
  { name: "ENTSO-E Transparency Platform", what: "Load, generation, cross-border flows, prices, outages per hour for Europe", access: "REST API with a personal security token (request by e-mail after registering).", licence: "ENTSO-E terms (reuse allowed with attribution)", url: "https://transparency.entsoe.eu/", key: true },
  { name: "Deutscher Wetterdienst (DWD)", what: "Wind and radiation grids, station observations", access: "Open file server https://opendata.dwd.de, no key.", licence: "CC BY 4.0", url: "https://opendata.dwd.de/", key: false },
  { name: "BKG", what: "State and district boundaries", access: "Download from gdz.bkg.bund.de, no key.", licence: "DL-DE-BY-2.0", url: "https://gdz.bkg.bund.de/", key: false },
];

export const AI_PROMPT =
  "Use the MaStR Radar open data at https://mastr-radar.vercel.app. Start by reading /llms.txt, then /catalog.json. Answer from the files listed there (Parquet can be queried with DuckDB over HTTP), cite the file and the as-of date, and mention the known gaps (late registrations, private units without location).";
