"use client";

// Profitability of awarded projects (contract v1.12, costs/profitability.json):
// estimated investment, revenue, IRR and value per award, by round and region.
import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useState } from "react";

import { DotMap, diverging } from "@/components/costs/DotMap";
import { PlotFigure } from "@/components/explorer/PlotFigure";
import { Loading, Section, Stat } from "@/components/monitor/ui";
import { cssVar } from "@/lib/theme";

type Q = { p25: number; median: number; p75: number; n: number } | null;
interface Summary { [k: string]: unknown; projects: number; bid_date?: string; round?: string; state?: string }
interface Block {
  projects: { fields: string[]; rows: (string | number | null)[][] };
  skipped: number;
  overall: Record<string, Q>;
  by_round: Summary[];
  by_state: Summary[];
  sensitivity: {
    representative: Record<string, number>;
    base: { project_irr: number | null; equity_irr: number | null; npv: number };
    cases: Record<string, { project_irr: number | null; equity_irr: number | null; npv: number }>;
    steps: { capex_pct: number; price_ct: number; rate_points: number };
  };
}
interface ProfitFile {
  as_of: string;
  assumptions: { wind: Record<string, unknown>; solar: Record<string, unknown>; notes: string[] };
  market: { period: [string, string]; last_12m: { baseload: number; solar: number; wind_onshore: number }; source: string } | null;
  wind: Block;
  solar: Block;
}
type Row = Record<string, number | string | null>;

const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const pct = (v: number | null | undefined, d = 1) => (v == null ? "–" : `${(v * 100).toFixed(d)} %`);
const n0 = (v: number) => Math.round(v).toLocaleString("en-GB");
const mon = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const med = (q: unknown) => (q as Q)?.median ?? null;

function rows(b: Block): Row[] {
  return b.projects.rows.map((r) => Object.fromEntries(b.projects.fields.map((f, i) => [f, r[i]])));
}

function RoundChart({ b, wacc, solar }: { b: Block; wacc: number; solar?: boolean }) {
  const data = b.by_round.filter((r) => med(r.project_irr) != null).map((r) => ({
    d: new Date(`${r.bid_date}T00:00:00`),
    lo: (r.project_irr as Q)!.p25,
    hi: (r.project_irr as Q)!.p75,
    base: med(r.project_irr)!,
    full: med(r.project_irr_full),
    low: solar ? med(r.project_irr_low_capex) : null,
    n: r.projects,
  }));
  const series = [
    ...data.map((x) => ({ d: x.d, v: x.base, s: "EEG award, 20 years" })),
    ...data.filter((x) => x.full != null).map((x) => ({ d: x.d, v: x.full!, s: solar ? "Full life (30 years)" : "Full life (25 years)" })),
    ...(solar ? data.filter((x) => x.low != null).map((x) => ({ d: x.d, v: x.low!, s: "Low investment (DEA)" })) : []),
  ];
  const names = [...new Set(series.map((s) => s.s))];
  return (
    <PlotFigure
      deps={[b, wacc]}
      render={(width) =>
        Plot.plot({
          width,
          height: 300,
          marginLeft: 44,
          ...axis(),
          x: { type: "utc", label: null },
          y: { label: "project IRR", grid: true, tickFormat: (v: number) => `${Math.round(v * 100)} %` },
          color: { domain: names, range: ["#1d4ed8", "#0d9488", "#c2410c"].slice(0, names.length), legend: true },
          marks: [
            Plot.areaY(data, { x: "d", y1: "lo", y2: "hi", fill: "#1d4ed8", fillOpacity: 0.1, curve: "step" }),
            Plot.ruleY([wacc], { stroke: cssVar("--ink-muted"), strokeDasharray: "4,3" }),
            Plot.text([wacc], { x: data[0]?.d, y: (v: number) => v, text: () => `cost of capital ${pct(wacc)}`, dy: -7, textAnchor: "start", fill: cssVar("--ink-muted"), fontSize: 11 }),
            Plot.ruleY([0]),
            Plot.line(series, { x: "d", y: "v", stroke: "s", strokeWidth: 2.2 }),
            Plot.dot(series, { x: "d", y: "v", fill: "s", r: 2.5, tip: true, title: (x: { d: Date; v: number; s: string }) => `${x.s}\n${x.d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}: median ${pct(x.v)}` }),
          ],
        })
      }
    />
  );
}

function CapexChart({ b, unit }: { b: Block; unit: string }) {
  const data = b.by_round.flatMap((r) => [
    { d: new Date(`${r.bid_date}T00:00:00`), v: med(r.capex), s: "Estimated investment" },
    { d: new Date(`${r.bid_date}T00:00:00`), v: med(r.max_capex), s: "Affordable at the cost of capital" },
  ]).filter((x) => x.v != null) as { d: Date; v: number; s: string }[];
  return (
    <PlotFigure
      deps={[b]}
      render={(width) =>
        Plot.plot({
          width,
          height: 280,
          marginLeft: 48,
          ...axis(),
          x: { type: "utc", label: null },
          y: { label: unit, grid: true, domain: [0, Math.max(...data.map((x) => x.v)) * 1.1] },
          color: { domain: ["Estimated investment", "Affordable at the cost of capital"], range: ["#64748b", "#1d4ed8"], legend: true },
          marks: [
            Plot.line(data, { x: "d", y: "v", stroke: "s", strokeWidth: 2.2 }),
            Plot.dot(data, { x: "d", y: "v", fill: "s", r: 2.5, tip: true, title: (x: { d: Date; v: number; s: string }) => `${x.s}: ${n0(x.v)} ${unit}` }),
          ],
        })
      }
    />
  );
}

function Tornado({ b, irrKey }: { b: Block; irrKey: "project_irr" }) {
  const s = b.sensitivity;
  const base = s.base[irrKey] ?? 0;
  const eqBase = s.base.equity_irr;
  const items = [
    { name: `Investment −${s.steps.capex_pct} %`, v: s.cases.capex_minus[irrKey] },
    { name: `Investment +${s.steps.capex_pct} %`, v: s.cases.capex_plus[irrKey] },
    { name: `Price +${s.steps.price_ct} ct`, v: s.cases.price_plus[irrKey] },
    { name: `Price −${s.steps.price_ct} ct`, v: s.cases.price_minus[irrKey] },
  ].map((x) => ({ ...x, delta: ((x.v ?? base) - base) * 100 }));
  const rate = eqBase != null && s.cases.rate_plus.equity_irr != null && s.cases.rate_minus.equity_irr != null
    ? [
        { name: `Interest −${s.steps.rate_points} pt (equity IRR)`, delta: (s.cases.rate_minus.equity_irr - eqBase) * 100 },
        { name: `Interest +${s.steps.rate_points} pt (equity IRR)`, delta: (s.cases.rate_plus.equity_irr - eqBase) * 100 },
      ]
    : [];
  const all = [...items, ...rate];
  return (
    <PlotFigure
      deps={[b]}
      render={(width) =>
        Plot.plot({
          width,
          height: 60 + all.length * 30,
          marginLeft: Math.min(230, width * 0.45),
          ...axis(),
          x: { label: "change in IRR (percentage points)", grid: true },
          y: { label: null, domain: all.map((x) => x.name) },
          marks: [
            Plot.barX(all, { x: "delta", y: "name", fill: (x: { delta: number }) => (x.delta >= 0 ? "#1d4ed8" : "#dc2626"), rx: 3 }),
            Plot.text(all.filter((x) => x.delta >= 0), { x: "delta", y: "name", text: (x: { delta: number }) => `+${x.delta.toFixed(1)}`, dx: 16, fill: "currentColor", fontSize: 11 }),
            Plot.text(all.filter((x) => x.delta < 0), { x: "delta", y: "name", text: (x: { delta: number }) => `−${Math.abs(x.delta).toFixed(1)}`, dx: -16, fill: "currentColor", fontSize: 11 }),
            Plot.ruleX([0]),
          ],
        })
      }
    />
  );
}

function StateTable({ b, yieldKey, yieldLabel }: { b: Block; yieldKey: string; yieldLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="figures w-full min-w-[460px] text-sm">
        <thead className="text-left text-ink-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">State</th>
            <th className="py-2 pr-3 font-medium">Projects</th>
            <th className="py-2 pr-3 font-medium">{yieldLabel}</th>
            <th className="py-2 pr-3 font-medium">Project IRR</th>
            <th className="py-2 font-medium">Value €/kW</th>
          </tr>
        </thead>
        <tbody>
          {b.by_state.filter((s) => s.projects >= 10).map((s) => (
            <tr key={String(s.state)} className="border-t border-rule">
              <td className="py-1.5 pr-3">{String(s.state)}</td>
              <td className="py-1.5 pr-3">{s.projects}</td>
              <td className="py-1.5 pr-3">{n0(med(s[yieldKey]) ?? 0)}</td>
              <td className="py-1.5 pr-3">{pct(med(s.project_irr))}</td>
              <td className="py-1.5">{n0(med(s.npv) ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: diverging(-1, 0, 1) }} />loses value at the cost of capital</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: diverging(0, 0, 1) }} />about break-even</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: diverging(1, 0, 1) }} />creates value</span>
    </div>
  );
}

export function Profit({ tech, version }: { tech: "wind" | "solar"; version: string }) {
  const [d, setD] = useState<ProfitFile | null>(null);
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([fetch(`/data/costs/profitability.json?v=${version}`).then((r) => r.json()), fetch(`/data/boundaries/states.geojson?v=${version}`).then((r) => r.json())])
      .then(([a, g]) => { setD(a); setGeo(g); })
      .catch(() => setFailed(true));
  }, [version]);
  const projects = useMemo(() => (d ? rows(d[tech]) : []), [d, tech]);
  if (failed) return <p className="py-10 text-ink-muted">Profitability data is not available.</p>;
  if (!d || !geo) return <Loading height={400} />;
  const b = d[tech];
  const a = d.assumptions[tech] as Record<string, number>;
  const wacc = a.wacc_nominal;
  const last = b.by_round.at(-1)!;
  const best = b.by_round.reduce((x, y) => ((med(y.project_irr) ?? -1) > (med(x.project_irr) ?? -1) ? y : x));
  const solar = tech === "solar";
  const unit = solar ? "€/kWp" : "€/kW";
  const mkt = d.market?.last_12m;
  const span = solar ? 300 : 600;
  const dots = projects.filter((p) => p.lat != null && p.npv != null).map((p) => ({ lon: p.lon as number, lat: p.lat as number, color: diverging(p.npv as number, 0, span), r: solar ? 2.4 : 2 }));
  const src = <>Source: own model on Bundesnetzagentur auction results and Marktstammdatenregister (yields: Deutscher Wetterdienst), with costs from {solar ? "Fraunhofer ISE and the Danish Energy Agency" : "Deutsche WindGuard (2024)"} and financing from {solar ? "Fraunhofer ISE (2024)" : "Deutsche WindGuard and Fraunhofer ISE (2024)"}{mkt ? "; market values Bundesnetzagentur | SMARD.de" : ""}. Data processed by MaStR Radar.</>;
  const notes = [
    ...d.assumptions.notes,
    solar ? `Investment: Fraunhofer ISE midpoint per edition (800 €/kWp in 2024); low case Danish Energy Agency (458 €/kWp). Opex ${a.opex_eur_kwp} €/kWp/yr. Debt ${a.debt_share * 100} % at ${(a.debt_rate * 100).toFixed(2)} %; cost of capital ${pct(wacc)}.` : `Investment: WindGuard 2024 formula from rated power, specific power and hub height, plus 506 €/kW ancillary costs, scaled to the bid year with the WindGuard price trend. Opex 49/57 €/kW/yr. Debt ${a.debt_share * 100} % at ${(a.debt_rate * 100).toFixed(2)} % over ${a.debt_years} years; cost of capital ${pct(wacc)}.`,
    `${b.skipped.toLocaleString("en-GB")} awards left out for missing or implausible inputs (no turbine data, yield or price).`,
  ];
  return (
    <>
      <Section
        id="profit"
        eyebrow="What awarded projects earn"
        title={
          solar
            ? `At today's award prices a solar park may cost at most about ${n0(med(last.max_capex)!)} €/kWp to earn its cost of capital from the EEG alone`
            : `Awarded wind projects earn a median ${pct(med(b.overall.project_irr))} project return; in the ${mon(last.bid_date!)} round it fell to ${pct(med(last.project_irr))}`
        }
        subtitle={`Every award with the needed data (${projects.length.toLocaleString("en-GB")} projects): estimated investment, revenue from the award price and our yield model, and the return on the whole project (IRR). Pre-tax, nominal; an illustration with stated assumptions.`}
        asOf={d.as_of}
        source={src}
        takeaways={
          solar
            ? [
                `Median project IRR over the 20 EEG years: ${pct(med(b.overall.project_irr))} at Fraunhofer's mid investment (800 €/kWp), ${pct(med(b.overall.project_irr_low_capex))} at the Danish Energy Agency's 458 €/kWp.`,
                `Over a 30-year life, with years 21–30 at today's solar market value (${mkt ? (mkt.solar / 10).toFixed(1) : "–"} ct/kWh), the median rises to ${pct(med(b.overall.project_irr_full))}.`,
                `The affordable investment fell from ${n0(med(b.by_round[0].max_capex)!)} €/kWp (${mon(b.by_round[0].bid_date!)}) to ${n0(med(last.max_capex)!)} (${mon(last.bid_date!)}): winners must build far below the German average, or count on market prices and a long life.`,
              ]
            : [
                `The best round was ${mon(best.bid_date!)} (median ${pct(med(best.project_irr))}). Since then award prices fell faster than costs: a project in the ${mon(last.bid_date!)} round may cost at most about ${n0(med(last.max_capex)!)} €/kW to earn ${pct(wacc)}, against an estimated ${n0(med(last.capex)!)} €/kW.`,
                `Over a 25-year life, with years 21–25 at today's wind market value (${mkt ? (mkt.wind_onshore / 10).toFixed(1) : "–"} ct/kWh), the latest round reaches ${pct(med(last.project_irr_full))}. Bids this low bet on market prices above the award.`,
                `With 79 % debt, the owners' return (equity IRR) reacts strongly: median ${pct(med(b.overall.equity_irr))} across all rounds, much lower or negative in the latest rounds.`,
              ]
        }
        caveats={notes}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Median project IRR" value={pct(med(b.overall.project_irr))} sub="all rounds, EEG 20 years" />
          <Stat label={`Latest round (${mon(last.bid_date!)})`} value={pct(med(last.project_irr))} sub={`full life: ${pct(med(last.project_irr_full))}`} />
          <Stat label="Estimated investment" value={`${n0(med(last.capex)!)} ${unit}`} sub="latest round, median" />
          <Stat label="Affordable investment" value={`${n0(med(last.max_capex)!)} ${unit}`} sub={`to earn ${pct(wacc)}`} />
        </div>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-2 text-sm font-semibold">Median project IRR per round (band: middle half of projects)</p>
            <RoundChart b={b} wacc={wacc} solar={solar} />
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-sm font-semibold">Investment: estimated vs affordable ({unit}, median per round)</p>
            <CapexChart b={b} unit={unit} />
          </div>
        </div>
      </Section>

      <Section
        id="value"
        eyebrow="Where projects are worth most"
        title={`Awarded ${solar ? "solar parks" : "wind projects"} in ${String(b.by_state[0].state)} come out best: median value ${n0(med(b.by_state[0].npv)!)} ${unit} at the cost of capital`}
        subtitle={`Value = net present value per ${solar ? "kWp" : "kW"} at a ${pct(wacc)} cost of capital, EEG years only. Each dot is one award.`}
        asOf={d.as_of}
        source={src}
        takeaways={
          solar
            ? ["Sunshine decides: the south earns more per kWp for the same award price, so southern parks come out best.", "The award price is uniform across Germany, so every extra kWh per kWp goes straight to the return."]
            : ["The EEG correction factor lifts the price at weaker sites, so southern projects with fewer full-load hours are not automatically worse.", "Value differs mostly by round (the price) and by turbine size and hub height (the cost per kW)."]
        }
        caveats={["Locations as published in the award data; projects without a location are left out of the map.", "Yields from our DWD-based model; real sites can differ substantially."]}
      >
        <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0">
            <DotMap geo={geo} dots={dots} label={`Map of awarded ${solar ? "solar parks" : "wind projects"} coloured by estimated value per kW: red loses value at the cost of capital, blue creates value.`} />
            <Legend />
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-sm font-semibold">By state (medians, states with ≥ 10 projects)</p>
            <StateTable b={b} yieldKey={solar ? "yield" : "flh"} yieldLabel={solar ? "kWh/kWp" : "Full-load h"} />
          </div>
        </div>
      </Section>

      <Section
        id="sensitivity"
        eyebrow="What moves the return"
        title={`For a typical recent ${solar ? "park" : "project"}, ${s0(b)} a ${b.sensitivity.steps.capex_pct} % change in investment`}
        subtitle={`Representative project: median of the awards since 2025 (${n0(b.sensitivity.representative.capex)} ${unit}, ${b.sensitivity.representative.ct.toFixed(2)} ct/kWh, ${n0(solar ? b.sensitivity.representative.yield : b.sensitivity.representative.flh)} ${solar ? "kWh/kWp" : "full-load hours"}). Base project IRR ${pct(b.sensitivity.base.project_irr)}.`}
        asOf={d.as_of}
        source={src}
        takeaways={[
          "Interest rates change the owners' return, not the project return: the project IRR ignores how the project is financed.",
          "Investment and the bid price are the two big levers; a few tenths of a cent on the bid can decide whether a project earns its cost of capital.",
        ]}
      >
        <Tornado b={b} irrKey="project_irr" />
      </Section>
    </>
  );
}

function s0(b: Block) {
  const s = b.sensitivity;
  const base = s.base.project_irr ?? 0;
  const dp = Math.abs((s.cases.price_plus.project_irr ?? base) - base);
  const dc = Math.abs((s.cases.capex_minus.project_irr ?? base) - base);
  const how = dp > dc * 1.2 ? "more than" : dp < dc * 0.8 ? "less than" : "about as much as";
  return `a ${s.steps.price_ct} ct change in the price moves the return ${how}`;
}
