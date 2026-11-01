"use client";

// Map of awarded onshore wind projects (contract v1.6 draft): pick a round or
// all rounds; dots sized by capacity, coloured by bidder type. Tap a dot for details.
import { useEffect, useMemo, useRef, useState } from "react";

import { mw, type AuctionCategory, type Auctions } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

import { CATEGORY_COLOR, CATEGORY_ORDER, roundLabel } from "./Auctions";
import { projectGermany, setupCanvas } from "./canvasMap";

type Pt = { lon: number; lat: number; mw: number; cat: AuctionCategory; group: string | null; flh: number; round: string; x?: number; y?: number };

export function AuctionMap({ a, geo }: { a: Auctions; geo: GeoJSON.FeatureCollection }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [round, setRound] = useState(a.rounds.at(-1)!.id);
  const [hidden, setHidden] = useState<AuctionCategory[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [group, setGroup] = useState("");
  const pts = useMemo(() => {
    const ids = round === "all" ? a.rounds.map((r) => r.id) : [round];
    const out: Pt[] = [];
    for (const id of ids) {
      const P = a.points.rounds[id] ?? [];
      for (let i = 0; i < P.length; i += 6) {
        out.push({
          lon: P[i] / 100,
          lat: P[i + 1] / 100,
          mw: P[i + 2] / 10,
          cat: CATEGORY_ORDER[P[i + 3]],
          group: P[i + 4] >= 0 ? a.points.groups[P[i + 4]] : null,
          flh: P[i + 5],
          round: id,
        });
      }
    }
    return out.filter((p) => !hidden.includes(p.cat) && (!group || p.group === group));
  }, [a, round, hidden, group]);
  const shownRef = useRef<Pt[]>([]);

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
      const scale = (width / 700) * (round === "all" ? 0.6 : 1);
      const sorted = [...pts].sort((p, q) => q.mw - p.mw); // big first, small on top
      for (const p of sorted) {
        const xy = projection([p.lon, p.lat]);
        if (!xy) continue;
        p.x = xy[0];
        p.y = xy[1];
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], Math.max(2, Math.sqrt(p.mw) * 1.6 * scale), 0, Math.PI * 2);
        ctx.fillStyle = CATEGORY_COLOR[p.cat];
        ctx.globalAlpha = 0.8;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = cssVar("--paper");
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      shownRef.current = sorted;
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
  }, [geo, pts, round]);

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best: Pt | null = null;
    let bd = 14 * 14;
    for (const p of shownRef.current) {
      if (p.x == null || p.y == null) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    setHover(best);
  };

  const total = pts.reduce((s, p) => s + p.mw, 0);
  const groups = useMemo(() => [...a.points.groups].filter((g) => !["Not attributed"].includes(g)).sort((x, y) => x.localeCompare(y)), [a]);
  const roundRow = round === "all" ? null : a.rounds.find((r) => r.id === round);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm font-semibold">
          Round
          <select value={round} onChange={(e) => { setRound(e.target.value); setHover(null); }} className="rounded-full border border-rule bg-surface px-3 py-1.5 text-sm font-semibold">
            {[...a.rounds].reverse().map((r) => (
              <option key={r.id} value={r.id}>{roundLabel(r.bid_date)}</option>
            ))}
            <option value="all">All since {a.rounds[0].bid_date.slice(0, 4)}</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-sm font-semibold">
          Company
          <select value={group} onChange={(e) => { setGroup(e.target.value); setHover(null); }} className="max-w-[12rem] rounded-full border border-rule bg-surface px-3 py-1.5 text-sm font-semibold">
            <option value="">All</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show bidder types">
        {CATEGORY_ORDER.map((c) => {
          const on = !hidden.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => setHidden((h) => (on ? [...h, c] : h.filter((x) => x !== c)))}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-ink text-ink" : "border-rule text-ink-muted line-through"}`}
            >
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
              {a.categories[c]}
            </button>
          );
        })}
      </div>
      <div className="relative min-w-0 overflow-hidden rounded-[20px] border border-rule">
        <canvas
          ref={ref}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Map of ${pts.length} awarded onshore wind projects, ${round === "all" ? "all rounds" : roundLabel(roundRow!.bid_date)}, ${mw(total)}`}
          className="block w-full touch-manipulation"
        />
        <div className="pointer-events-none absolute left-4 top-4 sm:left-5 sm:top-5">
          <p className="figures text-3xl font-extrabold tracking-tight sm:text-5xl">{round === "all" ? `${a.rounds[0].bid_date.slice(0, 4)}–${a.rounds.at(-1)!.bid_date.slice(2, 4)}` : roundLabel(roundRow!.bid_date)}</p>
          <p className="figures text-sm text-ink-muted">{pts.length.toLocaleString("en-GB")} awards · {mw(total)}</p>
        </div>
        {hover && (
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-[16px] border border-rule bg-paper/95 p-3 text-sm shadow-sm sm:right-auto sm:max-w-xs">
            <p className="font-bold">{hover.group ?? "Owner not known"}</p>
            <p className="text-ink-muted">
              {a.categories[hover.cat]} · {roundLabel(a.rounds.find((r) => r.id === hover.round)!.bid_date)}
            </p>
            <p className="figures mt-1">
              {hover.mw.toLocaleString("en-GB", { maximumFractionDigits: 1 })} MW
              {hover.flh > 0 && ` · ≈ ${hover.flh.toLocaleString("en-GB")} full-load hours`}
            </p>
          </div>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        Each dot is one award at the centre of its turbines, sized by capacity. Awards of bidders that
        are not companies have no public location and are not shown. Tap or hover a dot for details.
      </p>
    </div>
  );
}
