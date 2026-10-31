"use client";

import * as Plot from "@observablehq/plot";
import { geoCentroid } from "d3-geo";
import { interpolateRgb } from "d3-interpolate";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import {
  GEN_LABELS,
  GEN_TECHS,
  nearest,
  REGIONS,
  RENEWABLE,
  slotTime,
  STATE_TO_TSO,
  useDay,
  useDayIndex,
  windFactor,
  type DayFile,
  type GenTech,
  type Region,
  type Stations,
} from "@/lib/day";
import type { MonitorData } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

import { prefersReducedMotion, projectGermany, setupCanvas, type DistrictShape } from "./canvasMap";
import { Segmented } from "./ui";

type MapMode = "share" | "solar" | "wind";

const TECH_COLOR: Record<GenTech, () => string> = {
  solar: () => cssVar("--tech-solar"),
  wind_onshore: () => cssVar("--tech-wind-onshore"),
  wind_offshore: () => cssVar("--tech-wind-offshore"),
  biomass: () => cssVar("--tech-biomass"),
  hydro: () => cssVar("--tech-hydro"),
  other_renewable: () => "#7fc8a9",
  pumped_storage: () => cssVar("--tech-storage"),
  gas: () => "#b3b9c4",
  hard_coal: () => "#5b6370",
  lignite: () => "#8a7462",
  other_conventional: () => "#d5d9df",
};
const REGION_LABEL: Record<Region, string> = {
  DE: "Germany",
  "50Hertz": "50Hertz",
  Amprion: "Amprion",
  TenneT: "TenneT",
  TransnetBW: "TransnetBW",
};
const gw = (mw: number) => `${(mw / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} GW`;
const v = (x: number | null | undefined) => x ?? 0;

/** Estimated MW per district for every quarter hour (solar or onshore wind). */
function estimate(
  day: DayFile,
  stations: Stations,
  data: MonitorData,
  tech: "solar" | "wind_onshore",
): { keys: string[]; km2: number[]; values: Float32Array[] } | null {
  const w = day.weather;
  if (!w) return null;
  const isSolar = tech === "solar";
  const ids = isSolar ? w.solar_stations : w.wind_stations;
  const rows = isSolar ? w.radiation_wm2 : w.wind_dms;
  const coords = new Map((isSolar ? stations.solar : stations.wind).map((s) => [s[0], s]));
  const list = ids
    .map((id, row) => ({ c: coords.get(id), row }))
    .filter((s) => s.c)
    .map((s) => ({ lat: s.c![1], lon: s.c![2], row: s.row }));
  const features = data.districts.features;
  const cap = data.buildout.district[tech] ?? {};
  const keys: string[] = [];
  const km2: number[] = [];
  const weights: { row: number; w: number }[][] = [];
  const capacity: number[] = [];
  for (const f of features) {
    const key = String(f.properties?.key);
    const c = cap[key]?.at(-1) ?? 0;
    const [lon, lat] = geoCentroid(f);
    keys.push(key);
    km2.push(Number(f.properties?.area_km2) || 1);
    capacity.push(c);
    weights.push(nearest(lat, lon, list));
  }
  const values: Float32Array[] = [];
  for (let slot = 0; slot < day.slots; slot++) {
    const hour = Math.min(w.hours - 1, Math.floor(slot / 4));
    const raw = new Float32Array(keys.length);
    const sums: Record<string, number> = {};
    for (let i = 0; i < keys.length; i++) {
      let local = 0;
      let wsum = 0;
      for (const n of weights[i]) {
        const x = rows[n.row][hour];
        if (x == null) continue;
        local += n.w * (isSolar ? x : windFactor(x / 10));
        wsum += n.w;
      }
      raw[i] = capacity[i] * (wsum ? local / wsum : 0);
      const tso = STATE_TO_TSO[keys[i].slice(0, 2)];
      if (tso) sums[tso] = (sums[tso] ?? 0) + raw[i];
    }
    const out = new Float32Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const tso = STATE_TO_TSO[keys[i].slice(0, 2)];
      const actual = tso ? v(day.generation_mw[tso][tech][slot]) : 0;
      out[i] = tso && sums[tso] > 0 ? (actual * raw[i]) / sums[tso] : 0;
    }
    values.push(out);
  }
  return { keys, km2, values };
}

function DayMap({
  data,
  day,
  stations,
  slot,
  mode,
}: {
  data: MonitorData;
  day: DayFile;
  stations: Stations;
  slot: number;
  mode: MapMode;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const layout = useRef<{ ctx: CanvasRenderingContext2D; width: number; height: number; districts: DistrictShape[] } | null>(null);
  const [version, setVersion] = useState(0);
  const est = useMemo(
    () => (mode === "share" ? null : estimate(day, stations, data, mode === "solar" ? "solar" : "wind_onshore")),
    [day, stations, data, mode],
  );
  // Scale: 95th percentile of the day's peak density, so one city doesn't flatten the rest.
  const top = useMemo(() => {
    if (!est) return 1;
    const peaks = est.keys.map((_, i) => Math.max(...est.values.map((row) => row[i])) / est.km2[i]).sort((a, b) => a - b);
    return peaks[Math.floor(peaks.length * 0.95)] || 1;
  }, [est]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const doLayout = () => {
      const { ctx, width, height } = setupCanvas(canvas, 640);
      const { districts } = projectGermany(data.districts, width, height, 56);
      layout.current = { ctx, width, height, districts };
      setVersion((x) => x + 1);
    };
    doLayout();
    const ro = new ResizeObserver(doLayout);
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, [data.districts]);

  useEffect(() => {
    const L = layout.current;
    if (!L) return;
    const { ctx, width, height, districts } = L;
    const base = cssVar("--map-base");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);
    const shareColor = interpolateRgb(cssVar("--surface"), cssVar("--tech-biomass"));
    const color = interpolateRgb(base, mode === "solar" ? cssVar("--tech-solar") : cssVar("--tech-wind-onshore"));
    districts.forEach((d, i) => {
      if (mode === "share") {
        const tso = STATE_TO_TSO[d.key.slice(0, 2)];
        const demand = tso ? v(day.demand_mw[tso][slot]) : 0;
        const re = tso ? RENEWABLE.reduce((s, t) => s + v(day.generation_mw[tso][t][slot]), 0) : 0;
        ctx.fillStyle = shareColor(demand ? Math.min(1, re / demand) : 0);
      } else if (est) {
        ctx.fillStyle = color(Math.min(1, Math.sqrt(est.values[slot][i] / est.km2[i] / top)) * 0.95);
      }
      ctx.fill(d.path);
      ctx.strokeStyle = cssVar("--map-line");
      ctx.lineWidth = 0.4;
      ctx.stroke(d.path);
    });
  }, [version, day, slot, mode, est, top]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={
        mode === "share"
          ? "Map of the four grid areas coloured by renewable share of demand at the selected time"
          : `Map of districts: estimated ${mode} output at the selected time`
      }
      className="block w-full"
    />
  );
}

export function Day24({ data, asOf }: { data: MonitorData; asOf: string }) {
  const meta = useDayIndex(asOf);
  const [date, setDate] = useState<string | null>(null);
  const current = date ?? meta?.index.last ?? null;
  const day = useDay(current);
  const [slot, setSlot] = useState(48);
  const [playing, setPlaying] = useState(false);
  const [region, setRegion] = useState<Region>("DE");
  const [mode, setMode] = useState<MapMode>("solar");
  const maxSlot = (day?.slots ?? 96) - 1;
  const safeSlot = Math.min(slot, maxSlot);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(
      () =>
        setSlot((s) => {
          if (s >= maxSlot) {
            setPlaying(false);
            return maxSlot;
          }
          return s + 1;
        }),
      prefersReducedMotion() ? 400 : 140,
    );
    return () => clearInterval(t);
  }, [playing, maxSlot]);

  const rows = useMemo(() => {
    if (!day) return [];
    return GEN_TECHS.flatMap((t) =>
      day.generation_mw[region][t].map((mw, i) => ({ slot: i, tech: GEN_LABELS[t], gw: v(mw) / 1000 })),
    );
  }, [day, region]);
  const demand = useMemo(
    () => (day ? day.demand_mw[region].map((mw, i) => ({ slot: i, gw: v(mw) / 1000 })) : []),
    [day, region],
  );

  if (!meta) return <div className="h-64 rounded-[20px] bg-surface" />;
  const dates = meta.index.dates;
  const pos = current ? dates.indexOf(current) : -1;
  const step = (n: number) => {
    const next = dates[pos + n];
    if (next) setDate(next);
  };

  const now = day
    ? {
        demand: v(day.demand_mw.DE[safeSlot]),
        solar: v(day.generation_mw.DE.solar[safeSlot]),
        wind: v(day.generation_mw.DE.wind_onshore[safeSlot]) + v(day.generation_mw.DE.wind_offshore[safeSlot]),
        re: RENEWABLE.reduce((s, t) => s + v(day.generation_mw.DE[t][safeSlot]), 0),
      }
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => step(-1)} disabled={pos <= 0} className="rounded-full border border-rule px-3 py-1.5 text-sm font-semibold disabled:opacity-40" aria-label="Previous day">
          ←
        </button>
        <input
          type="date"
          value={current ?? ""}
          min={meta.index.first}
          max={meta.index.last}
          onChange={(e) => dates.includes(e.target.value) && setDate(e.target.value)}
          className="rounded-full border border-rule bg-surface px-3 py-1.5 text-sm font-semibold"
          aria-label="Day"
        />
        <button type="button" onClick={() => step(1)} disabled={pos >= dates.length - 1} className="rounded-full border border-rule px-3 py-1.5 text-sm font-semibold disabled:opacity-40" aria-label="Next day">
          →
        </button>
        <button
          type="button"
          onClick={() => {
            if (playing) return setPlaying(false);
            setSlot(0);
            setPlaying(true);
          }}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white"
        >
          {playing ? "❚❚ Pause" : "▶ Play the day"}
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={maxSlot}
        value={safeSlot}
        onChange={(e) => {
          setPlaying(false);
          setSlot(Number(e.target.value));
        }}
        aria-label="Time of day"
        className="w-full accent-[var(--accent)]"
      />

      {day && now && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-[20px] bg-surface p-4">
            <p className="text-sm text-ink-muted">Time</p>
            <p className="figures text-2xl font-extrabold">{slotTime(day, safeSlot)}</p>
          </div>
          <div className="rounded-[20px] bg-surface p-4">
            <p className="text-sm text-ink-muted">Renewable share</p>
            <p className="figures text-2xl font-extrabold">{now.demand ? Math.round((now.re / now.demand) * 100) : 0}%</p>
            {now.re > now.demand && <p className="text-xs text-ink-muted">surplus exported or stored</p>}
          </div>
          <div className="rounded-[20px] bg-surface p-4">
            <p className="text-sm text-ink-muted">Solar · Wind</p>
            <p className="figures text-2xl font-extrabold">
              {gw(now.solar)} · {gw(now.wind)}
            </p>
          </div>
          <div className="rounded-[20px] bg-surface p-4">
            <p className="text-sm text-ink-muted">Demand</p>
            <p className="figures text-2xl font-extrabold">{gw(now.demand)}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <Segmented label="Map" value={mode} onChange={setMode} options={[
            { value: "solar", label: "Solar (estimate)" },
            { value: "wind", label: "Wind (estimate)" },
            { value: "share", label: "Renewable share" },
          ]} />
          <div className="overflow-hidden rounded-[20px] border border-rule">
            {day ? <DayMap data={data} day={day} stations={meta.stations} slot={safeSlot} mode={mode} /> : <div className="h-96 bg-surface" />}
          </div>
          <p className="text-xs text-ink-muted">
            {mode === "share"
              ? "The four grid areas (approximated by state borders), coloured by renewable share of demand."
              : `Estimate: installed ${mode === "solar" ? "solar" : "onshore wind"} capacity per district × measured ${mode === "solar" ? "sunshine" : "wind"} at the nearest DWD stations, scaled so each grid area matches its measured output. Offshore wind is not shown on the map.`}
          </p>
        </div>
        <div className="min-w-0 space-y-3">
          <Segmented label="Area" value={region} onChange={setRegion} options={REGIONS.map((r) => ({ value: r, label: REGION_LABEL[r] }))} />
          {day ? (
            <PlotFigure
              deps={[rows, demand, safeSlot]}
              render={(width) =>
                Plot.plot({
                  width,
                  height: 320,
                  marginLeft: 44,
                  style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") },
                  x: {
                    label: null,
                    domain: [0, day.slots - 1],
                    ticks: Array.from({ length: Math.ceil(day.slots / 16) }, (_, i) => i * 16),
                    tickFormat: (s: number) => slotTime(day, s),
                  },
                  y: { label: null, grid: true, tickFormat: (d: number) => `${d} GW` },
                  color: { domain: GEN_TECHS.map((t) => GEN_LABELS[t]), range: GEN_TECHS.map((t) => TECH_COLOR[t]()) },
                  marks: [
                    Plot.areaY(rows, { x: "slot", y: "gw", fill: "tech", order: GEN_TECHS.map((t) => GEN_LABELS[t]), curve: "step" }),
                    Plot.lineY(demand, { x: "slot", y: "gw", stroke: cssVar("--ink"), strokeWidth: 2, strokeDasharray: "4,3" }),
                    Plot.ruleX([safeSlot], { stroke: cssVar("--ink"), strokeWidth: 1.5 }),
                  ],
                })
              }
            />
          ) : (
            <div className="h-80 rounded-[20px] bg-surface" />
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
            {GEN_TECHS.map((t) => (
              <span key={t} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TECH_COLOR[t]() }} />
                {GEN_LABELS[t]}
              </span>
            ))}
            <span>- - demand</span>
          </div>
        </div>
      </div>
    </div>
  );
}
