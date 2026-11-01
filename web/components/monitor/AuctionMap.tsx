"use client";

// Auction maps (contract v1.6 draft):
// - AuctionMovie: every awarded project, round by round, so the movement shows.
// - CompanyMap: one company's awards, coloured by year, with a generated profile.
import { interpolateRgb } from "d3-interpolate";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { mw } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

import { roundLabel } from "./Auctions";
import { prefersReducedMotion, projectGermany, setupCanvas } from "./canvasMap";
import { Stat, Takeaways } from "./ui";
export { Stat };

type Pt = { lon: number; lat: number; mw: number; group: string | null; flh: number; ri: number; year: string };

/** What the maps need: award-level rounds and flat point arrays. */
export interface MapSource {
  rounds: { id: string; bid_date: string; list_awards: number; list_kw: number }[];
  points: { groups: string[]; rounds: Record<string, number[]> };
  /** Numbers per award in points (6 for wind, 7 for solar). */
  stride?: number;
  /** Label for the 6th number (full-load hours or specific yield). */
  valueLabel?: (v: number) => string;
}

function usePoints(a: MapSource) {
  return useMemo(() => {
    const out: Pt[] = [];
    const stride = a.stride ?? 6;
    a.rounds.forEach((r, ri) => {
      const P = a.points.rounds[r.id] ?? [];
      for (let i = 0; i < P.length; i += stride) {
        out.push({ lon: P[i] / 100, lat: P[i + 1] / 100, mw: P[i + 2] / 10, group: P[i + 4] >= 0 ? a.points.groups[P[i + 4]] : null, flh: P[i + 5], ri, year: r.bid_date.slice(0, 4) });
      }
    });
    return out;
  }, [a]);
}

/** Draws districts and dots; returns screen positions for hit-testing. */
function useMapCanvas(
  geo: GeoJSON.FeatureCollection,
  dots: { p: Pt; color: string; r: number; alpha: number }[],
  deps: unknown[],
) {
  const ref = useRef<HTMLCanvasElement>(null);
  const placed = useRef<{ p: Pt; x: number; y: number }[]>([]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const { ctx, width, height } = setupCanvas(canvas, 680);
      const { projection, districts } = projectGermany(geo, width, height, 16);
      ctx.fillStyle = cssVar("--map-base");
      ctx.fillRect(0, 0, width, height);
      for (const d of districts) {
        ctx.fillStyle = cssVar("--surface");
        ctx.fill(d.path);
        ctx.strokeStyle = cssVar("--rule");
        ctx.lineWidth = 0.7;
        ctx.stroke(d.path);
      }
      const k = width / 700;
      placed.current = [];
      for (const d of dots) {
        const xy = projection([d.p.lon, d.p.lat]);
        if (!xy) continue;
        ctx.globalAlpha = d.alpha;
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], Math.max(1.5, d.r * k), 0, Math.PI * 2);
        ctx.fillStyle = d.color;
        ctx.fill();
        placed.current.push({ p: d.p, x: xy[0], y: xy[1] });
      }
      ctx.globalAlpha = 1;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas.parentElement!);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", draw);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", draw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ref, placed };
}

function pickNearest(e: React.PointerEvent<HTMLCanvasElement>, placed: { p: Pt; x: number; y: number }[]) {
  const r = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  let best: Pt | null = null;
  let bd = 14 * 14;
  for (const q of placed) {
    const d = (q.x - x) ** 2 + (q.y - y) ** 2;
    if (d <= bd) {
      bd = d;
      best = q.p;
    }
  }
  return best;
}

function HoverCard({ a, p }: { a: MapSource; p: Pt }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-[16px] border border-rule bg-paper/95 p-3 text-sm shadow-sm sm:right-auto sm:max-w-xs">
      <p className="font-bold">{p.group ?? "Owner not known"}</p>
      <p className="figures text-ink-muted">
        {roundLabel(a.rounds[p.ri].bid_date)} · {p.mw.toLocaleString("en-GB", { maximumFractionDigits: 1 })} MW
        {p.flh > 0 && ` · ${a.valueLabel ? a.valueLabel(p.flh) : `≈ ${p.flh.toLocaleString("en-GB")} full-load hours`}`}
      </p>
    </div>
  );
}

// --- All awards, round by round ---------------------------------------------

export function AuctionMovie({ a, geo }: { a: MapSource; geo: GeoJSON.FeatureCollection }) {
  const all = usePoints(a);
  const last = a.rounds.length - 1;
  const [ri, setRi] = useState(last);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<Pt | null>(null);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(
      () =>
        setRi((i) => {
          if (i >= last) {
            setPlaying(false);
            return last;
          }
          return i + 1;
        }),
      prefersReducedMotion() ? 1400 : 650,
    );
    return () => clearInterval(t);
  }, [playing, last]);

  const accent = cssVar("--accent");
  const muted = cssVar("--ink-muted");
  const dots = useMemo(
    () =>
      all
        .filter((p) => p.ri <= ri)
        .sort((p, q) => (p.ri === ri ? 1 : 0) - (q.ri === ri ? 1 : 0))
        .map((p) => ({ p, color: p.ri === ri ? accent : muted, r: p.ri === ri ? Math.sqrt(p.mw) * 1.5 : 1.6, alpha: p.ri === ri ? 0.85 : 0.35 })),
    [all, ri, accent, muted],
  );
  const { ref, placed } = useMapCanvas(geo, dots, [geo, dots]);
  const round = a.rounds[ri];
  const cum = a.rounds.slice(0, ri + 1).reduce((s, r) => s + r.list_kw, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (playing) return setPlaying(false);
            if (ri >= last) setRi(0);
            setPlaying(true);
          }}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white"
        >
          {playing ? "❚❚ Pause" : `▶ Play ${roundLabel(a.rounds[0].bid_date)} – ${roundLabel(a.rounds[last].bid_date)}`}
        </button>
      </div>
      <input type="range" min={0} max={last} value={ri} aria-label="Auction round" onChange={(e) => { setPlaying(false); setRi(Number(e.target.value)); }} className="w-full accent-[var(--accent)]" />
      <div className="relative min-w-0 overflow-hidden rounded-[20px] border border-rule">
        <canvas
          ref={ref}
          onPointerMove={(e) => setHover(pickNearest(e, placed.current))}
          onPointerDown={(e) => setHover(pickNearest(e, placed.current))}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Map of onshore wind awards up to ${roundLabel(round.bid_date)}`}
          className="block w-full touch-manipulation"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4 sm:p-5">
          <div>
            <p className="figures text-4xl font-extrabold tracking-tighter sm:text-6xl">{roundLabel(round.bid_date)}</p>
            <p className="figures text-sm text-ink-muted">{round.list_awards} awards · {mw(round.list_kw / 1000)}</p>
          </div>
          <div className="text-right">
            <p className="figures text-2xl font-extrabold tracking-tight sm:text-3xl">{mw(cum / 1000)}</p>
            <p className="text-xs text-ink-muted">awarded since {a.rounds[0].bid_date.slice(0, 4)}</p>
          </div>
        </div>
        {hover && <HoverCard a={a} p={hover} />}
      </div>
      <p className="text-xs text-ink-muted">
        Blue: the awards of the selected round, sized by capacity. Grey: all earlier awards since {roundLabel(a.rounds[0].bid_date)}.
        Only awards of companies have a public location.
      </p>
    </div>
  );
}

// --- One company, coloured by year ------------------------------------------

export function yearColors(years: string[]): Record<string, string> {
  const pale = "#bcd0f7";
  const deep = "#1d3fb8";
  const out: Record<string, string> = {};
  years.forEach((y, i) => {
    out[y] = interpolateRgb(pale, deep)(years.length > 1 ? i / (years.length - 1) : 1);
  });
  out[years.at(-1)!] = "#f97316"; // the running year stands out
  return out;
}

export interface MapProfile {
  group: string;
  kw_by_year: number[];
  awards: number;
  rounds: number;
}

export function CompanyMap<P extends MapProfile>({
  a,
  geo,
  profiles,
  years,
  takeaways,
  stats,
}: {
  a: MapSource;
  geo: GeoJSON.FeatureCollection;
  profiles: P[];
  years: string[];
  takeaways: (p: P) => { points: ReactNode[]; caveats: ReactNode[] };
  stats: (p: P) => ReactNode;
}) {
  const all = usePoints(a);
  const [group, setGroup] = useState(profiles[0]?.group ?? "");
  const [hover, setHover] = useState<Pt | null>(null);
  const colors = useMemo(() => yearColors(years), [years]);
  const [hiddenYears, setHiddenYears] = useState<string[]>([]);
  const mine = useMemo(() => all.filter((p) => p.group === group && !hiddenYears.includes(p.year)).sort((p, q) => p.ri - q.ri), [all, group, hiddenYears]);
  const dots = useMemo(() => mine.map((p) => ({ p, color: colors[p.year], r: Math.sqrt(p.mw) * 1.7, alpha: 0.9 })), [mine, colors]);
  const { ref, placed } = useMapCanvas(geo, dots, [geo, dots]);
  const prof = profiles.find((p) => p.group === group);
  const t = prof ? takeaways(prof) : { points: [], caveats: [] };
  const total = prof ? prof.kw_by_year.reduce((s, v) => s + v, 0) : 0;
  return (
    <div className="space-y-4">
      <label className="inline-flex items-center gap-2 text-sm font-semibold">
        Company
        <select value={group} onChange={(e) => { setGroup(e.target.value); setHover(null); setHiddenYears([]); }} className="max-w-[16rem] rounded-full border border-rule bg-surface px-3 py-1.5 text-sm font-semibold">
          {profiles.map((p) => (
            <option key={p.group} value={p.group}>{p.group}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show years">
        {years.map((y, i) => {
          const on = !hiddenYears.includes(y);
          const v = prof?.kw_by_year[i] ?? 0;
          return (
            <button
              key={y}
              type="button"
              aria-pressed={on}
              onClick={() => setHiddenYears((h) => (on ? [...h, y] : h.filter((x) => x !== y)))}
              className={`figures inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-ink text-ink" : "border-rule text-ink-muted line-through"}`}
            >
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: colors[y] }} />
              {y}
              <span className="font-normal text-ink-muted">{v ? mw(v / 1000, 0) : "–"}</span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="relative min-w-0 overflow-hidden rounded-[20px] border border-rule">
          <canvas
            ref={ref}
            onPointerMove={(e) => setHover(pickNearest(e, placed.current))}
            onPointerDown={(e) => setHover(pickNearest(e, placed.current))}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label={`Map of ${group}'s onshore wind awards since 2019, coloured by year`}
            className="block w-full touch-manipulation"
          />
          <div className="pointer-events-none absolute left-4 top-4">
            <p className="text-2xl font-extrabold tracking-tight sm:text-3xl">{group}</p>
            <p className="figures text-sm text-ink-muted">{mine.length} awards on the map</p>
          </div>
          {hover && <HoverCard a={a} p={hover} />}
        </div>
        {prof && (
          <div className="grid content-start grid-cols-2 gap-3">
            <Stat label="Awarded" value={mw(total / 1000)} sub={`${prof.awards} awards in ${prof.rounds} of ${a.rounds.length} rounds`} />
            {stats(prof)}
          </div>
        )}
      </div>
      <Takeaways points={t.points} caveats={t.caveats} />
    </div>
  );
}
