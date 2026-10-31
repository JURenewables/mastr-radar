"use client";

// Onshore wind turbine makers (contract v1.5 draft): bar chart race of the
// fleet or the yearly additions per brand, market shares, most-built models.
import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { mw, type MonitorData } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

import { prefersReducedMotion } from "./canvasMap";
import { Segmented } from "./ui";

// Fixed brand colours (mid tones that read on light and dark). Labels always name the brand.
const PALETTE = [
  "#2563eb", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4",
  "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#a855f7",
];
const OTHER = "Other";
export function brandColor(brands: string[], b: string) {
  return b === OTHER ? "#94a3b8" : PALETTE[brands.indexOf(b) % PALETTE.length];
}
const axis = () => ({
  style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") },
});

const short = (b: string) => b.replace(" (REpower)", "");

const ROWS = 10;
const ROW_H = 34;
const MS_PER_YEAR = 650;

// --- Bar chart race ---------------------------------------------------------

export function BrandRace({ data }: { data: MonitorData }) {
  const wi = data.stats.wind_industry;
  const [mode, setMode] = useState<"installed" | "added">("installed");
  const first = Math.max(0, wi.years.indexOf(1995));
  const last = wi.years.length - 1;
  const [pos, setPos] = useState(last);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const speed = prefersReducedMotion() ? MS_PER_YEAR * 2 : MS_PER_YEAR;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = now - prev;
      prev = now;
      setPos((p) => {
        const next = Math.min(last, p + dt / speed);
        if (next >= last) setPlaying(false);
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, last]);

  const series = mode === "installed" ? wi.installed_mw : wi.added_mw;
  const i0 = Math.floor(pos);
  const i1 = Math.min(last, i0 + 1);
  const f = pos - i0;
  const rows = wi.brands
    .map((b) => ({ brand: b, v: series[b][i0] * (1 - f) + series[b][i1] * f }))
    .sort((a, b) => (a.brand === OTHER ? 1 : b.brand === OTHER ? -1 : b.v - a.v));
  const shown = rows.filter((r) => r.brand !== OTHER).slice(0, ROWS);
  const total = rows.reduce((s, r) => s + r.v, 0);
  const max = Math.max(shown[0]?.v ?? 0, 1);
  const rank = new Map(shown.map((r, i) => [r.brand, i]));
  const year = wi.years[f > 0.5 ? i1 : i0];
  const running = year === wi.years[last];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Measure"
          value={mode}
          onChange={setMode}
          options={[
            { value: "installed", label: "Fleet in operation" },
            { value: "added", label: "Added per year" },
          ]}
        />
        <button
          type="button"
          onClick={() => {
            if (playing) return setPlaying(false);
            if (pos >= last) setPos(first);
            setPlaying(true);
          }}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white"
        >
          {playing ? "❚❚ Pause" : `▶ Play ${wi.years[first]}–${wi.years[last]}`}
        </button>
      </div>
      <input
        type="range"
        min={first}
        max={last}
        step={1}
        value={Math.round(pos)}
        aria-label="Year"
        onChange={(e) => {
          setPlaying(false);
          setPos(Number(e.target.value));
        }}
        className="mt-4 w-full accent-[var(--accent)]"
      />
      <div className="mt-3 rounded-[20px] bg-surface p-4 sm:p-6">
        <div className="flex items-start justify-between">
          <p className="figures text-5xl font-extrabold tracking-tighter sm:text-7xl">{year}</p>
          <div className="text-right">
            <p className="figures text-2xl font-extrabold tracking-tight sm:text-3xl">{mw(total)}</p>
            <p className="text-xs text-ink-muted">
              {mode === "installed" ? "onshore wind in operation" : `added in ${year}`}
              {running ? " (so far)" : ""}
            </p>
          </div>
        </div>
        <div
          className="relative mt-4"
          style={{ height: ROWS * ROW_H }}
          role="img"
          aria-label={`Onshore wind turbine makers ranked by ${mode === "installed" ? "capacity in operation" : "capacity added"} in ${year}: ${shown
            .slice(0, 5)
            .map((r) => `${r.brand} ${mw(r.v)}`)
            .join(", ")}`}
        >
          {wi.brands
            .filter((b) => b !== OTHER)
            .map((b) => {
              const r = rank.get(b);
              const v = rows.find((x) => x.brand === b)!.v;
              const visible = r !== undefined && v > 0.5;
              return (
                <div
                  key={b}
                  aria-hidden
                  className="absolute inset-x-0 flex items-center gap-2 transition-[transform,opacity] duration-500 ease-out"
                  style={{
                    height: ROW_H - 6,
                    transform: `translateY(${(r ?? ROWS) * ROW_H}px)`,
                    opacity: visible ? 1 : 0,
                  }}
                >
                  <span className="w-[7.25rem] shrink-0 truncate text-right text-sm font-semibold sm:w-40">
                    <span className="sm:hidden">{short(b)}</span>
                    <span className="hidden sm:inline">{b}</span>
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div
                      className="h-full min-h-[22px] rounded-full"
                      style={{ width: `${(v / max) * 78}%`, background: brandColor(wi.brands, b) }}
                    />
                    <span className="figures shrink-0 text-xs font-semibold text-ink-muted sm:text-sm">
                      {mw(v)}
                      {total > 0 && <span className="hidden sm:inline"> · {Math.round((v / total) * 100)}%</span>}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Manufacturer names as registered, grouped into brands (e.g. REpower and Senvion, Siemens
        and Gamesa). {Math.round(wi.unattributed_share * 1000) / 10}% of capacity has no clear maker
        and is counted as “other”. The fleet counts turbines in operation each year, after
        retirements.
      </p>
    </div>
  );
}

// --- Market share of new turbines ------------------------------------------

export function BrandShares({ data }: { data: MonitorData }) {
  const wi = data.stats.wind_industry;
  const top = wi.brands.filter((b) => b !== OTHER).slice(0, 6);
  const rows = useMemo(() => {
    const out: { year: number; brand: string; share: number }[] = [];
    wi.years.forEach((y, i) => {
      if (y < 2000) return;
      const sum = wi.brands.reduce((s, b) => s + wi.added_mw[b][i], 0) || 1;
      let rest = 0;
      for (const b of wi.brands) {
        if (top.includes(b)) out.push({ year: y, brand: b, share: wi.added_mw[b][i] / sum });
        else rest += wi.added_mw[b][i];
      }
      out.push({ year: y, brand: OTHER, share: rest / sum });
    });
    return out;
  }, [wi, top]);
  const order = [...top, OTHER];
  const lastYear = wi.years.at(-1)!;
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Share of new onshore capacity per year</p>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {order.map((b) => (
          <span key={b} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: brandColor(wi.brands, b) }} />
            {b === OTHER ? "Other makers" : b}
          </span>
        ))}
      </div>
      <PlotFigure
        deps={[rows]}
        render={(width) =>
          Plot.plot({
            width,
            height: 260,
            marginLeft: 40,
            ...axis(),
            x: { label: null, tickFormat: (d: number) => String(d) },
            y: { label: null, percent: true, tickFormat: (d: number) => `${d}%`, grid: true },
            color: { domain: order, range: order.map((b) => brandColor(wi.brands, b)) },
            marks: [
              Plot.areaY(rows, { x: "year", y: "share", fill: "brand", order, stroke: cssVar("--paper"), strokeWidth: 0.5 }),
              Plot.tip(
                rows,
                Plot.pointerX(
                  Plot.stackY({
                    x: "year",
                    y: "share",
                    z: "brand",
                    order,
                    title: (d: { year: number; brand: string; share: number }) =>
                      `${d.year} · ${d.brand}: ${Math.round(d.share * 100)}%${d.year === lastYear ? " (so far)" : ""}`,
                  }),
                ),
              ),
            ],
          })
        }
      />
      <p className="mt-2 text-xs text-ink-muted">The {lastYear} shares are based on the turbines registered so far.</p>
    </div>
  );
}

// --- Models and sizes -------------------------------------------------------

export function TurbineModels({ data }: { data: MonitorData }) {
  const wi = data.stats.wind_industry;
  const models = wi.recent_models.slice(0, 10);
  const maxMw = Math.max(...models.map((m) => m.mw), 1);
  const [metric, setMetric] = useState<"avg_mw" | "avg_hub_height_m" | "avg_rotor_diameter_m">("avg_rotor_diameter_m");
  const specBrands = Object.keys(wi.brand_specs);
  const lastYear = wi.years.at(-1)!; // still running: left out
  const rows = useMemo(
    () =>
      specBrands.flatMap((b) => {
        const s = wi.brand_specs[b];
        return s.years
          .map((y, i) => ({ brand: b, year: y, v: s[metric][i] }))
          .filter((r) => r.v != null && r.year < lastYear) as { brand: string; year: number; v: number }[];
      }),
    [wi, metric, specBrands, lastYear],
  );
  const unit = metric === "avg_mw" ? "MW" : "m";
  // Direct labels at each line's last full year, nudged apart so they don't overlap.
  const yMax = Math.max(...rows.map((r) => r.v), 1);
  const ends = (
    specBrands
      .map((b) => rows.filter((r) => r.brand === b).at(-1))
      .filter(Boolean) as { brand: string; year: number; v: number }[]
  )
    .sort((a, b) => b.v - a.v)
    .map((e) => ({ ...e, ly: e.v }));
  for (let i = 1; i < ends.length; i++) {
    const gap = yMax * 0.065;
    if (ends[i - 1].year === ends[i].year && ends[i - 1].ly - ends[i].ly < gap) ends[i].ly = ends[i - 1].ly - gap;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold">Most-built models since {wi.recent_models_since}</p>
        <ol className="mt-3 divide-y divide-rule border-y border-rule">
          {models.map((m, i) => (
            <li key={`${m.brand}-${m.model}`} className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-x-3 py-2.5">
              <span className="figures text-sm text-ink-muted">{i + 1}</span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-bold">
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: brandColor(wi.brands, m.brand) }} />
                  <span className="truncate">
                    {m.model} <span className="font-normal text-ink-muted">· {m.brand}</span>
                  </span>
                </p>
                <div className="mt-1.5 h-1.5 rounded-full bg-surface">
                  <div className="h-full rounded-full" style={{ width: `${(m.mw / maxMw) * 100}%`, background: brandColor(wi.brands, m.brand) }} />
                </div>
                <p className="figures mt-1 text-xs text-ink-muted">
                  {m.avg_mw.toFixed(1)} MW each
                  {m.avg_hub_height_m != null && ` · hub ${m.avg_hub_height_m} m`}
                  {m.avg_rotor_diameter_m != null && ` · rotor ${m.avg_rotor_diameter_m} m`}
                </p>
              </div>
              <div className="text-right">
                <p className="figures font-extrabold">{mw(m.mw)}</p>
                <p className="figures text-xs text-ink-muted">{m.units.toLocaleString("en-GB")} units</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-ink-muted">
          Models grouped by rotor size (e.g. all V162 variants). Turbines whose model name gives no
          size are left out of this list.
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold">Average new turbine per maker</p>
        <div className="mt-3">
          <Segmented
            label="Measure"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "avg_rotor_diameter_m", label: "Rotor" },
              { value: "avg_hub_height_m", label: "Hub height" },
              { value: "avg_mw", label: "Capacity" },
            ]}
          />
        </div>
        <PlotFigure
          deps={[rows, metric]}
          render={(width) =>
            Plot.plot({
              width,
              height: 300,
              marginLeft: 40,
              marginRight: 70,
              ...axis(),
              x: { label: null, tickFormat: (d: number) => String(d) },
              y: { label: `${unit}`, grid: true, zero: true },
              color: { domain: specBrands, range: specBrands.map((b) => brandColor(wi.brands, b)) },
              marks: [
                Plot.lineY(rows, { x: "year", y: "v", stroke: "brand", strokeWidth: 2.5, curve: "monotone-x" }),
                Plot.text(ends, {
                  x: "year",
                  y: "ly",
                  text: (d: { brand: string }) => short(d.brand),
                  fill: "brand",
                  dx: 6,
                  textAnchor: "start",
                  fontWeight: 700,
                }),
                Plot.tip(
                  rows,
                  Plot.pointer({
                    x: "year",
                    y: "v",
                    title: (d: { brand: string; year: number; v: number }) => `${d.brand} ${d.year}: ${d.v} ${unit}`,
                  }),
                ),
              ],
            })
          }
        />
        <p className="mt-2 text-xs text-ink-muted">
          The five makers that built most since 2015; years since 2005 with at least 10 new turbines. Labels may overlap
          where makers build the same size; tap a line for values. {lastYear} is left out until the year is complete.
        </p>
      </div>
    </div>
  );
}
