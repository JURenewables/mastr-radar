"use client";

// Generic animated bar chart race: names ranked by value, one frame per step
// (year), values interpolated between frames so bars grow smoothly.
import { useEffect, useRef, useState, type ReactNode } from "react";

import { mw } from "@/lib/monitor";

import { prefersReducedMotion } from "./canvasMap";

const ROW_H = 34;

export function BarRace({
  steps,
  names,
  values,
  colorOf,
  labelOf = (n) => n,
  rows = 10,
  totalLabel,
  pinned = [],
  controls,
  msPerStep = 900,
  ariaLabel,
}: {
  steps: string[];
  names: string[];
  /** MW per name and step. */
  values: Record<string, number[]>;
  colorOf: (name: string) => string;
  labelOf?: (name: string) => string;
  rows?: number;
  totalLabel: (step: string) => string;
  /** Names always shown (e.g. "Not attributed"), ranked with the rest. */
  pinned?: string[];
  controls?: ReactNode;
  msPerStep?: number;
  ariaLabel: string;
}) {
  const last = steps.length - 1;
  const [pos, setPos] = useState(last);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const speed = prefersReducedMotion() ? msPerStep * 2 : msPerStep;
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
  }, [playing, last, msPerStep]);

  const i0 = Math.floor(pos);
  const i1 = Math.min(last, i0 + 1);
  const f = pos - i0;
  const all = names.map((n) => ({ name: n, v: (values[n]?.[i0] ?? 0) * (1 - f) + (values[n]?.[i1] ?? 0) * f }));
  const total = all.reduce((s, r) => s + r.v, 0);
  const ranked = [...all].sort((a, b) => b.v - a.v);
  const shown = [...ranked.filter((r) => !pinned.includes(r.name)).slice(0, rows - pinned.length), ...ranked.filter((r) => pinned.includes(r.name))].sort((a, b) => b.v - a.v);
  const rank = new Map(shown.map((r, i) => [r.name, i]));
  const max = Math.max(shown[0]?.v ?? 0, 1);
  const step = steps[f > 0.5 ? i1 : i0];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {controls}
        <button
          type="button"
          onClick={() => {
            if (playing) return setPlaying(false);
            if (pos >= last) setPos(0);
            setPlaying(true);
          }}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white"
        >
          {playing ? "❚❚ Pause" : `▶ Play ${steps[0]}–${steps[last]}`}
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={last}
        step={1}
        value={Math.round(pos)}
        aria-label="Step"
        onChange={(e) => {
          setPlaying(false);
          setPos(Number(e.target.value));
        }}
        className="mt-4 w-full accent-[var(--accent)]"
      />
      <div className="mt-3 rounded-[20px] bg-surface p-4 sm:p-6">
        <div className="flex items-start justify-between">
          <p className="figures text-5xl font-extrabold tracking-tighter sm:text-7xl">{step}</p>
          <div className="text-right">
            <p className="figures text-2xl font-extrabold tracking-tight sm:text-3xl">{mw(total)}</p>
            <p className="text-xs text-ink-muted">{totalLabel(step)}</p>
          </div>
        </div>
        <div
          className="relative mt-4"
          style={{ height: rows * ROW_H }}
          role="img"
          aria-label={`${ariaLabel}, ${step}: ${shown.slice(0, 5).map((r) => `${labelOf(r.name)} ${mw(r.v)}`).join(", ")}`}
        >
          {names.map((n) => {
            const r = rank.get(n);
            const v = all.find((x) => x.name === n)!.v;
            const visible = r !== undefined && v > 0.5;
            return (
              <div
                key={n}
                aria-hidden
                className="absolute inset-x-0 flex items-center gap-2 transition-[transform,opacity] duration-500 ease-out"
                style={{ height: ROW_H - 6, transform: `translateY(${(r ?? rows) * ROW_H}px)`, opacity: visible ? 1 : 0 }}
              >
                <span className="w-[7.25rem] shrink-0 truncate text-right text-sm font-semibold sm:w-44">{labelOf(n)}</span>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="h-full min-h-[22px] rounded-full" style={{ width: `${(v / max) * 76}%`, background: colorOf(n) }} />
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
    </div>
  );
}
