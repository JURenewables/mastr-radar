// Explorer filters: one state object <-> URL search params <-> SQL WHERE clauses.
// Every value is checked against a fixed list or pattern before it reaches SQL,
// so a hand-edited link can never inject anything into a query.
import { SIZE_CLASSES, STATUS_LABELS, TECHNOLOGIES, type SizeClass, type Status } from "./theme";
import type { Technology } from "./types";

export interface Filters {
  tech: Technology[]; // empty = all
  status: Status[]; // empty = all
  size: SizeClass[]; // empty = all
  state: string | null; // 2-digit state key, or OFF_N / OFF_O
  from: string | null; // commissioning month YYYY-MM (inclusive)
  to: string | null; // commissioning month YYYY-MM (inclusive)
}

export const DEFAULT_FILTERS: Filters = {
  tech: [],
  status: ["operating"],
  size: [],
  state: null,
  from: null,
  to: null,
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const STATE_RE = /^(\d{2}|OFF_N|OFF_O)$/;
const STATUSES = Object.keys(STATUS_LABELS) as Status[];

function pick<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const set = new Set(raw.split(","));
  return allowed.filter((v) => set.has(v));
}

// Size classes contain characters that are awkward in URLs, so they get short codes.
const SIZE_CODES: Record<SizeClass, string> = {
  "<10 kW": "xs",
  "10–100 kW": "s",
  "100 kW–1 MW": "m",
  "1–10 MW": "l",
  "≥10 MW": "xl",
};
const SIZE_BY_CODE = Object.fromEntries(Object.entries(SIZE_CODES).map(([k, v]) => [v, k])) as Record<
  string,
  SizeClass
>;

export function parseFilters(params: URLSearchParams): Filters {
  const sizeCodes = (params.get("size") ?? "").split(",");
  const month = (key: string) => {
    const v = params.get(key);
    return v && MONTH_RE.test(v) ? v : null;
  };
  const state = params.get("state");
  return {
    tech: pick(params.get("tech"), TECHNOLOGIES),
    status: params.has("status") ? pick(params.get("status"), STATUSES) : DEFAULT_FILTERS.status,
    size: SIZE_CLASSES.filter((s) => sizeCodes.includes(SIZE_CODES[s])),
    state: state && STATE_RE.test(state) ? state : null,
    from: month("from"),
    to: month("to"),
  };
}

export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.tech.length) p.set("tech", f.tech.join(","));
  // Status is always written when it differs from the default, "" meaning "all".
  if (f.status.join(",") !== DEFAULT_FILTERS.status.join(",")) p.set("status", f.status.join(","));
  if (f.size.length) p.set("size", f.size.map((s) => SIZE_CODES[s]).join(","));
  if (f.state) p.set("state", f.state);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p;
}

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const inList = (col: string, values: readonly string[]) =>
  values.length ? `${col} IN (${values.map(q).join(", ")})` : null;

/** WHERE clause for summary.parquet (commissioning_month is 'YYYY-MM'). */
export function summaryWhere(f: Filters): string {
  const parts = [
    inList("technology", f.tech),
    inList("status", f.status),
    inList("size_class", f.size),
    f.state ? `state_key = ${q(f.state)}` : null,
    f.from ? `commissioning_month >= ${q(f.from)}` : null,
    f.to ? `commissioning_month <= ${q(f.to)}` : null,
  ].filter(Boolean);
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

/** WHERE clause for units.parquet (commissioning_date is a DATE). */
export function unitsWhere(f: Filters): string {
  const parts = [
    inList("technology", f.tech),
    inList("status", f.status),
    inList("size_class", f.size),
    f.state ? `state_key = ${q(f.state)}` : null,
    f.from ? `commissioning_date >= DATE ${q(`${f.from}-01`)}` : null,
    f.to ? `commissioning_date < (DATE ${q(`${f.to}-01`)} + INTERVAL 1 MONTH)` : null,
  ].filter(Boolean);
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

export { SIZE_BY_CODE, SIZE_CODES };
