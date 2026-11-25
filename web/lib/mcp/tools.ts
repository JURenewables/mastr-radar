// MCP tools v1 (contract v1.10, WP80): list_datasets, describe_dataset,
// run_sql, get_kpis. Every result carries as_of, source, licence and caveats.
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Dictionary, DictDataset } from "../dictionary";
import { SITE_URL } from "../site";
import { DATA_DIR, LIMITS, QueryError, engine, runSelect, viewName, type Manifest, type View } from "./engine";
import { InputError, TOOLS_V2, V2_NAMES, callV2 } from "./tools2";

export type ErrorCode = "bad_input" | "not_found" | "query_rejected" | "query_timeout" | "too_many_rows" | "rate_limited" | "internal";

export class ToolError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

let dictCache: Dictionary | null = null;
export function dictionary(): Dictionary {
  dictCache ??= JSON.parse(readFileSync(path.join(DATA_DIR, "dictionary.json"), "utf8")) as Dictionary;
  return dictCache;
}

const entryFor = (file: string): DictDataset | undefined => dictionary().datasets.find((e) => e.file === file);

/** Starter queries rewritten to use the view names instead of file paths. */
export function viewSql(sql: string): string {
  return sql.replace(/(?:read_parquet|read_json_auto)\('\{data\}([^']+)'\)|'\{data\}([^']+)'/g, (_m, a, b) => viewName(a ?? b));
}

export interface Envelope {
  as_of: string;
  contract_version: string;
  source: string[];
  licence: string[];
  caveats: string[];
  data: unknown;
}

const MASTR_FILES = new Set(["units.parquet", "summary.parquet", "kpis.json"]);

function envelope(m: Manifest, files: string[], data: unknown, extra: string[] = []): Envelope {
  const d = dictionary();
  const uniq = [...new Set(files)];
  const licences = new Set<string>();
  const caveats: string[] = [];
  for (const f of uniq) {
    const e = entryFor(f);
    if (!e) continue;
    const l = d.licences[e.licence];
    if (l) licences.add(`${l.attribution} (${l.url})`);
    caveats.push(...(e.caveats ?? []));
  }
  if (uniq.some((f) => MASTR_FILES.has(f)) && m.incomplete_after) {
    const inc = Object.entries(m.incomplete_after).map(([t, day]) => `${t} after ${day}`).join(", ");
    caveats.push(`Late registrations: commissioning months after these dates are still incomplete: ${inc}.`);
  }
  return {
    as_of: m.as_of,
    contract_version: m.contract_version,
    source: uniq.map((f) => `${SITE_URL}/data/${f}`),
    licence: [...licences],
    caveats: [...new Set([...caveats, ...extra])],
    data,
  };
}

/** Files a SQL text refers to, by view name or path. */
function filesIn(sql: string, views: View[]): string[] {
  const low = sql.toLowerCase();
  return views.filter((v) => new RegExp(`\\b${v.name}\\b`).test(low) || low.includes(v.file)).map((v) => v.file);
}

// ---------- tool definitions (names and input schemas are the contract) ----------

const TOOLS_V1 = [
  {
    name: "list_datasets",
    title: "List datasets",
    description:
      "List every MaStR Radar dataset (German renewables register, auctions, grid) with its SQL view name, file, grain, row count and licence. Start here, then use describe_dataset and run_sql.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "describe_dataset",
    title: "Describe a dataset",
    description:
      "Fields (type, unit, meaning), caveats, example questions and sample rows of one dataset. Accepts the view name (e.g. 'units', 'wind_awards') or the file name (e.g. 'auctions/awards.json').",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "View name or file name from list_datasets." } },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "run_sql",
    title: "Run a read-only SQL query",
    description:
      `Run one read-only DuckDB SELECT (or WITH … SELECT) over the dataset views (e.g. units, summary, kpis, wind_awards, solar_awards, wind_rounds, solar_rounds, players, redispatch_monthly; document views such as auctions_onshore hold one row with nested fields: use unnest). Capacity is in kW (divide by 1,000 for MW). At most ${LIMITS.maxRows} rows, ${LIMITS.timeoutMs / 1000} s. Units below 100 kW exist only as totals in 'summary'.`,
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: `One SELECT statement, at most ${LIMITS.sqlChars} characters.` },
        max_rows: { type: "integer", minimum: 1, maximum: LIMITS.maxRows, default: LIMITS.defaultRows },
      },
      required: ["sql"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_kpis",
    title: "Headline numbers",
    description:
      "Installed and planned capacity, number of units and capacity added this year, per technology (solar, wind_onshore, wind_offshore, storage, biomass, hydro), from the Marktstammdatenregister.",
    inputSchema: {
      type: "object",
      properties: {
        technology: {
          type: "string",
          enum: ["solar", "wind_onshore", "wind_offshore", "storage", "biomass", "hydro"],
          description: "Optional: one technology only.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
] as const;

export const TOOLS = [...TOOLS_V1, ...TOOLS_V2];

type Args = Record<string, unknown>;

export async function callTool(name: string, args: Args): Promise<Envelope> {
  const { views, manifest: m } = await engine();
  const rows = new Map(m.files.map((f) => [f.name, f.rows]));

  if (V2_NAMES.has(name)) {
    try {
      const r = await callV2(name, args, m.as_of);
      return envelope(m, r.files, r.data, r.caveats);
    } catch (e) {
      if (e instanceof InputError) throw new ToolError(/^No |^Nothing /.test(e.message) ? "not_found" : "bad_input", e.message);
      if (e instanceof QueryError) throw new ToolError(e.code, e.message);
      throw e;
    }
  }

  switch (name) {
    case "list_datasets": {
      const data = views.map((v) => {
        const e = entryFor(v.file);
        return {
          view: v.name,
          file: v.file,
          kind: v.kind,
          ...(v.list ? { from_list: v.list } : {}),
          title: e?.title ?? v.file,
          grain: v.list ? `one row per item of '${v.list}' in ${v.file}` : e?.grain,
          rows: v.list ? undefined : rows.get(v.file),
          licence: e ? dictionary().licences[e.licence]?.id : undefined,
        };
      });
      return envelope(m, [], { datasets: data, conventions: dictionary().conventions });
    }

    case "describe_dataset": {
      const want = String(args.name ?? "").trim();
      if (!want) throw new ToolError("bad_input", "Give a dataset 'name' (view or file), see list_datasets.");
      const v = views.find((x) => x.name === want || x.file === want) ?? views.find((x) => x.name === viewName(want));
      if (!v) throw new ToolError("not_found", `No dataset '${want}'. Known views: ${views.map((x) => x.name).join(", ")}.`);
      const e = entryFor(v.file);
      const cols = await runSelect(`SELECT column_name, column_type FROM (DESCRIBE ${v.name})`, LIMITS.maxRows);
      const sample = v.kind === "table" ? (await runSelect(`SELECT * FROM ${v.name} LIMIT 5`, 5)).rows : undefined;
      const starters = dictionary()
        .starter_queries.filter((s) => s.sql.includes(`{data}${v.file}`))
        .map((s) => ({ question: s.q, sql: viewSql(s.sql) }));
      return envelope(m, [v.file], {
        view: v.name,
        file: v.file,
        kind: v.kind,
        title: e?.title,
        grain: v.list ? `one row per item of '${v.list}' in ${v.file}` : e?.grain,
        fields: v.list ? undefined : e?.fields,
        columns: cols.rows,
        questions: e?.questions ?? [],
        starter_queries: starters,
        ...(sample ? { sample_rows: sample } : {}),
        download: `${SITE_URL}/data/${v.file}`,
      });
    }

    case "run_sql": {
      const sql = typeof args.sql === "string" ? args.sql : "";
      if (!sql.trim()) throw new ToolError("bad_input", "Give a SELECT statement in 'sql'.");
      const max = args.max_rows === undefined ? LIMITS.defaultRows : Number(args.max_rows);
      if (!Number.isFinite(max) || max < 1) throw new ToolError("bad_input", "'max_rows' must be a positive integer.");
      try {
        const r = await runSelect(sql, max);
        const note = r.truncated ? [`Result truncated to ${r.row_count} rows: aggregate in SQL or raise max_rows (≤ ${LIMITS.maxRows}).`] : [];
        return envelope(m, filesIn(sql, views), r, note);
      } catch (e) {
        if (e instanceof QueryError) throw new ToolError(e.code, e.message);
        throw e;
      }
    }

    case "get_kpis": {
      const all = JSON.parse(readFileSync(path.join(DATA_DIR, "kpis.json"), "utf8")) as Record<string, unknown>[];
      const t = args.technology;
      const pick = t ? all.filter((k) => k.technology === t) : all;
      if (t && !pick.length) throw new ToolError("not_found", `No technology '${String(t)}'.`);
      return envelope(m, ["kpis.json"], {
        units_note: "Capacity in kW; added_capacity_kw_ytd counts units commissioned since 1 January of the as-of year.",
        kpis: pick,
      });
    }
  }
  throw new ToolError("not_found", `Unknown tool '${name}'.`);
}

export const INSTRUCTIONS = `MaStR Radar: Germany's renewable energy units (Marktstammdatenregister), auctions, grid redispatch and cross-border flows, as published at ${SITE_URL}. Read-only, updated daily.
How to answer well:
- For common questions use the typed tools: find_units, auction_round, auction_winners, company_profile, region_profile, grid_redispatch, cross_border_flows, whats_new, get_kpis.
- For anything else: list_datasets, describe_dataset for the fields, then run_sql (DuckDB SELECT over the views).
- Capacity is stored in kW; report MW or GW with units, and say whether you mean installed (operating) or added in a period.
- Units below 100 kW are only in 'summary' (totals by technology, status, size class, district and commissioning month); 'units' lists units of 100 kW or more.
- Always state the as-of date, cite the source and licence line from the result, and pass on the caveats (recent months are incomplete because of late registrations).
- Privacy: no names or exact locations of private persons are published; do not try to infer them.`;
