// Data catalogue (WP43): one description of every published dataset, used by
// /catalog.json (machines), /llms.txt (AI agents) and the /data page (people).
// Server only: reads the manifest and the hub index at build time.
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Manifest } from "./types";
import { SITE_URL } from "./site";

const DATA = path.join(process.cwd(), "public", "data");

const LICENCES = {
  mastr: { name: "Datenlizenz Deutschland – Namensnennung – Version 2.0", id: "DL-DE-BY-2.0", url: "https://www.govdata.de/dl-de/by-2-0" },
  bkg: { name: "Datenlizenz Deutschland – Namensnennung – Version 2.0", id: "DL-DE-BY-2.0", url: "https://www.govdata.de/dl-de/by-2-0" },
  bnetza: { name: "Datenlizenz Deutschland – Namensnennung", id: "DL-DE-BY", url: "https://www.govdata.de/dl-de/by-2-0" },
  ccby: { name: "Creative Commons Attribution 4.0", id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
} as const;

export interface Dataset {
  id: string;
  title: string;
  description: string;
  format: "parquet" | "json" | "geojson";
  url: string;
  rows?: number;
  bytes?: number;
  update: string;
  licence: { name: string; id: string; url: string };
  attribution: string;
}

export interface Catalog {
  name: string;
  description: string;
  site: string;
  contract: string;
  contract_url: string;
  as_of: string;
  generated_at: string;
  datasets: Dataset[];
  day_files: { first: string | null; last: string | null; count: number; url_template: string };
  how_to: Record<string, string>;
}

async function json<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(DATA, file), "utf8")) as T;
  } catch {
    return null;
  }
}

const MASTR_ATTR = "© Bundesnetzagentur, DL-DE-BY-2.0, Marktstammdatenregister; processed by MaStR Radar";

const BNETZA_ATTR = "Bundesnetzagentur, Ausschreibungen Wind an Land; MaStR © Bundesnetzagentur, DL-DE-BY-2.0; processed by MaStR Radar";

const DESCRIPTIONS: Record<string, Omit<Dataset, "id" | "url" | "rows" | "bytes" | "update">> = {
  "kpis.json": { title: "Headline numbers per technology", description: "Installed, planned and added-this-year capacity (kW) and unit counts per technology.", format: "json", licence: LICENCES.mastr, attribution: MASTR_ATTR },
  "units.parquet": { title: "Units of 100 kW and more", description: "Every solar, wind, storage, biomass and hydro unit of 100 kW or more: technology, status, capacity, dates, location (where public), operator (companies, from 1 MW).", format: "parquet", licence: LICENCES.mastr, attribution: MASTR_ATTR },
  "summary.parquet": { title: "Totals for all units", description: "Unit counts and capacity (kW) for all 9.6 million units by technology, status, size class, state, district and commissioning month.", format: "parquet", licence: LICENCES.mastr, attribution: MASTR_ATTR },
  "boundaries/states.geojson": { title: "State boundaries", description: "Generalised state outlines with key, name and area (km²).", format: "geojson", licence: LICENCES.bkg, attribution: "© GeoBasis-DE / BKG (2026)" },
  "boundaries/districts.geojson": { title: "District boundaries", description: "Generalised district outlines with key, name and area (km²).", format: "geojson", licence: LICENCES.bkg, attribution: "© GeoBasis-DE / BKG (2026)" },
  "monitor/buildout.json": { title: "Build-out per year", description: "Installed, added and retired capacity (MW) per year since 1990, nationally and per district, for every technology.", format: "json", licence: LICENCES.mastr, attribution: MASTR_ATTR },
  "monitor/points.json": { title: "Plants of 1 MW and more", description: "Coordinates, commissioning year, technology and capacity of plants in operation (public locations only), plus planned onshore wind turbines.", format: "json", licence: LICENCES.mastr, attribution: MASTR_ATTR },
  "monitor/stats.json": { title: "Monitor analyses", description: "2030 targets, year-to-date curves, solar by type, turbine sizes, battery storage, states (with area and population), top districts, repowering.", format: "json", licence: LICENCES.mastr, attribution: `${MASTR_ATTR}; population © GeoBasis-DE / BKG (2026)` },
  "auctions/onshore.json": { title: "Onshore wind auctions: rounds and winners", description: "Every onshore wind auction round since May 2019: ceiling, lowest, average and highest award value, estimated full-load hours, site quality, correction factor and received value; merit order per round; winners by company group and bidder type per year; operating capacity by group.", format: "json", licence: LICENCES.bnetza, attribution: BNETZA_ATTR },
  "auctions/solar.json": { title: "Solar and innovation auctions: rounds and winners", description: "Ground-mounted solar rounds since 2019 and innovation rounds (solar + battery): prices, ceiling, awarded capacity; since 2023 winners by company group, portfolios, batteries on site, trackers, special sites, estimated yield and companies active in wind and solar.", format: "json", licence: LICENCES.bnetza, attribution: BNETZA_ATTR },
  "auctions/solar_awards.json": { title: "Solar and innovation awards", description: "One row per solar or innovation award since 2023: round, bidder (companies only), company group and type, kW, state, district, link to MaStR, battery on site, tracker share, estimated yield, grid voltage.", format: "json", licence: LICENCES.bnetza, attribution: BNETZA_ATTR },
  "auctions/company_facts.json": { title: "Company facts: business models, finance, exits", description: "Hand-checked, sourced notes on the leading auction winners (develop-and-sell vs IPP, project vs corporate finance), retreats and insolvencies, and turbine makers' worldwide installations (GWEC). Every entry links its sources.", format: "json", licence: LICENCES.ccby, attribution: "MaStR Radar, compiled from the linked company and press sources" },
  "auctions/market_risk.json": { title: "Market risk: prices, backlog, exposure", description: "Per wind and solar round: ceiling, average award, awarded and running capacity, unbuilt capacity and (wind) the 36-month deadline; unbuilt awards held by companies in insolvency or restructuring; submitted bids vs volume from BNetzA press releases.", format: "json", licence: LICENCES.bnetza, attribution: BNETZA_ATTR },
  "auctions/players.json": { title: "Players worldwide", description: "Utilities, IPPs, investors and developers active in Germany's wind and solar auctions: staff, revenue, EBITDA, net debt, capacity, markets abroad, generation mix, momentum with reasons, and their German awards and fleet. Every company carries source links.", format: "json", licence: LICENCES.ccby, attribution: "MaStR Radar, compiled from the linked company reports; German figures © Bundesnetzagentur" },
  "grid/grid.json": { title: "Grid: operators, control areas, demand, congestion", description: "Large wind, solar and storage capacity by grid operator, TSO control area and voltage level; dominant control area and capacity per district; large electricity consumers (operating and planned) with locations; congestion costs, curtailment facts and connection rules with sources.", format: "json", licence: LICENCES.mastr, attribution: `${MASTR_ATTR}; context facts from the linked sources` },
  "auctions/awards.json": { title: "Onshore wind awards", description: "One row per award since May 2019: round, bidder (companies only), company group and type, kW, state, turbines in MaStR and in operation, maker, model, hub height, rotor, estimated wind, full-load hours, site quality, correction factor and received value.", format: "json", licence: LICENCES.bnetza, attribution: BNETZA_ATTR },
};

export async function buildCatalog(): Promise<Catalog> {
  const manifest = await json<Manifest>("manifest.json");
  const days = await json<{ first: string | null; last: string | null; dates: string[] }>("days/index.json");
  const files = manifest?.files ?? [];
  const datasets: Dataset[] = files
    .filter((f) => DESCRIPTIONS[f.name])
    .map((f) => ({
      id: f.name.replace(/[/.]/g, "-"),
      url: `${SITE_URL}/data/${f.name}`,
      rows: f.rows,
      bytes: f.bytes,
      update: "daily",
      ...DESCRIPTIONS[f.name],
    }));
  datasets.push(
    {
      id: "days-index",
      title: "Day files: index",
      description: "List of available day files (last 12 months).",
      format: "json",
      url: `${SITE_URL}/data/days/index.json`,
      update: "daily",
      licence: LICENCES.ccby,
      attribution: "Bundesnetzagentur | SMARD.de; Deutscher Wetterdienst",
    },
    {
      id: "days-stations",
      title: "Weather stations",
      description: "DWD station ids, coordinates and names used in the day files.",
      format: "json",
      url: `${SITE_URL}/data/days/stations.json`,
      update: "daily",
      licence: LICENCES.ccby,
      attribution: "Deutscher Wetterdienst",
    },
  );
  return {
    name: "MaStR Radar data",
    description:
      "Open data on Germany's renewable energy units (Marktstammdatenregister), with quarter-hourly generation and demand (SMARD) and weather (DWD), cleaned, checked and updated daily.",
    site: SITE_URL,
    contract: manifest?.contract_version ?? "unknown",
    contract_url: "https://github.com/JURenewables/mastr-radar/blob/main/docs/contracts.md",
    as_of: manifest?.as_of ?? "unknown",
    generated_at: manifest?.generated_at ?? "unknown",
    datasets,
    day_files: {
      first: days?.first ?? null,
      last: days?.last ?? null,
      count: days?.dates.length ?? 0,
      url_template: `${SITE_URL}/data/days/{YYYY-MM-DD}.json`,
    },
    how_to: {
      python: `import pandas as pd\nunits = pd.read_parquet("${SITE_URL}/data/units.parquet")`,
      duckdb: `SELECT technology, sum(capacity_kw)/1e6 AS gw FROM '${SITE_URL}/data/summary.parquet' WHERE status = 'operating' GROUP BY 1;`,
      curl: `curl ${SITE_URL}/data/days/${days?.last ?? "2026-10-30"}.json`,
    },
  };
}
