// MCP tools v2 (contract v1.10, WP81): typed tools for the common questions,
// so agents need no SQL. Every input is validated and quoted before it
// reaches the read-only query engine.
import { readFileSync } from "node:fs";
import path from "node:path";

import { DATA_DIR, runSelect } from "./engine";

export class InputError extends Error {}

const TECH = ["solar", "wind_onshore", "wind_offshore", "storage", "biomass", "hydro"] as const;
const STATUS = ["operating", "planned", "temporarily_shut_down", "permanently_shut_down"] as const;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v: unknown, name: string, lo: number, hi: number): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new InputError(`'${name}' must be a number between ${lo} and ${hi}.`);
  return n;
};
const str = (v: unknown, name: string, max = 120): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > max) throw new InputError(`'${name}' must be text of at most ${max} characters.`);
  return v.trim();
};

interface Region { key: string; name: string; km2: number; level: "state" | "district" }
let regions: Region[] | null = null;
function allRegions(): Region[] {
  if (regions) return regions;
  const read = (f: string, level: Region["level"]) =>
    (JSON.parse(readFileSync(path.join(DATA_DIR, "boundaries", f), "utf8")) as GeoJSON.FeatureCollection).features.map((x) => ({
      key: String(x.properties?.key),
      name: String(x.properties?.name),
      km2: Number(x.properties?.area_km2) || 0,
      level,
    }));
  regions = [...read("states.geojson", "state"), ...read("districts.geojson", "district")];
  return regions;
}
function region(name: string, level: Region["level"]): Region {
  const n = name.toLowerCase();
  const all = allRegions().filter((r) => r.level === level);
  const hit = all.find((r) => r.name.toLowerCase() === n) ?? all.filter((r) => r.name.toLowerCase().includes(n))[0];
  if (!hit) throw new InputError(`No ${level} named '${name}'. Use the German name, e.g. ${level === "state" ? "'Niedersachsen'" : "'Nordfriesland'"}.`);
  return hit;
}

export interface Result { files: string[]; data: unknown; caveats?: string[] }

export const TOOLS_V2 = [
  {
    name: "find_units",
    title: "Find units",
    description:
      "Find generation and storage units (100 kW and more, with name, capacity, dates, location and operator where public) by technology, status, region, size and commissioning period, plus totals. Totals for all sizes, including small rooftop units, come from the summary table. Example: wind and solar units commissioned in March 2026.",
    inputSchema: {
      type: "object",
      properties: {
        technology: { type: "array", items: { type: "string", enum: TECH }, description: "One or more technologies (default: all)." },
        status: { type: "string", enum: STATUS },
        state: { type: "string", description: "German state name, e.g. 'Bayern'." },
        district: { type: "string", description: "District (Kreis) name, e.g. 'Nordfriesland'." },
        min_mw: { type: "number", minimum: 0 },
        max_mw: { type: "number", minimum: 0 },
        commissioned_from: { type: "string", format: "date", description: "YYYY-MM-DD" },
        commissioned_to: { type: "string", format: "date", description: "YYYY-MM-DD" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "auction_round",
    title: "Auction round",
    description: "Results of one German auction round: volume, bids, awards, lowest/average/highest award price, ceiling, awarded capacity. Technology wind (onshore), solar (ground-mounted, first segment) or innovation.",
    inputSchema: {
      type: "object",
      properties: {
        technology: { type: "string", enum: ["wind", "solar", "innovation"] },
        bid_date: { type: "string", format: "date", description: "Bid date YYYY-MM-DD (default: latest round)." },
      },
      required: ["technology"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "auction_winners",
    title: "Auction winners",
    description: "Awards of an auction round (or all rounds of a company group): bidder group, type, capacity, state, and for wind the turbine and estimated yield.",
    inputSchema: {
      type: "object",
      properties: {
        technology: { type: "string", enum: ["wind", "solar", "innovation"] },
        bid_date: { type: "string", format: "date", description: "Bid date YYYY-MM-DD (default: latest round unless 'group' is given)." },
        group: { type: "string", description: "Company group, matched case-insensitively (e.g. 'RWE')." },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
      },
      required: ["technology"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "company_profile",
    title: "Company profile",
    description: "A company or group: auction awards by year and technology, capacity it operates in the register (units of 1 MW or more, legal entities), the players profile (staff, earnings, debt, markets) and hand-checked facts where listed. Names are matched as text, so check that the matches are the company you mean.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Company or group name, e.g. 'Enercon', 'RWE', 'Energiekontor'." } },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "region_profile",
    title: "Region profile",
    description: "A German state or district: capacity in operation and planned per technology (all sizes), added in the last 12 months, capacity per km².",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", description: "German state name, e.g. 'Schleswig-Holstein'." },
        district: { type: "string", description: "District name, e.g. 'Dithmarschen'." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "grid_redispatch",
    title: "Grid redispatch",
    description: "Monthly redispatch by the German transmission system operators (energy reduced and increased, renewables curtailed, countertrading) and the substations where renewables were curtailed most in the last 12 months. Aggregates only.",
    inputSchema: {
      type: "object",
      properties: { months: { type: "integer", minimum: 1, maximum: 60, default: 24 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "cross_border_flows",
    title: "Cross-border flows",
    description: "Physical electricity flows between Germany-Luxembourg and its neighbours: monthly net import per neighbour (GWh) and imports/exports over the last 12 months.",
    inputSchema: {
      type: "object",
      properties: { neighbour: { type: "string", description: "Bidding zone code, e.g. FR, NL, DK1, PL (default: all)." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "whats_new",
    title: "What's new",
    description: "Units of 100 kW and more registered in the Marktstammdatenregister since a date: totals per technology and status, and the largest new registrations.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", format: "date", description: "YYYY-MM-DD" },
        technology: { type: "string", enum: TECH },
      },
      required: ["since"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
] as const;

export const V2_NAMES = new Set<string>(TOOLS_V2.map((t) => t.name));

const sel = async (sql: string, max = 500) => (await runSelect(sql, max)).rows;

export async function callV2(name: string, a: Record<string, unknown>, asOf: string): Promise<Result> {
  switch (name) {
    case "find_units": {
      const techs = a.technology === undefined ? [] : Array.isArray(a.technology) ? a.technology : [a.technology];
      for (const t of techs) if (!TECH.includes(t as (typeof TECH)[number])) throw new InputError(`Unknown technology '${String(t)}'.`);
      const status = str(a.status, "status");
      if (status && !STATUS.includes(status as (typeof STATUS)[number])) throw new InputError(`Unknown status '${status}'.`);
      const st = str(a.state, "state");
      const di = str(a.district, "district");
      const sr = st ? region(st, "state") : undefined;
      const dr = di ? region(di, "district") : undefined;
      const minMw = num(a.min_mw, "min_mw", 0, 10000);
      const maxMw = num(a.max_mw, "max_mw", 0, 10000);
      for (const k of ["commissioned_from", "commissioned_to"]) if (a[k] !== undefined && !isDate(a[k])) throw new InputError(`'${k}' must be YYYY-MM-DD.`);
      const from = a.commissioned_from as string | undefined;
      const to = a.commissioned_to as string | undefined;
      const limit = num(a.limit, "limit", 1, 500) ?? 50;
      const w: string[] = [];
      const ws: string[] = [];
      if (techs.length) {
        const list = techs.map((t) => lit(String(t))).join(",");
        w.push(`technology IN (${list})`);
        ws.push(`technology IN (${list})`);
      }
      if (status) {
        w.push(`status = ${lit(status)}`);
        ws.push(`status = ${lit(status)}`);
      }
      if (sr) {
        w.push(`state_key = ${lit(sr.key)}`);
        ws.push(`state_key = ${lit(sr.key)}`);
      }
      if (dr) {
        w.push(`district_key = ${lit(dr.key)}`);
        ws.push(`district_key = ${lit(dr.key)}`);
      }
      if (minMw !== undefined) w.push(`capacity_kw >= ${minMw * 1000}`);
      if (maxMw !== undefined) w.push(`capacity_kw <= ${maxMw * 1000}`);
      if (from) {
        w.push(`commissioning_date >= DATE ${lit(from)}`);
        ws.push(`commissioning_month >= ${lit(from.slice(0, 7))}`);
      }
      if (to) {
        w.push(`commissioning_date <= DATE ${lit(to)}`);
        ws.push(`commissioning_month <= ${lit(to.slice(0, 7))}`);
      }
      const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
      const whereS = ws.length ? `WHERE ${ws.join(" AND ")}` : "";
      const units = await sel(
        `SELECT unit_id, name, technology, status, round(capacity_kw/1000, 3) AS mw, commissioning_date, planned_commissioning_date, state, district, municipality, lat, lon, operator_name, manufacturer, turbine_model, hub_height_m, storage_capacity_kwh FROM units ${where} ORDER BY capacity_kw DESC LIMIT ${limit}`,
      );
      const totals = await sel(`SELECT technology, state, count(*) AS units, round(sum(capacity_kw)/1000, 1) AS mw FROM units ${where} GROUP BY 1, 2 ORDER BY mw DESC`);
      const all = minMw || maxMw ? null : await sel(`SELECT technology, sum(unit_count) AS units, round(sum(capacity_kw)/1000, 1) AS mw FROM summary ${whereS} GROUP BY 1 ORDER BY mw DESC`);
      return {
        files: ["units.parquet", "summary.parquet"],
        data: { filters: { technology: techs, status, state: sr?.name, district: dr?.name, min_mw: minMw, max_mw: maxMw, commissioned_from: from, commissioned_to: to }, units, totals_units_100kw_plus: totals, totals_all_sizes: all },
        caveats: ["The unit list covers units of 100 kW and more; totals_all_sizes (from the summary table, by commissioning month) includes small units.", ...(minMw || maxMw ? ["Size filters apply to the unit list only, so totals_all_sizes is left out."] : [])],
      };
    }

    case "auction_round": {
      const tech = str(a.technology, "technology");
      if (!tech || !["wind", "solar", "innovation"].includes(tech)) throw new InputError("'technology' must be wind, solar or innovation.");
      if (a.bid_date !== undefined && !isDate(a.bid_date)) throw new InputError("'bid_date' must be YYYY-MM-DD.");
      const view = tech === "wind" ? "wind_rounds" : "solar_rounds";
      const filt = tech === "wind" ? "TRUE" : `programme = ${lit(tech)}`;
      const when = a.bid_date ? `bid_date = ${lit(a.bid_date as string)}` : `bid_date = (SELECT max(bid_date) FROM ${view} WHERE ${filt})`;
      const cols = tech === "wind"
        ? "id, bid_date, published, ceiling_ct, volume_kw, min_ct, avg_ct, max_ct, awards, awarded_kw, full_load_hours_avg, quality_pct_avg, correction_factor_avg, received_ct_est, kw_by_category"
        : "id, programme, bid_date, published, ceiling_ct, volume_kw, min_ct, avg_ct, max_ct, awards, awarded_kw, kw_by_category, co_located_share, tracker_share, specific_yield_avg";
      const rows = await sel(`SELECT ${cols} FROM ${view} WHERE ${filt} AND ${when}`, 5);
      if (!rows.length) {
        const dates = await sel(`SELECT bid_date FROM ${view} WHERE ${filt} ORDER BY bid_date DESC LIMIT 12`, 12);
        throw new InputError(`No ${tech} round on ${String(a.bid_date)}. Recent bid dates: ${dates.map((d) => d.bid_date).join(", ")}.`);
      }
      return { files: [tech === "wind" ? "auctions/onshore.json" : "auctions/solar.json"], data: rows[0], caveats: ["Prices in ct/kWh; capacity in kW. received_ct_est (wind) is the average award after the EEG site correction factor, estimated."] };
    }

    case "auction_winners": {
      const tech = str(a.technology, "technology");
      if (!tech || !["wind", "solar", "innovation"].includes(tech)) throw new InputError("'technology' must be wind, solar or innovation.");
      if (a.bid_date !== undefined && !isDate(a.bid_date)) throw new InputError("'bid_date' must be YYYY-MM-DD.");
      const group = str(a.group, "group");
      const limit = num(a.limit, "limit", 1, 500) ?? 100;
      const view = tech === "wind" ? "wind_awards" : "solar_awards";
      const w = [tech === "wind" ? "TRUE" : `programme = ${lit(tech)}`];
      if (a.bid_date) w.push(`bid_date = ${lit(a.bid_date as string)}`);
      else if (!group) w.push(`bid_date = (SELECT max(bid_date) FROM ${view} WHERE ${w[0]})`);
      if (group) w.push(`("group" ILIKE ${lit(`%${group}%`)} OR bidder ILIKE ${lit(`%${group}%`)})`);
      const cols = tech === "wind"
        ? `bid_date, bidder, "group", category, kw, state, turbines, maker, model, hub_height_m, full_load_hours, received_ct_est, kw_operating`
        : `programme, bid_date, bidder, "group", category, kw, state, district, specific_yield_kwh_kwp, co_located, kw_operating`;
      const rows = await sel(`SELECT ${cols} FROM ${view} WHERE ${w.join(" AND ")} ORDER BY bid_date DESC, kw DESC LIMIT ${limit}`);
      const sum = await sel(`SELECT count(*) AS awards, round(sum(kw)/1000, 1) AS mw FROM ${view} WHERE ${w.join(" AND ")}`, 1);
      return { files: [tech === "wind" ? "auctions/awards.json" : "auctions/solar_awards.json"], data: { total: sum[0], awards: rows }, caveats: ["Bidder groups are attributed by MaStR Radar from the award lists and the register; 'unattributed' means the owner behind the project company is unknown."] };
    }

    case "company_profile": {
      const name = str(a.name, "name", 80);
      if (!name || name.length < 2) throw new InputError("Give a company name of at least 2 characters.");
      const like = lit(`%${name}%`);
      const wind = await sel(`SELECT year(CAST(bid_date AS DATE)) AS year, count(*) AS awards, round(sum(kw)/1000, 1) AS mw FROM wind_awards WHERE "group" ILIKE ${like} OR bidder ILIKE ${like} GROUP BY 1 ORDER BY 1`);
      const solar = await sel(`SELECT programme, year(CAST(bid_date AS DATE)) AS year, count(*) AS awards, round(sum(kw)/1000, 1) AS mw FROM solar_awards WHERE "group" ILIKE ${like} OR bidder ILIKE ${like} GROUP BY 1, 2 ORDER BY 2, 1`);
      const units = await sel(`SELECT technology, status, count(*) AS units, round(sum(capacity_kw)/1000, 1) AS mw FROM units WHERE operator_name ILIKE ${like} AND capacity_kw >= 1000 GROUP BY 1, 2 ORDER BY mw DESC`);
      const operators = await sel(`SELECT operator_name, round(sum(capacity_kw)/1000, 1) AS mw FROM units WHERE operator_name ILIKE ${like} AND capacity_kw >= 1000 GROUP BY 1 ORDER BY mw DESC LIMIT 15`);
      const players = await sel(`SELECT name, "group", type, hq, owner, year, employees, currency, revenue, ebitda, net_debt, capacity_gw, markets, momentum, why, sources FROM players WHERE name ILIKE ${like} OR "group" ILIKE ${like} LIMIT 3`, 3);
      const facts = (JSON.parse(readFileSync(path.join(DATA_DIR, "auctions", "company_facts.json"), "utf8")).companies as { group: string }[]).filter((c) => c.group.toLowerCase().includes(name.toLowerCase()));
      if (!wind.length && !solar.length && !units.length && !players.length && !facts.length) throw new InputError(`Nothing found for '${name}'. Try the group name as it appears in the award lists (e.g. 'RWE', 'EnBW').`);
      return {
        files: ["auctions/awards.json", "auctions/solar_awards.json", "units.parquet", "auctions/players.json", "auctions/company_facts.json"],
        data: { query: name, wind_awards_by_year: wind, solar_awards_by_year: solar, operated_capacity_1mw_plus: units, matched_operators: operators, players, facts },
        caveats: ["Matched by text: check matched_operators, which can include unrelated companies with similar names. Units operated by project companies under another name are not counted."],
      };
    }

    case "region_profile": {
      const st = str(a.state, "state");
      const di = str(a.district, "district");
      if (!st === !di) throw new InputError("Give either 'state' or 'district'.");
      const r = st ? region(st, "state") : region(di!, "district");
      const col = r.level === "state" ? "state_key" : "district_key";
      const y = Number(asOf.slice(0, 4));
      const since = `${y - 1}-${asOf.slice(5, 7)}`;
      const cap = await sel(`SELECT technology, status, sum(unit_count) AS units, round(sum(capacity_kw)/1000, 1) AS mw FROM summary WHERE ${col} = ${lit(r.key)} AND status IN ('operating', 'planned') GROUP BY 1, 2 ORDER BY mw DESC`);
      const added = await sel(`SELECT technology, sum(unit_count) AS units, round(sum(capacity_kw)/1000, 1) AS mw FROM summary WHERE ${col} = ${lit(r.key)} AND status = 'operating' AND commissioning_month > ${lit(since)} GROUP BY 1 ORDER BY mw DESC`);
      const op = cap.filter((c) => c.status === "operating").reduce((s, c) => s + Number(c.mw), 0);
      return {
        files: ["summary.parquet", `boundaries/${r.level === "state" ? "states" : "districts"}.geojson`],
        data: { region: r.name, level: r.level, key: r.key, area_km2: r.km2, capacity: cap, added_last_12_months: added, operating_mw_per_km2: r.km2 ? Math.round((op / r.km2) * 1000) / 1000 : null },
        caveats: [`'Last 12 months' = commissioning months after ${since}; the most recent months are incomplete because of late registrations.`],
      };
    }

    case "grid_redispatch": {
      const months = num(a.months, "months", 1, 60) ?? 24;
      const monthly = await sel(`SELECT * FROM (SELECT month, countertrade_mwh, down_mwh, up_mwh FROM redispatch_monthly ORDER BY month DESC LIMIT ${months}) ORDER BY month`, 60);
      const top = await sel(`SELECT s.asset, s.tso, s.mwh, s.measures FROM (SELECT unnest(last_12m.renewable_substations) AS s FROM grid_redispatch) ORDER BY s.mwh DESC LIMIT 10`, 10);
      return { files: ["grid/redispatch.json"], data: { monthly, renewable_curtailment_top_substations_last_12m: top }, caveats: ["Transmission system operators only (Netztransparenz); measures by distribution grid operators are not included. Aggregates only, MWh."] };
    }

    case "cross_border_flows": {
      const nb = str(a.neighbour, "neighbour", 8)?.toUpperCase();
      const f = JSON.parse(readFileSync(path.join(DATA_DIR, "grid", "flows.json"), "utf8")) as { neighbours: string[]; monthly_net_import_gwh: Record<string, Record<string, number>>; last_12m: Record<string, unknown> };
      if (nb && !f.neighbours.includes(nb)) throw new InputError(`Unknown neighbour '${nb}'. Known: ${f.neighbours.join(", ")}.`);
      const monthly = Object.entries(f.monthly_net_import_gwh).map(([m, v]) => (nb ? { month: m, net_import_gwh: v[nb] } : { month: m, ...v }));
      return { files: ["grid/flows.json"], data: { neighbour: nb ?? "all", monthly_net_import_gwh: monthly, last_12m: nb ? { [nb]: f.last_12m[nb] } : f.last_12m }, caveats: ["Physical flows (ENTSO-E); positive = import into Germany-Luxembourg."] };
    }

    case "whats_new": {
      if (!isDate(a.since)) throw new InputError("'since' must be YYYY-MM-DD.");
      const tech = str(a.technology, "technology");
      if (tech && !TECH.includes(tech as (typeof TECH)[number])) throw new InputError(`Unknown technology '${tech}'.`);
      const w = [`registration_date >= DATE ${lit(a.since as string)}`, ...(tech ? [`technology = ${lit(tech)}`] : [])].join(" AND ");
      const totals = await sel(`SELECT technology, status, count(*) AS units, round(sum(capacity_kw)/1000, 1) AS mw FROM units WHERE ${w} GROUP BY 1, 2 ORDER BY mw DESC`);
      const largest = await sel(`SELECT name, technology, status, round(capacity_kw/1000, 2) AS mw, registration_date, commissioning_date, planned_commissioning_date, state, district, operator_name FROM units WHERE ${w} ORDER BY capacity_kw DESC LIMIT 25`, 25);
      return { files: ["units.parquet"], data: { since: a.since, totals, largest }, caveats: ["Units of 100 kW and more, by the date they were registered; registrations can come weeks after commissioning, and planned units can be withdrawn."] };
    }
  }
  throw new InputError(`Unknown tool '${name}'.`);
}
