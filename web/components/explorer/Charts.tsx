"use client";

import * as Plot from "@observablehq/plot";
import { useMemo } from "react";

import { ChartFrame } from "@/components/ui/ChartFrame";
import { summaryWhere, type Filters } from "@/lib/filters";
import { formatDate, formatPower, TECHNOLOGY_LABELS } from "@/lib/format";
import { STATE_NAME } from "@/lib/regions";
import { cssVar, SIZE_CLASSES, TECH_CSS_VAR, TECHNOLOGIES } from "@/lib/theme";
import type { Technology } from "@/lib/types";
import { useQuery } from "@/lib/useQuery";

import { PlotFigure } from "./PlotFigure";

const techDomain = TECHNOLOGIES.map((t) => TECHNOLOGY_LABELS[t]);
const techRange = () => TECHNOLOGIES.map((t) => cssVar(TECH_CSS_VAR[t]));

function axisStyle() {
  return {
    style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") },
  };
}

interface PeriodRow {
  period: string;
  technology: Technology;
  capacity_kw: number;
}

/** Build-out over time: capacity commissioned per month (or year), by technology. */
export function BuildoutChart({
  version,
  filters,
  asOf,
  incompleteAfter,
}: {
  version: string;
  filters: Filters;
  asOf: string;
  incompleteAfter: string | null;
}) {
  // Long or open periods are shown per year; short ones per month.
  const fromYear = filters.from ? Number(filters.from.slice(0, 4)) : null;
  const toYear = filters.to ? Number(filters.to.slice(0, 4)) : Number(asOf.slice(0, 4));
  const yearly = fromYear === null || toYear - fromYear >= 3;
  const where = summaryWhere(filters);
  const cond = `commissioning_month IS NOT NULL${yearly ? " AND commissioning_month >= '2000-01'" : ""}`;
  const sql = `SELECT ${yearly ? "left(commissioning_month, 4)" : "commissioning_month"} AS period,
                      technology, sum(capacity_kw) AS capacity_kw
               FROM 'summary.parquet' ${where ? `${where} AND ${cond}` : `WHERE ${cond}`}
               GROUP BY 1, 2 ORDER BY 1`;
  const { data } = useQuery<PeriodRow>(version, sql);

  const rows = useMemo(
    () =>
      (data ?? []).map((r) => ({
        period: r.period,
        tech: TECHNOLOGY_LABELS[r.technology],
        gw: r.capacity_kw / 1e6,
      })),
    [data],
  );
  const total = rows.reduce((s, r) => s + r.gw, 0);
  const incompletePeriod = incompleteAfter
    ? yearly
      ? incompleteAfter.slice(0, 4)
      : incompleteAfter.slice(0, 7)
    : null;
  const peak = rows.length
    ? Object.entries(
        rows.reduce<Record<string, number>>((acc, r) => ((acc[r.period] = (acc[r.period] ?? 0) + r.gw), acc), {}),
      ).sort((a, b) => b[1] - a[1])[0]
    : null;

  return (
    <ChartFrame
      title={
        peak
          ? `${formatPower(total * 1e6)} went online${yearly ? " since 2000" : " in this period"}; the busiest ${yearly ? "year" : "month"} was ${peak[0]}`
          : "Capacity going online over time"
      }
      subtitle={`Gross capacity commissioned per ${yearly ? "year" : "month"}, by technology. Matches the current filters.`}
      asOf={formatDate(asOf)}
      note={
        incompleteAfter
          ? `Shaded: possibly incomplete (units registered late), after ${formatDate(incompleteAfter)}.`
          : undefined
      }
    >
      <PlotFigure
        deps={[rows, incompletePeriod]}
        render={(width) =>
          Plot.plot({
            width,
            height: 280,
            marginLeft: 44,
            ...axisStyle(),
            x: { label: null, tickFormat: (d: string) => (yearly ? d : d.slice(2)), type: "band" },
            y: { label: "GW", grid: true },
            color: { domain: techDomain, range: techRange() },
            marks: [
              Plot.barY(rows, {
                x: "period",
                y: "gw",
                fill: "tech",
                fillOpacity: (d: { period: string }) =>
                  incompletePeriod && d.period >= incompletePeriod ? 0.45 : 1,
                tip: true,
                title: (d: { period: string; tech: string; gw: number }) =>
                  `${d.period} · ${d.tech}\n${formatPower(d.gw * 1e6)}`,
              }),
              Plot.ruleY([0]),
            ],
          })
        }
      />
    </ChartFrame>
  );
}

interface SizeRow {
  size_class: string;
  capacity_kw: number;
  units: number;
}

export function SizeChart({ version, filters, asOf }: { version: string; filters: Filters; asOf: string }) {
  const { data } = useQuery<SizeRow>(
    version,
    `SELECT size_class, sum(capacity_kw) AS capacity_kw, sum(unit_count)::DOUBLE AS units
     FROM 'summary.parquet' ${summaryWhere(filters)} GROUP BY 1`,
  );
  const rows = useMemo(() => {
    const byClass = new Map((data ?? []).map((r) => [r.size_class, r]));
    return SIZE_CLASSES.map((s) => ({
      size: s,
      gw: (byClass.get(s)?.capacity_kw ?? 0) / 1e6,
      units: byClass.get(s)?.units ?? 0,
    }));
  }, [data]);
  const total = rows.reduce((s, r) => s + r.gw, 0);
  const top = [...rows].sort((a, b) => b.gw - a.gw)[0];

  return (
    <ChartFrame
      title={
        total > 0 && top
          ? `Units of ${top.size} hold ${Math.round((top.gw / total) * 100)}% of the capacity`
          : "Capacity by unit size"
      }
      subtitle="Gross capacity by size class. Matches the current filters."
      asOf={formatDate(asOf)}
    >
      <PlotFigure
        height={200}
        deps={[rows]}
        render={(width) =>
          Plot.plot({
            width,
            height: 200,
            marginLeft: 92,
            ...axisStyle(),
            x: { label: "GW", grid: true },
            y: { label: null, domain: SIZE_CLASSES as unknown as string[] },
            marks: [
              Plot.barX(rows, {
                x: "gw",
                y: "size",
                fill: cssVar("--accent"),
                tip: true,
                title: (d: { size: string; gw: number; units: number }) =>
                  `${d.size}\n${formatPower(d.gw * 1e6)} · ${d.units.toLocaleString("en-GB")} units`,
              }),
              Plot.text(rows, {
                x: "gw",
                y: "size",
                text: (d: { gw: number }) => formatPower(d.gw * 1e6),
                dx: 4,
                textAnchor: "start",
                fill: cssVar("--ink-muted"),
              }),
              Plot.ruleX([0]),
            ],
          })
        }
      />
    </ChartFrame>
  );
}

interface RegionRow {
  key: string;
  capacity_kw: number;
}

export function RegionRanking({
  version,
  filters,
  asOf,
}: {
  version: string;
  filters: Filters;
  asOf: string;
}) {
  const { data } = useQuery<RegionRow>(
    version,
    `SELECT state_key AS key, sum(capacity_kw) AS capacity_kw
     FROM 'summary.parquet' ${summaryWhere({ ...filters, state: null })}
     GROUP BY 1 ORDER BY 2 DESC LIMIT 18`,
  );
  const rows = useMemo(
    () =>
      (data ?? [])
        .filter((r) => r.key)
        .map((r) => ({ name: STATE_NAME[r.key] ?? r.key, gw: r.capacity_kw / 1e6, selected: r.key === filters.state })),
    [data, filters.state],
  );

  return (
    <ChartFrame
      title={rows[0] ? `${rows[0].name} leads with ${formatPower(rows[0].gw * 1e6)}` : "Capacity by region"}
      subtitle="Gross capacity by state and offshore region. Ignores the region filter."
      asOf={formatDate(asOf)}
    >
      <PlotFigure
        height={rows.length * 22 + 30}
        deps={[rows]}
        render={(width) =>
          Plot.plot({
            width,
            height: rows.length * 22 + 30,
            marginLeft: 150,
            ...axisStyle(),
            x: { label: "GW", grid: true },
            y: { label: null, domain: rows.map((r) => r.name) },
            marks: [
              Plot.barX(rows, {
                x: "gw",
                y: "name",
                fill: (d: { selected: boolean }) => (d.selected ? cssVar("--accent") : cssVar("--ink-muted")),
                tip: true,
                title: (d: { name: string; gw: number }) => `${d.name}\n${formatPower(d.gw * 1e6)}`,
              }),
              Plot.ruleX([0]),
            ],
          })
        }
      />
    </ChartFrame>
  );
}
