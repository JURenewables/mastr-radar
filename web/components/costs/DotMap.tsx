"use client";

// Germany outline with coloured dots (projects or sites), drawn on canvas.
import { useEffect, useRef, useState } from "react";

import { projectGermany, setupCanvas } from "@/components/monitor/canvasMap";
import { cssVar } from "@/lib/theme";

export interface Dot {
  lon: number;
  lat: number;
  color: string;
  r?: number;
  /** Draw as a ring instead of a filled dot. */
  ring?: boolean;
}

export function DotMap({ geo, dots, label, maxHeight = 620 }: { geo: GeoJSON.FeatureCollection; dots: Dot[]; label: string; maxHeight?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(el);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setTick((t) => t + 1);
    mq.addEventListener("change", on);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", on);
    };
  }, []);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { ctx, width, height } = setupCanvas(c, maxHeight);
    const { projection, districts } = projectGermany(geo, width, height, 12);
    ctx.clearRect(0, 0, width, height);
    for (const d of districts) {
      ctx.fillStyle = cssVar("--surface");
      ctx.fill(d.path);
      ctx.strokeStyle = cssVar("--paper");
      ctx.lineWidth = 0.5;
      ctx.stroke(d.path);
    }
    for (const d of dots) {
      const xy = projection([d.lon, d.lat]);
      if (!xy) continue;
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], d.r ?? 2.2, 0, Math.PI * 2);
      if (d.ring) {
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else {
        ctx.fillStyle = d.color;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }, [geo, dots, tick, maxHeight]);
  return <canvas ref={ref} className="w-full" role="img" aria-label={label} />;
}

/** Diverging colour for a value around a centre (e.g. NPV around 0, IRR around the WACC). */
export function diverging(v: number, centre: number, span: number): string {
  const t = Math.max(-1, Math.min(1, (v - centre) / span));
  // red (#dc2626) ← grey (#a3a3a3) → blue (#1d4ed8)
  const mix = (a: number[], b: number[], f: number) => a.map((x, i) => Math.round(x + (b[i] - x) * f));
  const grey = [163, 163, 163];
  const c = t < 0 ? mix(grey, [220, 38, 38], -t) : mix(grey, [29, 78, 216], t);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
