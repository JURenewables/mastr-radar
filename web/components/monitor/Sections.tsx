"use client";

import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { mw, type MonitorData } from "@/lib/monitor";
import { cssVar, TECH_CSS_VAR } from "@/lib/theme";
import type { Technology } from "@/lib/types";

import { darken, projectGermany, setupCanvas } from "./canvasMap";
import { Segmented, Stat } from "./ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LABEL: Record<Technology, string> = {
  solar: "Solar",
  wind_onshore: "Onshore wind",
  wind_offshore: "Offshore wind",
  storage: "Storage",
  biomass: "Biomass",
  hydro: "Hydro",
};
const axis = () => ({
  style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") },
});
const gw = (v: number) => v / 1000;
const techColor = (t: Technology) => cssVar(TECH_CSS_VAR[t]);

// Official short forms, used on narrow screens so bar labels fit.
const SHORT: Record<string, string> = {
  "Schleswig-Holstein": "SH",
  "Hamburg": "HH",
  "Niedersachsen": "NI",
  "Bremen": "HB",
  "Nordrhein-Westfalen": "NRW",
  "Hessen": "HE",
  "Rheinland-Pfalz": "RP",
  "Baden-Württemberg": "BW",
  "Bayern": "BY",
  "Saarland": "SL",
  "Berlin": "BE",
  "Brandenburg": "BB",
  "Mecklenburg-Vorpommern": "MV",
  "Sachsen": "SN",
  "Sachsen-Anhalt": "ST",
  "Thüringen": "TH",
  "Nordsee (offshore)": "North Sea",
  "Ostsee (offshore)": "Baltic Sea",
};
const stateLabel = (name: string, width: number) => (width < 560 ? (SHORT[name] ?? name) : name);
const labelMargin = (width: number) => (width < 560 ? 64 : 170);

function yearsLeft(asOf: string) {
  return (Date.UTC(2030, 11, 31) - Date.parse(`${asOf}T00:00:00Z`)) / (365.25 * 864e5);
}

// --- The race to 2030 ---------------------------------------------------------

export function TargetRace({ data, asOf }: { data: MonitorData; asOf: string }) {
  const [tech, setTech] = useState<"solar" | "wind_onshore" | "wind_offshore">("solar");
  const { buildout, stats } = data;
  const years = buildout.years;
  const target = stats.targets_2030_mw[tech] ?? 0;
  const installed = buildout.national[tech].installed.at(-1) ?? 0;
  const need = Math.max(0, (target - installed) / yearsLeft(asOf));
  const from = years.indexOf(2005);
  const rows = years.slice(from).map((y, i) => ({ year: y, gw: gw(buildout.national[tech].added[from + i]) }));
  const asOfYear = years.at(-1)!;
  const prev = rows.find((r) => r.year === asOfYear - 1)?.gw ?? 0;
  const pct = target ? Math.min(100, (installed / target) * 100) : 0;

  return (
    <div className="space-y-6">
      <Segmented
        label="Technology"
        value={tech}
        onChange={setTech}
        options={(["solar", "wind_onshore", "wind_offshore"] as const).map((t) => ({
          value: t,
          label: LABEL[t],
          swatch: `var(${TECH_CSS_VAR[t]})`,
        }))}
      />
      <div>
        <p className="figures text-lg">
          <strong className="text-2xl font-extrabold">{mw(installed)}</strong>
          <span className="text-ink-muted"> of {mw(target, 0)} target · {pct.toFixed(0)}%</span>
        </p>
        <div className="mt-2 h-4 overflow-hidden rounded-full bg-surface" aria-hidden>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `var(${TECH_CSS_VAR[tech]})` }} />
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          {LABEL[tech]} added <strong className="text-ink">{prev.toFixed(1)} GW</strong> in {asOfYear - 1}.
          Reaching the 2030 target needs <strong className="text-ink">{gw(need).toFixed(1)} GW</strong> every year from now.
        </p>
      </div>
      <PlotFigure
        deps={[rows, need, tech]}
        render={(width) =>
          Plot.plot({
            width,
            height: 260,
            marginLeft: 54,
            ...axis(),
            x: { label: null, type: "band", tickFormat: (d: number) => (d % 5 === 0 ? String(d) : "") },
            y: { label: null, grid: true, tickFormat: (d: number) => `${d} GW` },
            marks: [
              Plot.barY(rows, {
                x: "year",
                y: "gw",
                fill: techColor(tech),
                fillOpacity: (d: { year: number }) => (d.year === asOfYear ? 0.45 : 1),
                rx: 3,
                tip: true,
                title: (d: { year: number; gw: number }) => `${d.year}: ${d.gw.toFixed(2)} GW`,
              }),
              Plot.ruleY([gw(need)], { stroke: cssVar("--ink"), strokeDasharray: "5,4", strokeWidth: 1.5 }),
              Plot.text([gw(need)], {
                y: (d: number) => d,
                frameAnchor: "right",
                textAnchor: "end",
                dy: -9,
                text: () => `2030 pace: ${gw(need).toFixed(1)} GW / year`,
                fill: cssVar("--ink"),
                fontWeight: 700,
              }),
              Plot.ruleY([0]),
            ],
          })
        }
      />
    </div>
  );
}

// --- This year vs previous years ----------------------------------------------

export function YearRace({ data }: { data: MonitorData }) {
  const [tech, setTech] = useState<Technology>("solar");
  const curves = data.stats.ytd_cumulative_mw[tech];
  const years = Object.keys(curves).sort();
  const current = years.at(-1)!;
  const rows = years.flatMap((y) => curves[y].map((v, i) => ({ year: y, month: i + 1, gw: gw(v) })));
  const nowMonth = curves[current].length;
  const sameTimeLastYear = curves[years.at(-2)!]?.[nowMonth - 1] ?? 0;
  const now = curves[current].at(-1) ?? 0;
  const diff = sameTimeLastYear ? ((now - sameTimeLastYear) / sameTimeLastYear) * 100 : 0;
  // End labels for earlier years; when two end values are close, nudge the lower one down.
  const maxGw = Math.max(...rows.map((r) => r.gw), 1);
  const otherLabels = years
    .filter((y) => y !== current)
    .map((y) => ({ year: y, month: curves[y].length, gw: gw(curves[y].at(-1) ?? 0), dy: 0 }))
    .sort((a, b) => b.gw - a.gw);
  for (let i = 1; i < otherLabels.length; i++) {
    const prevLabel = otherLabels[i - 1];
    if (prevLabel.month === otherLabels[i].month && prevLabel.gw - otherLabels[i].gw < maxGw * 0.05) {
      otherLabels[i].dy = prevLabel.dy + 13;
    }
  }

  return (
    <div className="space-y-5">
      <Segmented
        label="Technology"
        value={tech}
        onChange={setTech}
        options={(["solar", "wind_onshore", "wind_offshore", "storage"] as Technology[]).map((t) => ({
          value: t,
          label: LABEL[t],
          swatch: `var(${TECH_CSS_VAR[t]})`,
        }))}
      />
      <p className="text-sm text-ink-muted">
        {current} so far: <strong className="text-ink">{mw(now)}</strong>, {diff >= 0 ? "+" : ""}
        {diff.toFixed(0)}% vs the same point in {years.at(-2)}. The last weeks are still incomplete.
      </p>
      <PlotFigure
        deps={[rows, tech]}
        render={(width) =>
          Plot.plot({
            width,
            height: 280,
            marginLeft: 40,
            marginRight: 44,
            ...axis(),
            x: { label: null, domain: [1, 12], ticks: 12, tickFormat: (m: number) => MONTHS[m - 1].slice(0, width < 500 ? 1 : 3) },
            y: { label: "GW added since January", grid: true },
            marks: [
              Plot.lineY(rows.filter((r) => r.year !== current), {
                x: "month",
                y: "gw",
                z: "year",
                stroke: cssVar("--ink-muted"),
                strokeOpacity: 0.45,
                strokeWidth: 1.5,
              }),
              Plot.lineY(rows.filter((r) => r.year === current), {
                x: "month",
                y: "gw",
                stroke: techColor(tech),
                strokeWidth: 3.5,
              }),
              ...otherLabels.map((l) =>
                Plot.text([l], {
                  x: "month",
                  y: "gw",
                  text: "year",
                  dx: 6,
                  dy: l.dy,
                  textAnchor: "start",
                  fill: cssVar("--ink-muted"),
                }),
              ),
              Plot.text([{ year: current, month: nowMonth, gw: gw(now) }], {
                x: "month",
                y: "gw",
                text: "year",
                dx: 6,
                textAnchor: "start",
                fontWeight: 800,
                fill: techColor(tech),
              }),
              Plot.ruleY([0]),
            ],
          })
        }
      />
    </div>
  );
}

// --- Balcony boom -----------------------------------------------------------

const SOLAR_TYPES = [
  ["ground_mounted", "Ground-mounted"],
  ["rooftop", "Rooftop"],
  ["balcony", "Balcony"],
] as const;

export function SolarTypes({ data }: { data: MonitorData }) {
  const [metric, setMetric] = useState<"units" | "mw">("units");
  const s = data.stats.solar_by_type;
  const from = s.years.indexOf(2012);
  const rows = s.years.slice(from).flatMap((y, i) =>
    SOLAR_TYPES.map(([k, label]) => ({
      year: y,
      type: label,
      value: metric === "units" ? s.units[k][from + i] / 1000 : gw(s.mw[k][from + i]),
    })),
  );
  const colors = [darken(cssVar("--tech-solar"), 0.75), cssVar("--tech-solar"), cssVar("--accent")];
  return (
    <div className="space-y-5">
      <Segmented
        label="Measure"
        value={metric}
        onChange={setMetric}
        options={[
          { value: "units", label: "New units" },
          { value: "mw", label: "New capacity" },
        ]}
      />
      <PlotFigure
        deps={[rows, metric]}
        render={(width) =>
          Plot.plot({
            width,
            height: 280,
            marginLeft: 44,
            ...axis(),
            x: { label: null, type: "band", tickFormat: (d: number) => (d % 4 === 0 ? String(d) : "") },
            y: { label: metric === "units" ? "Thousand units per year" : "GW per year", grid: true },
            color: { domain: SOLAR_TYPES.map(([, l]) => l), range: colors, legend: true },
            marks: [
              Plot.barY(rows, {
                x: "year",
                y: "value",
                fill: "type",
                tip: true,
                title: (d: { year: number; type: string; value: number }) =>
                  `${d.year} · ${d.type}\n${metric === "units" ? `${Math.round(d.value * 1000).toLocaleString("en-GB")} units` : `${d.value.toFixed(2)} GW`}`,
              }),
              Plot.ruleY([0]),
            ],
          })
        }
      />
    </div>
  );
}

// --- Turbines keep growing --------------------------------------------------

function TurbineSilhouette({ hub, rotor, mwValue, year, maxHeight }: { hub: number; rotor: number; mwValue: number; year: number; maxHeight: number }) {
  const H = 220;
  const s = (H - 20) / maxHeight; // px per metre
  const towerTop = H - hub * s;
  const r = (rotor / 2) * s;
  const cx = 60;
  return (
    <figure className="flex flex-col items-center">
      <svg viewBox={`0 0 120 ${H}`} width="120" height={H} aria-hidden className="text-ink">
        <line x1={cx} y1={H} x2={cx} y2={towerTop} stroke="currentColor" strokeWidth={Math.max(2, hub / 40)} strokeLinecap="round" />
        {[0, 120, 240].map((a) => (
          <line
            key={a}
            x1={cx}
            y1={towerTop}
            x2={cx + r * Math.sin((a * Math.PI) / 180)}
            y2={towerTop - r * Math.cos((a * Math.PI) / 180)}
            stroke="var(--tech-wind-onshore)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        ))}
        <circle cx={cx} cy={towerTop} r="3" fill="currentColor" />
      </svg>
      <figcaption className="figures mt-2 text-center text-sm">
        <strong className="text-base">{year}</strong>
        <br />
        {mwValue.toFixed(1)} MW · {Math.round(hub)} m hub
        <br />
        {Math.round(rotor)} m rotor
      </figcaption>
    </figure>
  );
}

export function TurbineGrowth({ data }: { data: MonitorData }) {
  const [metric, setMetric] = useState<"avg_mw" | "avg_hub_height_m" | "avg_rotor_diameter_m">("avg_mw");
  const t = data.stats.onshore_turbines;
  const lastFull = t.years.length - 2; // the as-of year is still running
  const i2000 = t.years.indexOf(2000);
  const rows = t.years
    .map((y, i) => ({ year: y, v: t[metric][i] as number | null, n: t.count[i] }))
    .filter((r) => r.v != null && r.year >= 1995);
  const unit = metric === "avg_mw" ? "MW" : "m";
  const maxH = Math.max(
    (t.avg_hub_height_m[lastFull] ?? 0) + (t.avg_rotor_diameter_m[lastFull] ?? 0) / 2,
    100,
  );
  return (
    <div className="space-y-6">
      {i2000 >= 0 && (
        <div className="flex items-end justify-center gap-8 rounded-[20px] bg-surface p-5">
          <TurbineSilhouette
            year={2000}
            hub={t.avg_hub_height_m[i2000] ?? 70}
            rotor={t.avg_rotor_diameter_m[i2000] ?? 60}
            mwValue={t.avg_mw[i2000]}
            maxHeight={maxH}
          />
          <TurbineSilhouette
            year={t.years[lastFull]}
            hub={t.avg_hub_height_m[lastFull] ?? 130}
            rotor={t.avg_rotor_diameter_m[lastFull] ?? 130}
            mwValue={t.avg_mw[lastFull]}
            maxHeight={maxH}
          />
        </div>
      )}
      <Segmented
        label="Measure"
        value={metric}
        onChange={setMetric}
        options={[
          { value: "avg_mw", label: "Capacity" },
          { value: "avg_hub_height_m", label: "Hub height" },
          { value: "avg_rotor_diameter_m", label: "Rotor" },
        ]}
      />
      <PlotFigure
        deps={[rows, metric]}
        render={(width) =>
          Plot.plot({
            width,
            height: 240,
            marginLeft: 40,
            ...axis(),
            x: { label: null, tickFormat: (d: number) => String(d) },
            y: { label: `Average per new turbine (${unit})`, grid: true, zero: true },
            marks: [
              Plot.areaY(rows, { x: "year", y: "v", fill: techColor("wind_onshore"), fillOpacity: 0.12 }),
              Plot.lineY(rows, { x: "year", y: "v", stroke: techColor("wind_onshore"), strokeWidth: 3 }),
              Plot.dot(rows.slice(-2, -1), { x: "year", y: "v", r: 5, fill: techColor("wind_onshore") }),
              Plot.tip(rows, Plot.pointerX({ x: "year", y: "v", title: (d: { year: number; v: number; n: number }) => `${d.year}: ${d.v} ${unit} · ${d.n.toLocaleString("en-GB")} turbines` })),
            ],
          })
        }
      />
    </div>
  );
}

// --- Where it's built -------------------------------------------------------

export function StatesRank({ data }: { data: MonitorData }) {
  const [tech, setTech] = useState<Technology>("solar");
  const [metric, setMetric] = useState<"density" | "resident" | "total">("density");
  const rows = useMemo(
    () =>
      data.stats.states
        .filter((s) => metric === "total" || (metric === "density" ? s.area_km2 : s.population))
        .map((s) => ({
          name: s.name,
          value:
            metric === "density"
              ? (s.operating_mw[tech] / (s.area_km2 || 1)) * 1000
              : metric === "resident"
                ? (s.operating_mw[tech] * 1e6) / (s.population || 1)
                : gw(s.operating_mw[tech]),
        }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value),
    [data, tech, metric],
  );
  const top = data.stats.top_districts[tech] ?? [];
  const fmt = (v: number) =>
    metric === "density"
      ? `${Math.round(v)} kW/km²`
      : metric === "resident"
        ? `${Math.round(v).toLocaleString("en-GB")} W`
        : `${v.toFixed(1)} GW`;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Segmented
          label="Technology"
          value={tech}
          onChange={setTech}
          options={(["solar", "wind_onshore", "storage", "biomass"] as Technology[]).map((t) => ({
            value: t,
            label: LABEL[t],
            swatch: `var(${TECH_CSS_VAR[t]})`,
          }))}
        />
        <Segmented
          label="Measure"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "density", label: "Per km²" },
            { value: "resident", label: "Per resident" },
            { value: "total", label: "Total" },
          ]}
        />
      </div>
      <PlotFigure
        height={rows.length * 24 + 30}
        deps={[rows, tech, metric]}
        render={(width) =>
          Plot.plot({
            width,
            height: rows.length * 24 + 30,
            marginLeft: labelMargin(width),
            marginRight: 76,
            ...axis(),
            x: { axis: null },
            y: { label: null, domain: rows.map((r) => r.name), tickFormat: (n: string) => stateLabel(n, width) },
            marks: [
              Plot.barX(rows, { x: "value", y: "name", fill: techColor(tech), rx: 3 }),
              Plot.text(rows, {
                x: "value",
                y: "name",
                text: (d: { value: number }) => fmt(d.value),
                dx: 4,
                textAnchor: "start",
                fill: cssVar("--ink-muted"),
              }),
            ],
          })
        }
      />
      {metric === "density" && top.length > 0 && (
        <div className="rounded-[20px] bg-surface p-5">
          <p className="text-sm font-semibold">Densest districts</p>
          <ol className="figures mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {top.slice(0, 6).map((d, i) => (
              <li key={d.key} className="flex justify-between gap-3">
                <span>
                  {i + 1}. {d.name}
                </span>
                <span className="text-ink-muted">{Math.round(d.mw_per_km2 * 1000)} kW/km²</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// --- Storage boom -----------------------------------------------------------

const BUCKETS = [
  ["home", "Home (< 30 kW)"],
  ["commercial", "Commercial (30 kW–1 MW)"],
  ["large", "Large (≥ 1 MW)"],
] as const;

export function StorageBoom({ data }: { data: MonitorData }) {
  const [metric, setMetric] = useState<"mw" | "mwh">("mw");
  const b = data.stats.battery_storage;
  const from = b.years.indexOf(2014);
  const rows = b.years.slice(from).flatMap((y, i) =>
    BUCKETS.map(([k, label]) => ({ year: y, bucket: label, value: gw(b.buckets[k][metric][from + i]) })),
  );
  const colors = [darken(cssVar("--tech-storage"), 0.55), cssVar("--tech-storage"), cssVar("--accent")];
  return (
    <div className="space-y-5">
      <Segmented
        label="Measure"
        value={metric}
        onChange={setMetric}
        options={[
          { value: "mw", label: "Power (GW)" },
          { value: "mwh", label: "Energy (GWh)" },
        ]}
      />
      <PlotFigure
        deps={[rows, metric]}
        render={(width) =>
          Plot.plot({
            width,
            height: 280,
            marginLeft: 40,
            ...axis(),
            x: { label: null, type: "band", tickFormat: (d: number) => (d % 2 === 0 ? String(d) : "") },
            y: { label: metric === "mw" ? "GW added per year" : "GWh added per year", grid: true },
            color: { domain: BUCKETS.map(([, l]) => l), range: colors, legend: true },
            marks: [
              Plot.barY(rows, {
                x: "year",
                y: "value",
                fill: "bucket",
                tip: true,
                title: (d: { year: number; bucket: string; value: number }) =>
                  `${d.year} · ${d.bucket}\n${d.value.toFixed(2)} ${metric === "mw" ? "GW" : "GWh"}`,
              }),
              Plot.ruleY([0]),
            ],
          })
        }
      />
    </div>
  );
}

// --- The next wave: onshore wind pipeline -----------------------------------

export function PipelineMap({ data }: { data: MonitorData }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { points, districts: geo, stats } = data;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const { ctx, width, height } = setupCanvas(canvas, 640);
      const { projection, districts } = projectGermany(geo, width, height, 16);
      ctx.fillStyle = cssVar("--map-base");
      ctx.fillRect(0, 0, width, height);
      for (const d of districts) {
        ctx.fillStyle = cssVar("--surface");
        ctx.fill(d.path);
        ctx.strokeStyle = cssVar("--map-line");
        ctx.lineWidth = 0.5;
        ctx.stroke(d.path);
      }
      const P = points.operating;
      const onshore = points.techs.indexOf("wind_onshore");
      ctx.fillStyle = cssVar("--ink-muted");
      ctx.globalAlpha = 0.25;
      for (let i = 0; i < P.length; i += 5) {
        if (P[i + 3] !== onshore) continue;
        const xy = projection([P[i] / 100, P[i + 1] / 100]);
        if (xy) ctx.fillRect(xy[0] - 0.8, xy[1] - 0.8, 1.6, 1.6);
      }
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = cssVar("--accent");
      const Q = points.planned_onshore;
      for (let i = 0; i < Q.length; i += 3) {
        const xy = projection([Q[i] / 100, Q[i + 1] / 100]);
        if (!xy) continue;
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], Math.max(1.2, Math.sqrt(Q[i + 2]) * 0.8 * (width / 700)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, [geo, points]);

  const byState = stats.states
    .map((s) => ({ name: s.name, gw: gw(s.planned_mw.wind_onshore) }))
    .filter((r) => r.gw > 0)
    .sort((a, b) => b.gw - a.gw)
    .slice(0, 8);
  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div className="min-w-0 overflow-hidden rounded-[20px] border border-rule">
        <canvas ref={ref} role="img" aria-label="Map of planned onshore wind turbines (blue) and turbines in operation (grey)" className="block w-full" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-ink-muted">
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-accent align-middle" /> planned turbines ·{" "}
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-ink-muted align-middle opacity-50" /> in operation
        </p>
        <PlotFigure
          height={byState.length * 26 + 20}
          deps={[byState]}
          render={(width) =>
            Plot.plot({
              width,
              height: byState.length * 26 + 20,
              marginLeft: labelMargin(width),
              marginRight: 56,
              ...axis(),
              x: { axis: null },
              y: { label: null, domain: byState.map((r) => r.name), tickFormat: (n: string) => stateLabel(n, width) },
              marks: [
                Plot.barX(byState, { x: "gw", y: "name", fill: cssVar("--accent"), rx: 3 }),
                Plot.text(byState, { x: "gw", y: "name", text: (d: { gw: number }) => `${d.gw.toFixed(1)} GW`, dx: 4, textAnchor: "start", fill: cssVar("--ink-muted") }),
              ],
            })
          }
        />
      </div>
    </div>
  );
}

// --- Ageing fleet: repowering -------------------------------------------------

export function Repowering({ data }: { data: MonitorData }) {
  const r = data.stats.repowering;
  const names = Object.fromEntries(data.stats.states.map((s) => [s.key, s.name]));
  const rows = Object.entries(r.by_state)
    .map(([k, v]) => ({ name: names[k] ?? k, gw: gw(v.mw), units: v.units }))
    .sort((a, b) => b.gw - a.gw)
    .slice(0, 8);
  const factor = r.avg_mw_old && r.avg_mw_new ? r.avg_mw_new / r.avg_mw_old : null;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={`Turbines older than ${r.age_years} years`} value={r.units.toLocaleString("en-GB")} sub={`went online until ${r.commissioned_until}`} />
        <Stat label="Their capacity" value={mw(r.mw)} sub="still in operation" />
        <Stat
          label="Average size, old vs new"
          value={`${r.avg_mw_old?.toFixed(1)} → ${r.avg_mw_new?.toFixed(1)} MW`}
          sub={factor ? `a new turbine has ${factor.toFixed(1)}× the capacity` : undefined}
        />
      </div>
      <PlotFigure
        height={rows.length * 26 + 20}
        deps={[rows]}
        render={(width) =>
          Plot.plot({
            width,
            height: rows.length * 26 + 20,
            marginLeft: labelMargin(width),
            marginRight: 110,
            ...axis(),
            x: { axis: null },
            y: { label: null, domain: rows.map((d) => d.name), tickFormat: (n: string) => stateLabel(n, width) },
            marks: [
              Plot.barX(rows, { x: "gw", y: "name", fill: techColor("wind_onshore"), fillOpacity: 0.55, rx: 3 }),
              Plot.text(rows, {
                x: "gw",
                y: "name",
                text: (d: { gw: number; units: number }) => `${d.gw.toFixed(1)} GW · ${d.units.toLocaleString("en-GB")}`,
                dx: 4,
                textAnchor: "start",
                fill: cssVar("--ink-muted"),
              }),
            ],
          })
        }
      />
    </div>
  );
}
