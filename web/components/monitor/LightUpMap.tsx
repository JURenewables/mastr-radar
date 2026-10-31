"use client";

import { interpolateRgb } from "d3-interpolate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { mw, type MonitorData } from "@/lib/monitor";
import { cssVar, TECH_CSS_VAR } from "@/lib/theme";
import type { Technology } from "@/lib/types";

import { darken, prefersReducedMotion, projectGermany, setupCanvas, type DistrictShape } from "./canvasMap";
import { Segmented } from "./ui";

type Choice = Technology | "all";
const CHOICES: { value: Choice; label: string }[] = [
  { value: "solar", label: "Solar" },
  { value: "wind_onshore", label: "Onshore wind" },
  { value: "wind_offshore", label: "Offshore" },
  { value: "storage", label: "Storage" },
  { value: "all", label: "All" },
];
const ALL: Technology[] = ["solar", "wind_onshore", "wind_offshore", "storage", "biomass", "hydro"];

export function LightUpMap({ data }: { data: MonitorData }) {
  const { buildout, points, districts: geo } = data;
  const years = buildout.years;
  const last = years.length - 1;
  const [choice, setChoice] = useState<Choice>("solar");
  const [idx, setIdx] = useState(last);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<{
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;
    districts: DistrictShape[];
    px: Float32Array;
    py: Float32Array;
  } | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const techs = useMemo<Technology[]>(() => (choice === "all" ? ALL : [choice]), [choice]);

  // Project once per size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const doLayout = () => {
      const { ctx, width, height } = setupCanvas(canvas);
      const { projection, districts } = projectGermany(geo, width, height);
      const n = points.operating.length / 5;
      const px = new Float32Array(n);
      const py = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const xy = projection([points.operating[i * 5] / 100, points.operating[i * 5 + 1] / 100]);
        px[i] = xy?.[0] ?? -99;
        py[i] = xy?.[1] ?? -99;
      }
      layoutRef.current = { ctx, width, height, districts, px, py };
      setLayoutVersion((v) => v + 1);
    };
    doLayout();
    const ro = new ResizeObserver(() => doLayout());
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, [geo, points]);

  const draw = useCallback(() => {
    const L = layoutRef.current;
    if (!L) return;
    const { ctx, width, height, districts, px, py } = L;
    const base = cssVar("--map-base");
    const line = cssVar("--map-line");
    const color = choice === "all" ? cssVar("--accent") : cssVar(TECH_CSS_VAR[choice]);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    // Districts: capacity per km², square-root scale against the 95th percentile of today.
    const value = (key: string, i: number) =>
      techs.reduce((s, t) => s + (buildout.district[t]?.[key]?.[i] ?? 0), 0);
    const finals = districts.map((d) => value(d.key, last) / d.km2).sort((a, b) => a - b);
    const top = finals[Math.floor(finals.length * 0.95)] || 1;
    const interp = interpolateRgb(base, color);
    for (const d of districts) {
      const t = Math.min(1, Math.sqrt(value(d.key, idx) / d.km2 / top));
      ctx.fillStyle = interp(t * 0.9);
      ctx.fill(d.path);
      ctx.strokeStyle = line;
      ctx.lineWidth = 0.5;
      ctx.stroke(d.path);
    }

    // Plants >= 1 MW: dots in a darker tone; new ones flash while playing.
    const P = points.operating;
    const want = new Set(techs.map((t) => points.techs.indexOf(t)));
    const yearOffset = years[idx] - points.first_year;
    const colors = points.techs.map((t) => darken(cssVar(TECH_CSS_VAR[t])));
    const scale = width / 700;
    for (let i = 0; i < px.length; i++) {
      const tech = P[i * 5 + 3];
      if (P[i * 5 + 2] > yearOffset || !want.has(tech)) continue;
      const fresh = playing && P[i * 5 + 2] === yearOffset;
      const r = Math.max(0.7, Math.sqrt(P[i * 5 + 4]) * 0.5 * scale) * (fresh ? 2 : 1);
      ctx.globalAlpha = fresh ? 1 : 0.6;
      ctx.fillStyle = fresh ? cssVar("--ink") : colors[tech];
      ctx.beginPath();
      ctx.arc(px[i], py[i], r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [buildout, points, techs, choice, idx, last, years, playing]);

  useEffect(() => {
    draw();
  }, [draw, layoutVersion]);

  // Redraw when light/dark mode changes.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => draw();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [draw]);

  // Playback: one year per tick.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setIdx((i) => {
          if (i >= last) {
            setPlaying(false);
            return last;
          }
          return i + 1;
        }),
      prefersReducedMotion() ? 700 : 300,
    );
    return () => clearInterval(timer);
  }, [playing, last]);

  const total = techs.reduce((s, t) => s + buildout.national[t].installed[idx], 0);
  const label = CHOICES.find((c) => c.value === choice)?.label ?? "";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Technology" value={choice} options={CHOICES} onChange={setChoice} />
        <button
          type="button"
          onClick={() => {
            if (playing) return setPlaying(false);
            setIdx(0);
            setPlaying(true);
          }}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white"
        >
          {playing ? "❚❚ Pause" : `▶ Play ${years[0]}–${years[last]}`}
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={last}
        value={idx}
        aria-label="Year"
        onChange={(e) => {
          setPlaying(false);
          setIdx(Number(e.target.value));
        }}
        className="mt-4 w-full accent-[var(--accent)]"
      />
      <div className="relative mt-3 overflow-hidden rounded-[20px] border border-rule bg-[var(--map-base)]">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Map of Germany: ${label} capacity by district and plants of 1 MW or more, ${years[idx]}`}
          className="block w-full"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4 sm:p-5">
          <p className="figures text-5xl font-extrabold tracking-tighter sm:text-7xl">{years[idx]}</p>
          <div className="text-right">
            <p className="figures text-2xl font-extrabold tracking-tight sm:text-3xl">{mw(total)}</p>
            <p className="text-xs text-ink-muted">{choice === "all" ? "all renewables" : label.toLowerCase()} installed</p>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Districts brighten with installed capacity per km² (every unit, including rooftops). Dots:
        plants of 1 MW or more with a public location; new ones flash in the year they go online.
      </p>
    </div>
  );
}
