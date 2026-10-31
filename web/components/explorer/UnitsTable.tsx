"use client";

import { useMemo, useState } from "react";

import { ChartFrame } from "@/components/ui/ChartFrame";
import { query } from "@/lib/duckdb";
import { summaryWhere, unitsWhere, type Filters } from "@/lib/filters";
import { formatDate, formatPower, TECHNOLOGY_LABELS } from "@/lib/format";
import { STATUS_LABELS, type Status } from "@/lib/theme";
import type { Technology } from "@/lib/types";
import { useQuery } from "@/lib/useQuery";

interface Row {
  unit_id: string;
  name: string | null;
  technology: Technology;
  status: Status;
  capacity_kw: number;
  commissioning_date: string | number | null;
  state: string | null;
  municipality: string | null;
  operator_name: string | null;
}

type SortKey = "capacity_kw" | "commissioning_date";

const COLUMNS =
  "unit_id, name, technology, status, capacity_kw, commissioning_date, state, municipality, operator_name";

function dateText(v: Row["commissioning_date"]) {
  if (v == null) return "–";
  return new Date(typeof v === "number" ? v : String(v)).toISOString().slice(0, 10);
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name: string, header: string[], rows: unknown[][], asOf: string) {
  const lines = [
    `# Source: Marktstammdatenregister, © Bundesnetzagentur, DL-DE-BY-2.0 (https://www.govdata.de/dl-de/by-2-0). Data as of ${asOf}, processed by MaStR Radar.`,
    header.join(","),
    ...rows.map((r) => r.map(csvCell).join(",")),
  ];
  const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function UnitsTable({ version, filters, asOf }: { version: string; filters: Filters; asOf: string }) {
  const [sort, setSort] = useState<SortKey>("capacity_kw");
  const [busy, setBusy] = useState(false);
  const where = unitsWhere(filters);
  const sql = useMemo(
    () =>
      `SELECT ${COLUMNS} FROM 'units.parquet' ${where}
       ORDER BY ${sort} DESC NULLS LAST LIMIT 50`,
    [where, sort],
  );
  const { data, loading } = useQuery<Row>(version, sql);

  async function downloadUnits() {
    setBusy(true);
    try {
      const rows = await query<Row>(version, `SELECT ${COLUMNS} FROM 'units.parquet' ${where} ORDER BY capacity_kw DESC`);
      download(
        `mastr-radar-units-${asOf}.csv`,
        ["unit_id", "name", "technology", "status", "capacity_kw", "commissioning_date", "state", "municipality", "operator_name"],
        rows.map((r) => [r.unit_id, r.name, r.technology, r.status, r.capacity_kw, dateText(r.commissioning_date), r.state, r.municipality, r.operator_name]),
        asOf,
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadDistricts() {
    setBusy(true);
    try {
      const rows = await query<{ state_key: string; district_key: string; technology: string; units: number; capacity_kw: number }>(
        version,
        `SELECT state_key, district_key, technology, sum(unit_count)::DOUBLE AS units, sum(capacity_kw) AS capacity_kw
         FROM 'summary.parquet' ${summaryWhere(filters)} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
      );
      download(
        `mastr-radar-district-totals-${asOf}.csv`,
        ["state_key", "district_key", "technology", "units", "capacity_kw"],
        rows.map((r) => [r.state_key, r.district_key, r.technology, r.units, r.capacity_kw]),
        asOf,
      );
    } finally {
      setBusy(false);
    }
  }

  const sortButton = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort(key)}
      className={`underline-offset-2 ${sort === key ? "text-ink underline" : "hover:text-ink"}`}
      aria-pressed={sort === key}
    >
      {label}
    </button>
  );

  return (
    <ChartFrame
      title="Largest units in this selection"
      subtitle={<>Units from 100 kW. Sort by {sortButton("capacity_kw", "capacity")} or {sortButton("commissioning_date", "most recent")}.</>}
      asOf={formatDate(asOf)}
      note="Operator names are shown for companies and units of 1 MW or more only."
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={downloadUnits}
          className="rounded border border-ink px-3 py-1 text-sm hover:bg-ink hover:text-paper disabled:opacity-50"
        >
          Download units (CSV)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={downloadDistricts}
          className="rounded border border-rule px-3 py-1 text-sm hover:border-ink disabled:opacity-50"
        >
          Download district totals, all units (CSV)
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="figures w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-rule text-xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Unit</th>
              <th className="py-2 pr-3 font-medium">Technology</th>
              <th className="py-2 pr-3 text-right font-medium">Capacity</th>
              <th className="py-2 pr-3 font-medium">Online</th>
              <th className="py-2 pr-3 font-medium">Place</th>
              <th className="py-2 font-medium">Operator</th>
            </tr>
          </thead>
          <tbody className={loading ? "opacity-50" : ""}>
            {(data ?? []).map((r) => (
              <tr key={r.unit_id} className="border-b border-rule/60 align-top">
                <td className="py-2 pr-3">
                  {r.name ?? <span className="text-ink-muted">Private owner</span>}
                  <div className="text-xs text-ink-muted">
                    {r.unit_id} · {STATUS_LABELS[r.status]}
                  </div>
                </td>
                <td className="py-2 pr-3">{TECHNOLOGY_LABELS[r.technology]}</td>
                <td className="py-2 pr-3 text-right">{formatPower(r.capacity_kw)}</td>
                <td className="py-2 pr-3">{dateText(r.commissioning_date)}</td>
                <td className="py-2 pr-3">
                  {r.municipality ?? "–"}
                  <div className="text-xs text-ink-muted">{r.state}</div>
                </td>
                <td className="py-2">{r.operator_name ?? "–"}</td>
              </tr>
            ))}
            {data && data.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-ink-muted">
                  No units match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
}
