"use client";

// Champions of the energy transition (contract v1.13, players.json → champions):
// scores per company group, adjustable weights, a 2×2 matrix and a ranking.
import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { Section } from "@/components/monitor/ui";
import { cssVar } from "@/lib/theme";

type Key = "scale" | "execution" | "momentum" | "breadth" | "efficiency";
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
    mw_per_employee: number | null;
    operating_mw_from_awards: number;
    flag: { momentum: string; why: string } | null;
  }[];
  segments: { name: string; type: string; category: string; employees: number; mw_on_ground: number; basis: string; segment_note: string | null; group_employees: number; group_mw: number; group_mw_per_employee: number; own_portfolio_mw: number | null; mw_per_employee: number; awarded_mw_3y: number; revenue_per_employee_k: number | null; currency: string | null }[];
}
export interface BatteryBuilder { owner: string; operating_mw: number; planned_mw: number; mwh: number; units: number; operators: number }

const KEYS: Key[] = ["scale", "execution", "momentum", "breadth", "efficiency"];
const SHORT: Record<Key, string> = { scale: "Scale", execution: "Execution", momentum: "Momentum", breadth: "Breadth", efficiency: "MW per staff" };
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
  const fastest = rows.filter((r) => r.awarded_mw_3y >= 300 && !r.flag).sort((a, b) => (b.scores.execution ?? 0) - (a.scores.execution ?? 0))[0];
  const matrix = rows.slice(0, 30).map((r) => ({ ...r, x: r.scores.scale ?? 0, y: r.scores.execution ?? 0, size: r.awarded_mw_3y }));
  const custom = KEYS.some((k) => w[k] !== c.weights[k]);
  return (
    <Section
      id="champions"
      eyebrow="Champions of the energy transition"
      title={`${leaders.join(", ")} lead the German energy transition on overall score; among the larger winners, ${fastest?.group ?? "–"} builds fastest`}
      subtitle="A management-consulting view of every company group active in the German wind and solar auctions: five scores, a total you can re-weight, and a 2×2 matrix of scale against speed of execution."
      asOf={asOf}
      source={<>Source: Bundesnetzagentur auction results, Marktstammdatenregister, company reports (financials, linked on the cards below), as of {asOf}. Scores by MaStR Radar.</>}
      takeaways={[
        "A champion wins a lot (scale, relative to the leader), builds fast (execution) and with few people (MW on the ground per employee). Specialised developers and IPPs dominate; the big utilities win comparatively little in German onshore wind and solar auctions.",
        "Utilities such as RWE and EnBW are large investors elsewhere (offshore wind, batteries, grids), but their German renewable auction wins are modest, so they score low here. Batteries are shown separately below.",
        "Flags matter: a strong auction record does not protect against a liquidity squeeze (see ABO Energy, Enerparc, BayWa r.e.).",
      ]}
      caveats={[
        c.method,
        "Efficiency uses company-reported capacity (often worldwide and including projects built for others) or, where none is reported, awarded MW in operation in Germany; staff counts are worldwide.",
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
          <p className="mb-2 text-sm font-semibold">Scale vs execution (top 30; size: MW awarded in 3 years)</p>
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
                x: { label: "Scale (leader = 100) →", domain: [0, 105] },
                y: { label: "↑ Execution score (faster)", domain: [0, 105] },
                r: { range: [3, 16] },
                marks: [
                  Plot.ruleX([50], { stroke: cssVar("--rule") }),
                  Plot.ruleY([50], { stroke: cssVar("--rule") }),
                  Plot.text([{ x: 100, y: 102, t: "Champions" }, { x: 100, y: 4, t: "Volume players" }], { x: "x", y: "y", text: "t", textAnchor: "end", fill: cssVar("--ink-muted"), fontSize: 11, fontWeight: 600 }),
                  Plot.text([{ x: 2, y: 102, t: "Fast, smaller" }, { x: 2, y: 4, t: "Niche" }], { x: "x", y: "y", text: "t", textAnchor: "start", fill: cssVar("--ink-muted"), fontSize: 11, fontWeight: 600 }),
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

const CAT_COLOR: Record<string, string> = {
  "Lean developer": "#2563eb",
  "Developer (broad services)": "#93c5fd",
  "IPP / owner-operator": "#8b5cf6",
  Investor: "#0d9488",
  "Utility, renewables segment": "#ef4444",
  "Utility, group total": "#fca5a5",
};

export function Segments({ c, asOf }: { c: ChampionsBlock; asOf: string }) {
  const seg = c.segments;
  const lean = seg.filter((x) => x.category === "Lean developer");
  const util = seg.filter((x) => x.category === "Utility, renewables segment");
  const groups = util.map((x) => ({ ...x, ge: x.group_employees, gm: x.group_mw }));
  const rev = seg.filter((x) => x.revenue_per_employee_k && x.currency === "EUR").sort((a, b) => (b.revenue_per_employee_k ?? 0) - (a.revenue_per_employee_k ?? 0));
  const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  const cats = [...new Set(seg.map((x) => x.category))];
  const guides = [0.5, 2, 5, 20].flatMap((k) => [{ k, e: 100, m: 100 * k }, { k, e: 40000, m: 40000 * k }]);
  return (
    <Section
      id="lean"
      eyebrow="Lean vs heavy"
      title={`Counting only their renewables staff, utilities reach ${med(util.map((x) => x.mw_per_employee)).toFixed(1)} MW per employee, close to lean developers at ${med(lean.map((x) => x.mw_per_employee)).toFixed(1)} MW`}
      subtitle="MW built or operated against employees. Utilities are placed with the staff and capacity of their renewables segment from the annual report; the faint dot and arrow show where the whole group would sit. Diagonal lines mark equal MW per employee."
      asOf={asOf}
      source={<>Sources: company reports and websites (staff, capacity), Bundesnetzagentur auction results and Marktstammdatenregister, as of {asOf}. Categories by MaStR Radar.</>}
      takeaways={[
        "Most utility staff work outside renewables: RWE has about 3,800 of 20,100 staff in onshore wind and solar, Vattenfall about 1,800 of 20,900 in wind. Measured on the whole group, utilities look two to four times heavier than they are in renewables.",
        "On a like-for-like basis the renewables arms of RWE and Vattenfall are nearly as lean as developers; the gap that remains reflects owning and operating large fleets.",
        "Business models differ in revenue too: trading and retail bring utilities far more revenue per employee than project sales bring developers (see the right-hand chart).",
        "Investors look leanest because the capacity sits in funds and is run by service companies whose staff are not counted.",
      ]}
      caveats={["Segments differ: RWE Onshore Wind/Solar and Vattenfall Wind are renewables only; EnBW's generation segment also includes thermal plants and trading. Uniper reports no renewables segment and is shown on group totals.", "Capacity definitions differ: built for others vs owned, worldwide vs Germany (see basis in the tooltip). Lean vs broad-services split at the developers' median. Revenue per employee only for companies reporting in euros."]}
    >
      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
      <div className="min-w-0">
      <PlotFigure
        deps={[seg]}
        height={420}
        render={(width) =>
          Plot.plot({
            width,
            height: 420,
            marginLeft: 56,
            marginBottom: 40,
            ...axis(),
            x: { type: "log", label: "Employees →", domain: [150, 40000] },
            y: { type: "log", label: "↑ MW on the ground", domain: [100, 60000] },
            color: { domain: cats, range: cats.map((k) => CAT_COLOR[k] ?? "#94a3b8"), legend: true },
            marks: [
              Plot.line(guides, { x: "e", y: "m", z: "k", stroke: cssVar("--rule"), strokeDasharray: "3,3" }),
              Plot.dot(groups, { x: "ge", y: "gm", r: 5, fill: "#fca5a5", fillOpacity: 0.5 }),
              Plot.arrow(groups, { x1: "ge", y1: "gm", x2: "employees", y2: "mw_on_ground", stroke: "#ef4444", strokeOpacity: 0.5, inset: 7, headLength: 6 }),
              Plot.text(groups, { x: "ge", y: "gm", text: (d: { name: string }) => `${d.name} group`, dy: 12, fontSize: 9, fill: cssVar("--ink-muted") }),
              Plot.text(guides.filter((g) => g.e === 40000 && g.m <= 60000), { x: "e", y: "m", text: (g: { k: number }) => `${g.k} MW/staff`, textAnchor: "end", dy: -6, fill: cssVar("--ink-muted"), fontSize: 10 }),
              Plot.dot(seg, { x: "employees", y: "mw_on_ground", fill: "category", r: 6, stroke: "white", tip: true, title: (x: { name: string; employees: number; mw_on_ground: number; mw_per_employee: number; basis: string }) => `${x.name}\n${x.employees.toLocaleString("en-GB")} staff · ${mw(x.mw_on_ground)}\n${x.mw_per_employee} MW per employee (${x.basis})` }),
              Plot.text(seg, { x: "employees", y: "mw_on_ground", text: "name", dy: -12, fontSize: 10, fill: "currentColor", stroke: cssVar("--paper"), strokeWidth: 3, paintOrder: "stroke" }),
            ],
          })
        }
      />
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-sm font-semibold">Revenue per employee (k€, whole company)</p>
        <ol className="space-y-1.5">
          {rev.map((x) => (
            <li key={x.name} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-sm">
              <span className="truncate">{x.name}</span>
              <span className="flex items-center gap-2"><span className="h-2.5 rounded-full" style={{ width: `${(Math.log10(x.revenue_per_employee_k!) / Math.log10(rev[0].revenue_per_employee_k!)) * 70}%`, background: CAT_COLOR[x.category] ?? "#94a3b8" }} /><span className="figures shrink-0 text-xs text-ink-muted">{x.revenue_per_employee_k!.toLocaleString("en-GB")}</span></span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-ink-muted">Log scale. Utilities: whole group (trading and retail included).</p>
      </div>
      </div>
    </Section>
  );
}

export function Batteries({ b, asOf }: { b: BatteryBuilder[]; asOf: string }) {
  const top = b.slice(0, 15);
  const max = Math.max(...top.map((x) => x.operating_mw + x.planned_mw), 1);
  return (
    <Section
      id="batteries"
      eyebrow="Who builds batteries"
      title={`${top[0]?.owner} and ${top[1]?.owner} lead the battery build-out: a different race from the renewable auctions`}
      subtitle="Large batteries (1 MW and more) in operation and planned, by owner name in the register. Batteries earn on the power market, not in EEG auctions, so utilities and specialist storage companies lead here."
      asOf={asOf}
      source={<>Source: Marktstammdatenregister, as of {asOf}. Data processed by MaStR Radar.</>}
      takeaways={[
        "Utilities convert old power-plant sites and grid connections into battery parks; specialist storage developers build many mid-sized projects through project companies.",
        "Most of the pipeline is still planned: registration in the register comes early, and not every planned battery will be built.",
      ]}
      caveats={["Grouped by company name; project companies of the same owner can appear separately, and owners that use neutral project-company names are not recognised.", "Batteries only (no pumped hydro); operator names only for companies."]}
    >
      <ol className="space-y-2">
        {top.map((x) => (
          <li key={x.owner} className="grid grid-cols-[9rem_1fr] items-center gap-3 text-sm sm:grid-cols-[13rem_1fr]">
            <span className="min-w-0"><span className="block truncate font-semibold">{x.owner}</span><span className="block text-[11px] text-ink-muted">{x.units} units · {Math.round(x.mwh).toLocaleString("en-GB")} MWh</span></span>
            <span className="flex items-center gap-2">
              <span className="flex h-3 overflow-hidden rounded-full" style={{ width: `${((x.operating_mw + x.planned_mw) / max) * 70}%` }}>
                <span style={{ width: `${(100 * x.operating_mw) / (x.operating_mw + x.planned_mw || 1)}%`, background: "#7c3aed" }} />
                <span style={{ flex: 1, background: "#c4b5fd" }} />
              </span>
              <span className="figures shrink-0 text-xs text-ink-muted">{mw(x.operating_mw)} + {mw(x.planned_mw)} planned</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-ink-muted">Dark: operating · light: planned</p>
    </Section>
  );
}
