// Query engine for the MCP server (contract v1.10, WP77/WP80).
// DuckDB reads only the published explorer files in public/data. Every file is
// a read-only view; then the engine is locked to that folder (no other files,
// no network, no extensions, no settings changes).
import { readFileSync } from "node:fs";
import path from "node:path";

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

export const DATA_DIR = path.join(process.cwd(), "public", "data");

export interface ManifestFile { name: string; rows?: number; bytes?: number }
export interface Manifest {
  as_of: string;
  contract_version: string;
  pipeline_version?: string;
  incomplete_after?: Record<string, string>;
  files: ManifestFile[];
}

export interface View {
  name: string;
  file: string;
  /** "table": one row per record. "document": one row holding the nested file. */
  kind: "table" | "document";
  /** For flat views over a list inside a JSON file: the list's key. */
  list?: string;
}

/** Flat tables over lists inside JSON files, for the questions agents ask most. */
export const LIST_VIEWS: View[] = [
  { name: "wind_awards", file: "auctions/awards.json", kind: "table", list: "awards" },
  { name: "solar_awards", file: "auctions/solar_awards.json", kind: "table", list: "awards" },
  { name: "wind_rounds", file: "auctions/onshore.json", kind: "table", list: "rounds" },
  { name: "solar_rounds", file: "auctions/solar.json", kind: "table", list: "rounds" },
  { name: "players", file: "auctions/players.json", kind: "table", list: "players" },
  { name: "redispatch_monthly", file: "grid/redispatch.json", kind: "table", list: "monthly" },
];

export const viewName = (file: string) => file.replace(/\.(parquet|json|geojson)$/, "").replace(/[/-]/g, "_");

export function readManifest(): Manifest {
  return JSON.parse(readFileSync(path.join(DATA_DIR, "manifest.json"), "utf8")) as Manifest;
}

export function listViews(m: Manifest): View[] {
  const base: View[] = m.files
    .filter((f) => /\.(parquet|json|geojson)$/.test(f.name))
    .map((f) => ({
      name: viewName(f.name),
      file: f.name,
      kind: f.name.endsWith(".parquet") || f.name === "kpis.json" || f.name.endsWith(".geojson") ? "table" : "document",
    }));
  const have = new Set(base.map((v) => v.file));
  return [...base, ...LIST_VIEWS.filter((v) => have.has(v.file))];
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function source(v: View): string {
  const p = q(path.join(DATA_DIR, v.file));
  if (v.file.endsWith(".parquet")) return `SELECT * FROM read_parquet(${p})`;
  const json = `read_json_auto(${p}, maximum_object_size = 67108864)`;
  if (v.list) return `SELECT unnest(${v.list}, max_depth := 2) FROM ${json}`;
  return `SELECT * FROM ${json}`;
}

let ready: Promise<{ inst: DuckDBInstance; views: View[]; manifest: Manifest }> | null = null;

async function init() {
  const manifest = readManifest();
  const inst = await DuckDBInstance.create(":memory:", { threads: "2", memory_limit: "512MB" });
  const con = await inst.connect();
  const views: View[] = [];
  for (const v of listViews(manifest)) {
    try {
      await con.run(`CREATE VIEW ${v.name} AS ${source(v)}`);
      views.push(v);
    } catch {
      // A file that cannot be read is left out rather than breaking every tool.
    }
  }
  const dir = DATA_DIR.endsWith(path.sep) ? DATA_DIR : DATA_DIR + path.sep;
  for (const s of [
    `SET allowed_directories = [${q(dir)}]`,
    "SET enable_external_access = false",
    "SET autoinstall_known_extensions = false",
    "SET autoload_known_extensions = false",
    "SET lock_configuration = true",
  ]) await con.run(s);
  con.closeSync();
  return { inst, views, manifest };
}

export async function engine() {
  ready ??= init().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export class QueryError extends Error {
  constructor(public code: "query_rejected" | "query_timeout" | "bad_input", message: string) {
    super(message);
  }
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
}

const SELECT = 1; // duckdb StatementType.SELECT (also covers WITH … SELECT)
export const LIMITS = { sqlChars: 4000, maxRows: 1000, defaultRows: 200, timeoutMs: 10_000, resultBytes: 1_000_000 };

/** Run one read-only SELECT with row cap, timeout and result-size cap. */
export async function runSelect(sql: string, maxRows = LIMITS.defaultRows): Promise<QueryResult> {
  if (sql.length > LIMITS.sqlChars) throw new QueryError("bad_input", `SQL is longer than ${LIMITS.sqlChars} characters.`);
  const cap = Math.max(1, Math.min(LIMITS.maxRows, Math.floor(maxRows)));
  const { inst } = await engine();
  const con: DuckDBConnection = await inst.connect();
  const timer = setTimeout(() => con.interrupt(), LIMITS.timeoutMs);
  try {
    let extracted;
    try {
      extracted = await con.extractStatements(sql);
    } catch (e) {
      throw new QueryError("query_rejected", firstLine(e));
    }
    if (extracted.count !== 1) throw new QueryError("query_rejected", "Send exactly one SELECT (or WITH … SELECT) statement.");
    let stmt;
    try {
      stmt = await extracted.prepare(0);
    } catch (e) {
      throw new QueryError("query_rejected", firstLine(e));
    }
    if (stmt.statementType !== SELECT) throw new QueryError("query_rejected", "Only read-only SELECT statements are allowed.");
    let reader;
    try {
      reader = await stmt.streamAndReadUntil(cap + 1);
    } catch (e) {
      const msg = firstLine(e);
      if (/interrupt/i.test(msg)) throw new QueryError("query_timeout", `The query took longer than ${LIMITS.timeoutMs / 1000} s.`);
      throw new QueryError("query_rejected", msg);
    }
    let rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    let truncated = rows.length > cap;
    rows = rows.slice(0, cap);
    while (rows.length > 1 && JSON.stringify(rows).length > LIMITS.resultBytes) {
      rows = rows.slice(0, Math.floor(rows.length / 2));
      truncated = true;
    }
    return { columns: reader.columnNames(), rows, row_count: rows.length, truncated };
  } finally {
    clearTimeout(timer);
    con.closeSync();
  }
}

const firstLine = (e: unknown) => String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 300);
