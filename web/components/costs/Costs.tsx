"use client";

// Cost benchmarks (contract v1.11, costs/costs.json): what an onshore wind or
// solar project costs to build and run, by component, and how the main public
// sources compare over time. Figures come from cited studies, not from MaStR.
import * as Plot from "@observablehq/plot";
import { useEffect, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { Loading, Section, Stat } from "@/components/monitor/ui";
import { cssVar } from "@/lib/theme";

type SourceId = "windguard" | "ise" | "dea" | "irena";
interface Basis { kind: "nominal" | "real"; year?: number; currency: "EUR" | "USD" }
interface Component { name: string; value: number; share: number; decade_1?: number; decade_2?: number }
interface Group { name: string; total: number; method: string; tolerance?: number; note?: string; components: Component[] }
interface Breakdown {
  source: SourceId;
  period?: string;
  segment?: string;
  unit: string;
  price_basis: Basis;
  total: number;
  method?: string;
  note?: string;
  groups?: Group[];
  components: Component[];
  totals?: { decade_1: number; decade_2: number };
}
interface CompareRow {
  source: SourceId;
  label: string;
  year: number;
  value?: number;
  low?: number;
  high?: number;
  unit: string;
  price_basis: Basis;
  method: string;
  tolerance?: number;
  note?: string;
  eur_value?: number;
  eur_low?: number;
  eur_high?: number;
  eur_value_incl_variable?: number;
  variable_eur_mwh?: number;
  conversion: string;
}
interface Trend {
  source: SourceId;
  label: string;
  unit: string;
  price_basis: Basis;
  method: string;
  tolerance?: number;
  note?: string;
  points?: [number, number][];
  eur_points?: [number, number][];
  ranges?: [number, number, number][];
}
interface TechBlock {
  lead: SourceId;
  lead_note: string;
  capex_breakdown: Breakdown;
  capex_breakdown_alt?: Breakdown;
  opex_breakdown: Breakdown;
  capex_compare: CompareRow[];
  opex_compare: CompareRow[];
  compare_full_load_hours?: number;
  capex_trend: Trend[];
  projections: { source: SourceId; unit: string; price_basis: Basis; central: [number, number][]; range: [number, number, number][] };
  lcoe: { source: SourceId; label: string; low: number; high: number; unit: string; year: number }[];
  auction_link: { file: string; years: { year: number; avg_ct: number; rounds: number }[] };
  segments?: { segment: string; source: SourceId; capex?: number; low?: number; high?: number; opex: number; unit: string; price_basis: Basis }[];
}
interface CostsFile {
  as_of: string;
  sources: Record<SourceId, { title: string; edition: string; url: string; licence: string; attribution: string; scope: string }>;
  fx_usd_per_eur: Record<string, number>;
  wind_onshore: TechBlock;
  solar: TechBlock;
}

const SRC: Record<SourceId, { name: string; color: string }> = {
  windguard: { name: "Deutsche WindGuard", color: "#1e3a8a" },
  ise: { name: "Fraunhofer ISE", color: "#0d9488" },
  dea: { name: "Danish Energy Agency", color: "#c2410c" },
  irena: { name: "IRENA", color: "#64748b" },
};
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const n0 = (v: number) => Math.round(v).toLocaleString("en-GB");
/** Whole numbers, but one decimal for small values (e.g. 5.4 €/kWp a year). */
const nv = (v: number) => (Math.abs(v) < 20 && !Number.isInteger(v) ? v.toLocaleString("en-GB", { maximumFractionDigits: 1 }) : n0(v));
const basisText = (b: Basis) => `${b.kind === "real" ? "real" : "nominal"} ${b.currency === "USD" ? "US$" : "€"}${b.year ? ` ${b.year}` : ""}`;
const approx = (method: string) => (method === "chart_read" ? "≈ " : "");

/** Horizontal stacked bar: one segment per component, labelled below. */
function StackBar({ parts, unit }: { parts: { name: string; value: number; color: string }[]; unit: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.name} ${n0(p.value)} ${unit}`).join(", ")}>
        {parts.map((p) => (
          <span key={p.name} style={{ width: `${(100 * p.value) / total}%`, background: p.color }} className="h-full border-r border-paper last:border-0" />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {parts.map((p) => (
          <li key={p.name} className="flex min-w-0 items-baseline justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="truncate">{p.name}</span>
            </span>
            <span className="figures shrink-0 text-ink-muted">
              {nv(p.value)} {unit} · {Math.round((100 * p.value) / total)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SHADES = ["#1e3a8a", "#2563eb", "#60a5fa", "#93c5fd", "#0f766e", "#14b8a6", "#5eead4", "#99f6e4", "#a3a3a3", "#d4d4d4"];
const SOLAR_SHADES = ["#92400e", "#d97706", "#f59e0b", "#fbbf24", "#fcd34d", "#fde68a", "#a3a3a3"];

function CompareChart({ rows, unit, extra }: { rows: CompareRow[]; unit: string; extra?: (r: CompareRow) => number | undefined }) {
  const data = rows.map((r) => ({
    label: r.label,
    source: SRC[r.source].name,
    color: SRC[r.source].color,
    v: extra?.(r) ?? r.eur_value,
    lo: r.eur_low,
    hi: r.eur_high,
    tip: `${r.label} (${r.year})\n${r.value != null ? `${approx(r.method)}${n0(r.value)}` : `${n0(r.low!)}–${n0(r.high!)}`} ${r.unit}, ${basisText(r.price_basis)}${r.conversion !== "none" ? `\nconverted: ${r.conversion}` : ""}${r.note ? `\n${r.note}` : ""}`,
  }));
  const max = Math.max(...data.map((d) => Math.max(d.v ?? 0, d.hi ?? 0))) * 1.1;
  return (
    <PlotFigure
      deps={[rows]}
      height={Math.max(160, rows.length * 40 + 40)}
      render={(width) =>
        Plot.plot({
          width,
          height: Math.max(160, rows.length * 40 + 40),
          marginLeft: Math.min(260, width * 0.42),
          ...axis(),
          x: { label: unit, grid: true, domain: [0, max] },
          y: { label: null, domain: data.map((d) => d.label) },
          marks: [
            Plot.ruleY(data.filter((d) => d.lo != null), { y: "label", x1: "lo", x2: "hi", stroke: "color", strokeWidth: 8, strokeOpacity: 0.35, strokeLinecap: "round" }),
            Plot.dot(data.filter((d) => d.v != null), { y: "label", x: "v", fill: "color", r: 6 }),
            Plot.text(data, { y: "label", x: (d) => d.hi ?? d.v, text: (d) => (d.v != null ? n0(d.v) : `${n0(d.lo!)}–${n0(d.hi!)}`), dx: 12, textAnchor: "start", fill: "currentColor", fontSize: 11 }),
            Plot.tip(data, Plot.pointerY({ y: "label", x: (d) => d.v ?? d.hi, title: "tip" })),
          ],
        })
      }
    />
  );
}

function TrendChart({ t, unit, projections, cap }: { t: TechBlock; unit: string; projections?: boolean; cap?: number }) {
  const lines = t.capex_trend.filter((s) => s.points).flatMap((s) =>
    (s.eur_points ?? s.points!).filter(([, v]) => !cap || v <= cap).map(([year, v]) => ({ year, v, source: SRC[s.source].name, color: SRC[s.source].color, approx: s.method === "chart_read", label: s.label })),
  );
  const ranges = t.capex_trend.filter((s) => s.ranges).flatMap((s) => s.ranges!.map(([year, lo, hi]) => ({ year, lo, hi, source: SRC[s.source].name, color: SRC[s.source].color })));
  const proj = projections ? t.projections.central.map(([year, v]) => ({ year, v })) : [];
  const all = [...lines.map((d) => d.v), ...ranges.map((d) => d.hi), ...proj.map((d) => d.v)];
  const names = [...new Set([...lines.map((d) => d.source), ...ranges.map((d) => d.source)])];
  return (
    <PlotFigure
      deps={[t, projections]}
      render={(width) =>
        Plot.plot({
          width,
          height: 300,
          marginLeft: 48,
          ...axis(),
          x: { label: null, tickFormat: "d" },
          y: { label: unit, grid: true, domain: [0, Math.max(...all) * 1.1] },
          color: { domain: names, range: names.map((nm) => Object.values(SRC).find((s) => s.name === nm)!.color), legend: true },
          marks: [
            Plot.ruleX(ranges, { x: "year", y1: "lo", y2: "hi", stroke: "source", strokeWidth: 10, strokeOpacity: 0.4, strokeLinecap: "round" }),
            Plot.line(lines.filter((d) => d.source !== "IRENA"), { x: "year", y: "v", stroke: "source", z: "source", strokeWidth: 2.5 }),
            Plot.text(lines.filter((d) => d.source === "IRENA"), { x: "year", y: "v", text: (d: { v: number }) => `≈ ${n0(d.v)}`, dy: -12, fill: SRC.irena.color, fontSize: 11 }),
            Plot.dot(lines, { x: "year", y: "v", fill: "source", r: 3.5, tip: true, title: (d: { label: string; year: number; v: number; approx: boolean }) => `${d.label}\n${d.year}: ${d.approx ? "≈ " : ""}${n0(d.v)} ${unit}` }),
            Plot.dot(ranges, { x: "year", y: (d: { lo: number; hi: number }) => (d.lo + d.hi) / 2, r: 0, tip: true, title: (d: { source: string; year: number; lo: number; hi: number }) => `${d.source} ${d.year}: ${n0(d.lo)}–${n0(d.hi)} ${unit}` }),
          ],
        })
      }
    />
  );
}

function ProjectionChart({ t }: { t: TechBlock }) {
  const p = t.projections;
  const pts = p.central.map(([year, v]) => ({ year, v }));
  const band = p.range.map(([year, lo, hi]) => ({ year, lo, hi }));
  return (
    <PlotFigure
      deps={[p]}
      render={(width) =>
        Plot.plot({
          width,
          height: 240,
          marginLeft: 52,
          marginRight: 36,
          ...axis(),
          x: { label: null, tickFormat: "d", inset: 12 },
          y: { label: p.unit, grid: true, domain: [0, Math.max(...band.map((b) => b.hi), ...pts.map((d) => d.v)) * 1.1] },
          marks: [
            Plot.ruleX(band, { x: "year", y1: "lo", y2: "hi", stroke: SRC.dea.color, strokeWidth: 10, strokeOpacity: 0.25, strokeLinecap: "round" }),
            Plot.line(pts, { x: "year", y: "v", stroke: SRC.dea.color, strokeWidth: 2.5 }),
            Plot.dot(pts, { x: "year", y: "v", fill: SRC.dea.color, r: 3.5, tip: true }),
            Plot.text(pts, { x: "year", y: "v", text: (d: { v: number }) => n0(d.v), dy: -14, dx: 6, textAnchor: "start", fill: "currentColor", fontSize: 11 }),
          ],
        })
      }
    />
  );
}

function AuctionChart({ t, color }: { t: TechBlock; color: string }) {
  const y = t.auction_link.years;
  const l = t.lcoe[0];
  return (
    <PlotFigure
      deps={[t]}
      render={(width) =>
        Plot.plot({
          width,
          height: 260,
          marginLeft: 40,
          ...axis(),
          x: { label: null, tickFormat: "d", ticks: y.map((d) => d.year), domain: [y[0].year - 0.5, y.at(-1)!.year + 0.5] },
          y: { label: "ct/kWh", grid: true, domain: [0, Math.max(l.high, ...y.map((d) => d.avg_ct)) * 1.1] },
          marks: [
            Plot.rect([l], { x1: y[0].year - 0.5, x2: y.at(-1)!.year + 0.5, y1: "low", y2: "high", fill: SRC.ise.color, fillOpacity: 0.12 }),
            Plot.text([l], { x: y[0].year - 0.4, y: "high", text: () => `Fraunhofer ISE: cost of electricity of new plants, ${l.year}: ${l.low}–${l.high} ct`, textAnchor: "start", dy: 10, fill: SRC.ise.color, fontSize: 11 }),
            Plot.line(y, { x: "year", y: "avg_ct", stroke: color, strokeWidth: 2.5 }),
            Plot.dot(y, { x: "year", y: "avg_ct", fill: color, r: 4, tip: true, title: (d: { year: number; avg_ct: number; rounds: number }) => `${d.year}: ${d.avg_ct} ct (mean of ${d.rounds} rounds)` }),
          ],
        })
      }
    />
  );
}

function Sources({ d, ids }: { d: CostsFile; ids: SourceId[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {ids.map((id) => {
        const s = d.sources[id];
        return (
          <li key={id} className="flex gap-2">
            <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SRC[id].color }} />
            <span>
              <a href={s.url} className="underline decoration-rule underline-offset-2 hover:text-ink">{s.title}</a>
              <span className="text-ink-muted"> · {s.edition} · {s.scope} · {s.licence}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function Costs({ tech, version }: { tech: "wind_onshore" | "solar"; version: string }) {
  const [d, setD] = useState<CostsFile | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(`/data/costs/costs.json?v=${version}`)
      .then((r) => r.json())
      .then(setD)
      .catch(() => setFailed(true));
  }, [version]);
  if (failed) return <p className="py-10 text-ink-muted">Cost data is not available.</p>;
  if (!d) return <Loading height={500} />;
  return tech === "wind_onshore" ? <Wind d={d} /> : <Solar d={d} />;
}

function sourceLine(d: CostsFile, ids: SourceId[], extra = "") {
  return (
    <>
      Source: {ids.map((i) => d.sources[i].attribution).join("; ")}
      {extra}. Compiled by MaStR Radar; newest source edition {day(d.as_of)}.
    </>
  );
}

function Wind({ d }: { d: CostsFile }) {
  const t = d.wind_onshore;
  const cb = t.capex_breakdown;
  const [turbine, ancillary] = cb.groups!;
  const ob = t.opex_breakdown;
  const wg = t.capex_trend.find((s) => s.source === "windguard")!.points!;
  const low = wg.reduce((a, b) => (b[1] < a[1] ? b : a));
  const last = wg.at(-1)!;
  const rise = Math.round((100 * (last[1] - low[1])) / low[1]);
  const flh = t.compare_full_load_hours ?? 2500;
  const parts = [
    ...turbine.components.map((c, i) => ({ name: c.name, value: c.value, color: SHADES[i] })),
    ...ancillary.components.map((c, i) => ({ name: c.name, value: c.value, color: SHADES[4 + i] })),
  ];
  const alt = t.capex_breakdown_alt!;
  const auctions = t.auction_link.years;
  const lastAuction = auctions.at(-1)!;
  const peak = auctions.reduce((a, b) => (b.avg_ct > a.avg_ct ? b : a));
  const src = sourceLine(d, ["windguard", "ise", "dea", "irena"]);
  return (
    <>
      <Section
        id="capex"
        eyebrow="What a wind farm costs to build"
        title={`Building onshore wind in Germany costs about ${n0(cb.total)} €/kW; turbines are ${rise} % dearer than at the ${low[0]} low`}
        subtitle={`Investment per kW for projects commissioned 2024–2026, from the ${SRC.windguard.name} survey of turbine makers and ${"72 projects"}. ${t.lead_note}`}
        asOf={day(d.as_of)}
        source={sourceLine(d, ["windguard"])}
        takeaways={[
          `The turbine itself is about half of the total (${n0(turbine.components[0].value)} of ${n0(cb.total)} €/kW). Transport and installation add ${n0(turbine.components[2].value)}, the foundation ${n0(turbine.components[1].value)}.`,
          `Planning and permitting (${n0(ancillary.components[0].value)} €/kW) is the largest cost outside the turbine, more than the grid connection (${n0(ancillary.components[1].value)}). Long permit procedures cost money even when a project fails.`,
          `A typical 6 MW turbine therefore costs roughly ${(cb.total * 6 / 1000).toFixed(1)} million € to build, before financing.`,
        ]}
        caveats={[
          `The turbine part (≈ ${n0(turbine.total)} €/kW) is read from a chart of the study (± ${turbine.tolerance} €/kW) and split by the average shares reported by manufacturers.`,
          "Ancillary costs are developers' expected costs for projects not yet finished; the spread between projects is large (standard deviation 43 %).",
          "Grid costs beyond the substation are paid by the grid operator and are not included.",
        ]}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total investment" value={`${n0(cb.total)} €/kW`} sub="2024–2026" swatch={SRC.windguard.color} />
          <Stat label="Turbine incl. foundation" value={`≈ ${n0(turbine.total)} €/kW`} sub="transport, installation" />
          <Stat label="Ancillary investment" value={`${n0(ancillary.total)} €/kW`} sub="planning, grid, roads" />
          <Stat label="Running costs" value={`${ob.totals!.decade_1}–${ob.totals!.decade_2} €/kW`} sub="per year" />
        </div>
        <div className="mt-8">
          <p className="mb-3 text-sm font-semibold">Investment by component (€/kW, nominal 2024)</p>
          <StackBar parts={parts} unit="€/kW" />
        </div>
        <details className="mt-6 rounded-2xl border border-rule p-4 text-sm">
          <summary className="cursor-pointer font-semibold">For comparison: the Danish Energy Agency breakdown ({n0(alt.total)} €/kW, real €{alt.price_basis.year})</summary>
          <p className="mt-2 text-ink-muted">{alt.note}</p>
          <div className="mt-3">
            <StackBar parts={alt.components.map((c, i) => ({ name: c.name, value: c.value, color: ["#c2410c", "#ea580c", "#fb923c", "#a3a3a3", "#d4d4d4", "#e5e5e5"][i] }))} unit="€/kW" />
          </div>
        </details>
      </Section>

      <Section
        id="opex"
        eyebrow="What it costs to run"
        title={`Running a wind farm costs ${ob.totals!.decade_1} €/kW a year in its first decade and ${ob.totals!.decade_2} €/kW in the second; the land lease is the biggest item`}
        subtitle="Average annual operating costs for projects commissioned 2024–2026 (58 projects, 1,213 MW)."
        asOf={day(d.as_of)}
        source={sourceLine(d, ["windguard"])}
        takeaways={[
          `The land lease (${ob.components[0].decade_1} €/kW a year) costs more than maintenance (${ob.components[1].decade_1}) in the first decade. Landowners hold a strong hand where sites are scarce, and leases are often tied to revenue.`,
          `Maintenance rises from ${ob.components[1].decade_1} to ${ob.components[1].decade_2} €/kW in the second decade as turbines age; most projects plan full-service contracts for all 20 years.`,
        ]}
        caveats={["Values read from the study's chart (rounded to whole €/kW); the components add up to the stated totals within rounding."]}
      >
        <PlotFigure
          deps={[ob]}
          render={(width) => {
            const rows = ob.components.flatMap((c) => [
              { name: c.name, decade: "Years 1–10", v: c.decade_1! },
              { name: c.name, decade: "Years 11–20", v: c.decade_2! },
            ]);
            return Plot.plot({
              width,
              height: 300,
              marginLeft: Math.min(200, width * 0.4),
              ...axis(),
              x: { label: "€/kW per year", grid: true },
              y: { axis: null, domain: ["Years 1–10", "Years 11–20"] },
              fy: { label: null, axis: "left", domain: ob.components.map((c) => c.name) },
              color: { domain: ["Years 1–10", "Years 11–20"], range: [SRC.windguard.color, "#60a5fa"], legend: true },
              marks: [Plot.barX(rows, { x: "v", y: "decade", fy: "name", fill: "decade", rx: 3, tip: true }), Plot.ruleX([0])],
            });
          }}
        />
      </Section>

      <Section
        id="compare"
        eyebrow="Sources compared"
        title="The four main sources put German onshore wind at roughly 1,300 to 1,900 €/kW; they differ in what they include"
        subtitle="Each row is one source, converted to euros of its data year for comparison. Hover for the original figure, price basis and conversion."
        asOf={day(d.as_of)}
        source={src}
        takeaways={[
          `WindGuard's total (${n0(t.capex_compare[0].eur_value!)} €/kW) sits in the upper part of the Fraunhofer ISE range; IRENA's German average (≈ ${n0(t.capex_compare.find((r) => r.label === "IRENA, Germany")!.eur_value!)} €/kW) is close to its European average.`,
          `The Danish Energy Agency is lowest once Danish-only items are removed (≈ ${n0(t.capex_compare.find((r) => r.label.includes("core items"))!.eur_value!)} €/kW): Danish projects carry less planning cost and pay no grid connection beyond the park.`,
          `Running costs differ most: WindGuard's survey includes land lease and direct marketing (${ob.totals!.decade_1}–${ob.totals!.decade_2} €/kW), the Danish figure counts land in the investment instead.`,
        ]}
        caveats={[
          "Sources differ in scope (country, what is included, survey or model) and price year; the conversion only aligns currency and price level.",
          `US$ figures converted at the ECB 2024 average of ${d.fx_usd_per_eur["2024"]} US$/€; DEA €2020 figures with the DEA price index. Variable running costs added at ${n0(flh)} full-load hours.`,
          "Values marked ≈ are read from published charts.",
        ]}
      >
        <p className="mb-2 text-sm font-semibold">Investment (€/kW)</p>
        <CompareChart rows={t.capex_compare} unit="€/kW" />
        <p className="mb-2 mt-8 text-sm font-semibold">Running costs (€/kW per year)</p>
        <CompareChart rows={t.opex_compare} unit="€/kW per year" extra={(r) => r.eur_value_incl_variable ?? r.eur_value} />
      </Section>

      <Section
        id="trend"
        eyebrow="Trend"
        title={`Turbine prices fell about 4 % a year until ${low[0]}, then rose ${rise} % with raw material and logistics costs`}
        subtitle="Each source as its own series: never merged, because definitions differ. WindGuard: turbine with foundation, nominal €. Fraunhofer ISE: full plant cost range per edition. IRENA: German average in real 2024 US$, converted to €."
        asOf={day(d.as_of)}
        source={src}
        takeaways={[
          `WindGuard: from ≈ ${n0(wg[0][1])} €/kW (${wg[0][0]}) to ≈ ${n0(low[1])} (${low[0]}) and back to ≈ ${n0(last[1])} (${last[0]}). After inflation the rise since 2020 is only about 1 % a year.`,
          "Fraunhofer ISE has lowered its range slightly with each edition (1,500–2,000 in 2018, 1,300–1,900 in 2024).",
          "IRENA, in real terms, sees German installed costs 38 % lower in 2024 than in 2010.",
        ]}
        caveats={["Survey years in the WindGuard series; the 2023 value is the survey of Q4 2022.", "Values read from charts are approximate (WindGuard ± 20 €/kW, IRENA ± 100 US$/kW)."]}
      >
        <TrendChart t={t} unit="€/kW" />
      </Section>

      <Section
        id="outlook"
        eyebrow="Outlook and award prices"
        title={`Award prices have fallen from ${peak.avg_ct} ct (${peak.year}) to ${lastAuction.avg_ct} ct (${lastAuction.year}), into the lower half of the cost range`}
        subtitle="Average onshore wind award per year from our auction data, against the Fraunhofer ISE cost of electricity for new plants. Right: the Danish Energy Agency's cost projection."
        asOf={day(d.as_of)}
        source={sourceLine(d, ["ise", "dea"], "; Bundesnetzagentur auction results")}
        takeaways={[
          `Projects at good sites can still earn ${lastAuction.avg_ct} ct; weaker sites near the upper end of the cost range (${t.lcoe[0].high} ct) depend on the site correction factor of the EEG.`,
          `The Danish Energy Agency expects investment costs to fall only slowly: about 5 % per decade, to ${n0(t.projections.central.at(-1)![1])} €/kW (real €2020) in 2050. Cheaper wind power comes mainly from larger turbines and more full-load hours.`,
        ]}
        caveats={["Award prices are simple means of the round averages per year; the cost range is for 2024 and depends on the site and financing.", "Projections in real €2020; range shown for 2020 and 2050."]}
      >
        <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0">
            <p className="mb-2 text-sm font-semibold">Average award price per year (ct/kWh)</p>
            <AuctionChart t={t} color="#2563eb" />
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-sm font-semibold">Danish Energy Agency projection (€/kW, real 2020)</p>
            <ProjectionChart t={t} />
          </div>
        </div>
      </Section>

      <Method d={d} ids={["windguard", "ise", "dea", "irena"]} />
    </>
  );
}

function Solar({ d }: { d: CostsFile }) {
  const t = d.solar;
  const cb = t.capex_breakdown;
  const ob = t.opex_breakdown;
  const ise = t.capex_compare.find((r) => r.source === "ise")!;
  const irenaDe = t.capex_compare.find((r) => r.label === "IRENA, Germany")!;
  const auctions = t.auction_link.years;
  const lastAuction = auctions.at(-1)!;
  const peak = auctions.reduce((a, b) => (b.avg_ct > a.avg_ct ? b : a));
  const modules = cb.components.find((c) => c.name === "PV modules")!;
  const seg = t.segments ?? [];
  const segNames = [...new Set(seg.map((s) => s.segment))];
  const src = sourceLine(d, ["dea", "ise", "irena"]);
  return (
    <>
      <Section
        id="capex"
        eyebrow="What a solar park costs to build"
        title={`A ground-mounted solar park costs ${n0(cb.total)} €/kWp in the newest Danish data and ${n0(ise.low!)}–${n0(ise.high!)} €/kWp in Germany; modules are only a quarter of it`}
        subtitle={`Investment per kWp of module capacity, 2025. ${t.lead_note}`}
        asOf={day(d.as_of)}
        source={sourceLine(d, ["dea", "ise"])}
        takeaways={[
          `PV modules are ${Math.round(modules.share)} % of the investment (${n0(modules.value)} €/kWp). Mounting, cabling and installation work together cost almost twice as much.`,
          `Grid connection and transformer add ${n0(cb.components.find((c) => c.name.startsWith("Transformer"))!.value)} €/kWp; connection fees to the grid operator come on top (about 100 €/kW for a substation up to 60 kV, per the Danish catalogue).`,
          "Cheap modules have moved the cost to the site: labour, steel, cables, land and grid now decide what a park costs.",
        ]}
        caveats={[cb.note ?? "", "Danish prices from developer interviews in 2026; German parks are typically more expensive (see the comparison below)."].filter(Boolean)}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Danish Energy Agency" value={`${n0(cb.total)} €/kWp`} sub="2025, ground-mounted" swatch={SRC.dea.color} />
          <Stat label="Fraunhofer ISE, Germany" value={`${n0(ise.low!)}–${n0(ise.high!)} €/kWp`} sub="2024" swatch={SRC.ise.color} />
          <Stat label="IRENA, Germany" value={`≈ ${n0(irenaDe.eur_value!)} €/kW`} sub="2024, converted" swatch={SRC.irena.color} />
          <Stat label="Running costs" value={`${ob.total} €/kWp`} sub="per year (DEA)" />
        </div>
        <div className="mt-8">
          <p className="mb-3 text-sm font-semibold">Investment by component (€/kWp, real 2025)</p>
          <StackBar parts={cb.components.map((c, i) => ({ name: c.name, value: c.value, color: SOLAR_SHADES[i] }))} unit="€/kWp" />
        </div>
        <div className="mt-8">
          <p className="mb-3 text-sm font-semibold">Running costs per year (€/kWp, real 2025)</p>
          <StackBar parts={ob.components.map((c, i) => ({ name: c.name, value: c.value, color: SOLAR_SHADES[i * 2 + 1] }))} unit="€/kWp" />
        </div>
      </Section>

      <Section
        id="segments"
        eyebrow="Park, roof, farm"
        title="Rooftop systems cost up to twice as much per kWp as a solar park"
        subtitle="Investment and running costs by segment, Danish Energy Agency (central estimate) and Fraunhofer ISE (German range)."
        asOf={day(d.as_of)}
        source={sourceLine(d, ["dea", "ise"])}
        takeaways={[
          "Scale is the main driver: a park spreads planning, grid and installation over many megawatts; a home roof does not.",
          "Agri-PV (panels above crops) costs more than a normal park because of higher mounting structures.",
        ]}
      >
        <div className="overflow-x-auto">
          <table className="figures w-full min-w-[520px] text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Segment</th>
                <th className="py-2 pr-4 font-medium">Danish Energy Agency</th>
                <th className="py-2 pr-4 font-medium">Fraunhofer ISE</th>
                <th className="py-2 font-medium">Running costs / yr</th>
              </tr>
            </thead>
            <tbody>
              {segNames.map((nm) => {
                const dea = seg.find((s) => s.segment === nm && s.source === "dea");
                const is = seg.find((s) => s.segment === nm && s.source === "ise");
                return (
                  <tr key={nm} className="border-t border-rule">
                    <td className="py-2 pr-4">{nm}</td>
                    <td className="py-2 pr-4">{dea ? `${n0(dea.capex!)} €/kWp` : "–"}</td>
                    <td className="py-2 pr-4">{is ? `${n0(is.low!)}–${n0(is.high!)} €/kWp` : "–"}</td>
                    <td className="py-2">{[dea && `${dea.opex} (DEA)`, is && `${is.opex} (ISE)`].filter(Boolean).join(" · ")} €/kWp</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="compare"
        eyebrow="Sources compared"
        title="German solar parks cost more than the Danish and IRENA figures suggest"
        subtitle="Ground-mounted solar, one row per source, converted to euros of its data year. Hover for the original figure and conversion."
        asOf={day(d.as_of)}
        source={src}
        takeaways={[
          `Fraunhofer ISE's German range (${n0(ise.low!)}–${n0(ise.high!)} €/kWp) lies above the Danish central estimate (${n0(cb.total)}) and IRENA's German average (≈ ${n0(irenaDe.eur_value!)} €/kW).`,
          "Part of the gap is definition: IRENA averages projects actually commissioned, the Danish figure excludes grid fees, and Fraunhofer quotes a market range including smaller parks.",
          `Running costs: ${ob.total} €/kWp a year in the Danish data (incl. land lease) against ${t.opex_compare.find((r) => r.source === "ise")!.value} €/kWp at Fraunhofer ISE.`,
        ]}
        caveats={[`US$ figures converted at the ECB 2024 average of ${d.fx_usd_per_eur["2024"]} US$/€. IRENA reports per kW; Danish and German figures are per kWp of modules.`, "IRENA's German value is read from a chart (≈)."]}
      >
        <p className="mb-2 text-sm font-semibold">Investment, ground-mounted (€/kWp)</p>
        <CompareChart rows={t.capex_compare} unit="€/kWp" />
      </Section>

      <Section
        id="trend"
        eyebrow="Trend"
        title="Solar parks cost about 87 % less than in 2010, but the fall has stopped: Fraunhofer's 2024 range is higher than in 2021"
        subtitle="Each source as its own series. Fraunhofer ISE: range per edition, nominal €. IRENA: German average, real 2024 US$ converted to €. Danish Energy Agency: projection to 2050."
        asOf={day(d.as_of)}
        source={src}
        takeaways={[
          `IRENA: the German average fell from ≈ ${n0(t.capex_trend.find((s) => s.source === "irena")!.eur_points![0][1])} €/kW in 2010 (off the chart scale) to ≈ ${n0(irenaDe.eur_value!)} in 2024.`,
          "Fraunhofer ISE: 600–800 €/kWp in 2018, 530–800 in 2021, 700–900 in 2024: the range rose although module prices fell.",
          `The Danish Energy Agency expects a slow fall to ${n0(t.projections.central.at(-1)![1])} €/kWp by 2050 (real €2025), mostly from modules and inverters.`,
        ]}
        caveats={["IRENA endpoints read from a chart (± 250 US$/kW in 2010)."]}
      >
        <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0"><TrendChart t={t} unit="€/kWp" cap={1500} /></div>
          <div className="min-w-0">
            <p className="mb-2 text-sm font-semibold">Danish Energy Agency projection (€/kWp, real 2025)</p>
            <ProjectionChart t={t} />
          </div>
        </div>
      </Section>

      <Section
        id="auctions"
        eyebrow="Costs and award prices"
        title={`Solar awards have settled near ${lastAuction.avg_ct} ct, inside the cost range of new parks; the ${peak.year} peak of ${peak.avg_ct} ct came after the 2022 price shock`}
        subtitle="Average award of the ground-mounted solar rounds per year, against the Fraunhofer ISE cost of electricity of new ground-mounted parks."
        asOf={day(d.as_of)}
        source={sourceLine(d, ["ise"], "; Bundesnetzagentur auction results")}
        takeaways={[`With awards near ${lastAuction.avg_ct} ct and costs of ${t.lcoe[0].low}–${t.lcoe[0].high} ct, margins are thin for parks at average sites (see the overheating market on the solar page).`]}
        caveats={["Award prices are simple means of the round averages per year; the cost range is for 2024."]}
      >
        <AuctionChart t={t} color="#d97706" />
      </Section>

      <Method d={d} ids={["dea", "ise", "irena"]} />
    </>
  );
}

function Method({ d, ids }: { d: CostsFile; ids: SourceId[] }) {
  return (
    <section id="method" className="border-t border-rule py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Sources and method</p>
      <h2 className="mt-3 text-2xl">Where the numbers come from</h2>
      <div className="mt-5 max-w-3xl space-y-4 text-sm leading-relaxed">
        <Sources d={d} ids={ids} />
        <p className="text-ink-muted">
          Cost figures come from these publications, not from the Marktstammdatenregister. Each value is entered by hand with its edition, page, price basis and how it was read, and checked by
          the pipeline (component sums, ranges, plausible bounds). Values marked ≈ were read off a published chart. US$ are converted at the ECB annual average, Danish €2020 values with the
          Danish Energy Agency&apos;s price index. Award prices come from our auction data. The full table is in{" "}
          <a href="/data/costs/costs.json" className="underline decoration-rule underline-offset-2">costs.json</a>.
        </p>
      </div>
    </section>
  );
}
