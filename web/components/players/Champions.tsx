"use client";

// Champions of the energy transition (contract v1.13, players.json → champions):
// scores per company group, adjustable weights, a 2×2 matrix and a ranking.
import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { Section } from "@/components/monitor/ui";
import { cssVar } from "@/lib/theme";

type Key = "scale" | "execution" | "breadth" | "momentum" | "financial";
export interface ChampionsBlock {
  weights: Record<Key, number>;
  labels: Record<Key, string>;
  method: string;
  rows: {
    group: string;
    scores: Record<Key, number | null>;
    total: number | null;
    awarded_mw_3y: number;
    wind_mw: number;
    solar_mw: number;
    innovation_mw: number;
    built_share: number | null;
    median_months_to_operation: number | null;
    momentum_ratio: number;
    technologies: string[];
    ebitda_margin: number | null;
    flag: { momentum: string; why: string } | null;
  }[];
}

const KEYS: Key[] = ["scale", "execution", "breadth", "momentum", "financial"];
const SHORT: Record<Key, string> = { scale: "Scale", execution: "Execution", breadth: "Breadth", momentum: "Momentum", financial: "Finance" };
const TECH: Record<string, { label: string; color: string }> = {
  wind: { label: "Wind", color: "#2563eb" },
  solar: { label: "Solar", color: "#f59e0b" },
  innovation: { label: "Solar+storage", color: "#d97706" },
  battery: { label: "Battery", color: "#8b5cf6" },
  hybrid: { label: "Hybrid site", color: "#0d9488" },
};
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const mw = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} GW` : `${Math.round(v)} MW`);

export function Champions({ c, asOf }: { c: ChampionsBlock; asOf: string }) {
  const [w, setW] = useState<Record<Key, number>>(c.weights);
  const rows = useMemo(() => {
    return c.rows
      .map((r) => {
        const known = KEYS.filter((k) => r.scores[k] != null && w[k] > 0);
        const ws = known.reduce((s, k) => s + w[k], 0);
        const total = ws ? Math.round(known.reduce((s, k) => s + (r.scores[k] as number) * w[k], 0) / ws) : 0;
        return { ...r, total };
      })
      .sort((a, b) => b.total - a.total);
  }, [c, w]);
  const top = rows.slice(0, 20);
  const leaders = top.filter((r) => !r.flag).slice(0, 3).map((r) => r.group);
  const matrix = rows.slice(0, 30).map((r) => ({ ...r, x: r.scores.scale ?? 0, y: r.scores.breadth ?? 0, size: r.awarded_mw_3y }));
  const custom = KEYS.some((k) => w[k] !== c.weights[k]);
  return (
    <Section
      id="champions"
      eyebrow="Champions of the energy transition"
      title={`${leaders.join(", ")} lead the German energy transition: big in the auctions, fast to build, and active in several technologies`}
      subtitle="A management-consulting view of every company group active in the German wind and solar auctions: five scores, a total you can re-weight, and a 2×2 matrix of scale against breadth."
      asOf={asOf}
      source={<>Source: Bundesnetzagentur auction results, Marktstammdatenregister, company reports (financials, linked on the cards below), as of {asOf}. Scores by MaStR Radar.</>}
      takeaways={[
        "A champion combines scale (awards), execution (speed from award to operation) and breadth (wind, solar, storage and hybrid sites). Pure wind specialists can be large but sit lower on breadth.",
        "Utilities that score well (e.g. RWE) do so on breadth and financial strength; the developer champions on scale and speed.",
        "Flags matter: a high score from the auction record does not protect against a liquidity squeeze (see ABO Energy, BayWa r.e., Enerparc).",
      ]}
      caveats={[
        c.method,
        "Financial strength counts only where an EBITDA figure is published; private developers such as wpd and UKA publish no group figures, so their total uses the other four scores.",
        "Execution measures the median months from award to operation of awards that are in operation; recent awards are not yet included.",
      ]}
    >
      <div className="rounded-[20px] border border-rule p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">Weights {custom && <span className="font-normal text-ink-muted">(your weights)</span>}</p>
          {custom && (
            <button type="button" onClick={() => setW(c.weights)} className="text-xs text-accent underline underline-offset-2">
              Reset
            </button>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          {KEYS.map((k) => (
            <label key={k} className="text-xs text-ink-muted">
              <span className="flex justify-between"><span>{SHORT[k]}</span><span className="figures text-ink">{w[k]}</span></span>
              <input type="range" min={0} max={50} step={5} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="mt-1 w-full accent-[var(--accent)]" aria-label={`Weight for ${c.labels[k]}`} />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div className="min-w-0">
          <p className="mb-2 text-sm font-semibold">Scale vs breadth (top 30; size: MW awarded in 3 years)</p>
          <PlotFigure
            deps={[matrix]}
            height={380}
            render={(width) =>
              Plot.plot({
                width,
                height: 380,
                marginLeft: 44,
                marginBottom: 40,
                ...axis(),
                x: { label: "Scale score →", domain: [0, 105] },
                y: { label: "↑ Breadth score", domain: [0, 105] },
                r: { range: [3, 16] },
                marks: [
                  Plot.ruleX([50], { stroke: cssVar("--rule") }),
                  Plot.ruleY([50], { stroke: cssVar("--rule") }),
                  Plot.text([{ x: 100, y: 102, t: "Champions" }, { x: 100, y: 4, t: "Volume players" }], { x: "x", y: "y", text: "t", textAnchor: "end", fill: cssVar("--ink-muted"), fontSize: 11, fontWeight: 600 }),
                  Plot.text([{ x: 2, y: 102, t: "Broad, smaller" }, { x: 2, y: 4, t: "Niche" }], { x: "x", y: "y", text: "t", textAnchor: "start", fill: cssVar("--ink-muted"), fontSize: 11, fontWeight: 600 }),
                  Plot.dot(matrix, { x: "x", y: "y", r: "size", fill: (d: { flag: unknown }) => (d.flag ? "#ef4444" : "#2563eb"), fillOpacity: 0.55, stroke: "white", tip: true, title: (d: { group: string; total: number; size: number }) => `${d.group}\ntotal ${d.total} · ${mw(d.size)} in 3 years` }),
                  Plot.text(matrix.slice(0, 8), { x: "x", y: "y", text: "group", dy: -14, fontSize: 10, fill: "currentColor", stroke: cssVar("--paper"), strokeWidth: 3, paintOrder: "stroke" }),
                ],
              })
            }
          />
          <p className="mt-1 text-xs text-ink-muted">Red: company in restructuring or transition.</p>
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-sm font-semibold">Ranking (top 20)</p>
          <ol className="space-y-2">
            {top.map((r, i) => (
              <li key={r.group} className="grid grid-cols-[1.5rem_1fr_2.5rem] items-center gap-2 text-sm">
                <span className="figures text-ink-muted">{i + 1}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{r.group}</span>
                    {r.flag && <span className="shrink-0 rounded-full bg-[#fee2e2] px-2 text-[10px] font-semibold text-[#b91c1c]" title={r.flag.why}>{r.flag.momentum === "stuck" ? "crisis" : "transition"}</span>}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {r.technologies.map((t) => (
                      <span key={t} className="rounded-full px-1.5 text-[10px] text-white" style={{ background: TECH[t]?.color ?? "#94a3b8" }}>{TECH[t]?.label ?? t}</span>
                    ))}
                    <span className="text-[10px] text-ink-muted">{mw(r.awarded_mw_3y)} · {r.median_months_to_operation ?? "–"} months</span>
                  </span>
                </span>
                <span className="figures text-right font-bold">{r.total}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-8 overflow-x-auto rounded-[20px] border border-rule">
        <table className="figures w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Group</th>
              {KEYS.map((k) => (<th key={k} className="px-3 py-2 font-semibold" title={c.labels[k]}>{SHORT[k]}</th>))}
              <th className="px-3 py-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.group} className="border-t border-rule">
                <td className="px-3 py-1.5 font-semibold">{r.group}</td>
                {KEYS.map((k) => (
                  <td key={k} className="px-3 py-1.5">
                    {r.scores[k] == null ? <span className="text-ink-muted">n/a</span> : (
                      <span className="flex items-center gap-1.5"><span className="h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${(r.scores[k] as number) * 0.5}px` }} />{r.scores[k]}</span>
                    )}
                  </td>
                ))}
                <td className="px-3 py-1.5 font-bold">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
