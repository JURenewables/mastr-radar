"use client";

// Redispatch by the four TSOs (Netztransparenz) and cross-border flows
// (ENTSO-E) on the Grid page (contract v1.8 draft).
import * as Plot from "@observablehq/plot";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { Section, Stat } from "@/components/monitor/ui";
import { cssVar } from "@/lib/theme";

type E = "conventional" | "renewable" | "other";
export interface RedispatchFile {
  first: string;
  last: string;
  monthly: { month: string; down_mwh: Record<E, number>; up_mwh: Record<E, number>; countertrade_mwh: number }[];
  by_tso_down_mwh: Record<string, Record<string, number>>;
  category_mwh: Record<string, number>;
  last_12m: {
    down_mwh: Record<E, number>;
    up_mwh: Record<E, number>;
    countertrade_mwh: number;
    measures: number;
    renewable_substations: { asset: string; mwh: number; measures: number; tso: string }[];
    reduced_plants: { asset: string; mwh: number; measures: number; tso: string }[];
    increased_plants: { asset: string; mwh: number; measures: number; tso: string }[];
  };
}
export interface FlowsFile {
  first: string;
  last: string;
  neighbours: string[];
  monthly_net_import_gwh: Record<string, Record<string, number>>;
  last_12m: Record<string, { import_gwh: number; export_gwh: number }>;
  net_import_by_hour_utc_mw: number[];
}

const NAMES: Record<string, string> = {
  AT: "Austria", BE: "Belgium", CH: "Switzerland", CZ: "Czechia", DK1: "Denmark West", DK2: "Denmark East",
  FR: "France", NL: "Netherlands", NO2: "Norway", PL: "Poland", SE4: "Sweden",
};
const RE = "#10b981";
const CONV = "#64748b";
const UP = "#ef4444";
const CT = "#f59e0b";
const twh = (mwh: number) => `${(mwh / 1e6).toFixed(1)} TWh`;
const gwhTxt = (g: number) => (Math.abs(g) >= 1000 ? `${(g / 1000).toFixed(1)} TWh` : `${Math.round(g)} GWh`);
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const NT = "https://www.netztransparenz.de/";
const ENTSOE = "https://transparency.entsoe.eu/";

function List({ title, rows, color }: { title: string; rows: { asset: string; mwh: number; measures: number; tso: string }[]; color: string }) {
  const max = Math.max(...rows.map((r) => r.mwh), 1);
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold">{title}</p>
      <ol className="mt-3 space-y-1.5">
        {rows.slice(0, 8).map((r) => (
          <li key={r.asset} className="grid grid-cols-[9.5rem_1fr] items-center gap-2 text-sm">
            <span className="truncate" title={`${r.asset} · ${r.tso} · ${r.measures} measures`}>{r.asset}</span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 rounded-full" style={{ width: `${(r.mwh / max) * 65}%`, background: color }} />
              <span className="figures shrink-0 text-xs text-ink-muted">{twh(r.mwh)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function RedispatchSection({ r, date }: { r: RedispatchFile; date: string }) {
  const l = r.last_12m;
  const reDown = l.down_mwh.renewable;
  const convUp = l.up_mwh.conventional;
  const subs = l.renewable_substations;
  const top4 = subs.slice(0, 4).reduce((t, x) => t + x.mwh, 0);
  const lastYear = r.last.slice(0, 4);
  const years = [...new Set(r.monthly.map((m) => m.month.slice(0, 4)))];
  const yearly = years.flatMap((y) => {
    const ms = r.monthly.filter((m) => m.month.startsWith(y));
    const s = (f: (m: (typeof ms)[number]) => number) => ms.reduce((t, m) => t + f(m), 0) / 1e6;
    return [
      { year: y, kind: "Renewables curtailed", twh: s((m) => m.down_mwh.renewable) },
      { year: y, kind: "Conventional reduced", twh: s((m) => m.down_mwh.conventional + m.down_mwh.other) },
      { year: y, kind: "Conventional increased", twh: s((m) => m.up_mwh.conventional + m.up_mwh.other) },
      { year: y, kind: "Countertrading", twh: s((m) => m.countertrade_mwh) },
    ];
  });
  const kinds = ["Renewables curtailed", "Conventional reduced", "Conventional increased", "Countertrading"];
  const reBy = (y: string) => yearly.find((x) => x.year === y && x.kind === "Renewables curtailed")?.twh ?? 0;
  const prev = String(Number(lastYear) - 1);
  const tsoRows = Object.entries(r.by_tso_down_mwh).map(([t, v]) => ({ t, mwh: v[prev] ?? 0 })).sort((a, b) => b.mwh - a.mwh);
  const tsoTot = tsoRows.reduce((t, x) => t + x.mwh, 0) || 1;
  return (
    <Section
      id="redispatch"
      eyebrow="Redispatch by the TSOs"
      title={`The TSOs curtailed ${twh(reDown)} of renewables in the last 12 months, ${Math.round((top4 / Math.max(reDown, 1)) * 100)} % of it at four substations where North Sea wind comes ashore`}
      subtitle="Every redispatch measure the four transmission system operators ordered since 2021: which plants they turned down to relieve the grid, which they turned up instead, and where."
      asOf={date}
      source={<>Source: <a href={NT} className="underline" target="_blank" rel="noreferrer">Netztransparenz.de</a> (German TSOs), redispatch measures {r.first.slice(0, 7)} to {r.last.slice(0, 7)}. Aggregated and processed by MaStR Radar.</>}
      takeaways={[
        `To replace the curtailed power, ${twh(convUp)} of conventional generation was ramped up, mostly gas and coal plants in the west and south-west.`,
        `Turned down: lignite and coal in the east and on the coast (${l.reduced_plants.slice(0, 3).map((x) => x.asset).join(", ")}). Turned up: ${l.increased_plants.slice(0, 3).map((x) => x.asset).join(", ")}. That is the north-south bottleneck in one picture.`,
        `Renewables curtailed by the TSOs: ${reBy(prev).toFixed(1)} TWh in ${prev}, already ${reBy(lastYear).toFixed(1)} TWh in ${lastYear} so far.`,
        `${tsoRows[0]?.t} ordered ${Math.round(((tsoRows[0]?.mwh ?? 0) / tsoTot) * 100)} % of all reductions in ${prev}.`,
      ]}
      caveats={[
        "Only measures ordered by the four TSOs. Curtailment ordered by distribution grid operators is not in this data, so the totals are lower than BNetzA's national figures.",
        "Test runs are left out. Substations (UW …) bundle many wind farms; the data does not say which ones.",
        `${lastYear} runs to ${r.last}.`,
      ]}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Renewables curtailed" value={twh(reDown)} sub="last 12 months" swatch={RE} />
        <Stat label="Conventional increased" value={twh(convUp)} sub="last 12 months" swatch={UP} />
        <Stat label="Countertrading" value={twh(l.countertrade_mwh)} sub="with neighbours" swatch={CT} />
        <Stat label="Measures" value={l.measures.toLocaleString("en-GB")} sub="last 12 months" />
      </div>
      <div className="mt-8 min-w-0">
        <p className="text-sm font-semibold">Redispatch volume per year (TWh)</p>
        <PlotFigure
          deps={[yearly]}
          render={(width) =>
            Plot.plot({
              width, height: 260, marginLeft: 36, ...axis(),
              x: { label: null, type: "band" },
              fx: { label: null },
              y: { label: null, grid: true },
              color: { domain: kinds, range: [RE, CONV, UP, CT], legend: true },
              marks: [
                Plot.barY(yearly, { x: "kind", fx: "year", y: "twh", fill: "kind", rx: 3, tip: true, title: (d: (typeof yearly)[number]) => `${d.year} · ${d.kind}\n${d.twh.toFixed(2)} TWh` }),
                Plot.axisX({ ticks: [] }),
              ],
            })
          }
        />
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <List title="Where renewables were curtailed (last 12 months)" rows={subs} color={RE} />
        <List title="Plants turned down" rows={l.reduced_plants} color={CONV} />
        <List title="Plants turned up" rows={l.increased_plants} color={UP} />
      </div>
    </Section>
  );
}

export function FlowsSection({ f, date }: { f: FlowsFile; date: string }) {
  const rows = Object.entries(f.last_12m).map(([c, v]) => ({ c, name: NAMES[c] ?? c, ...v, net: v.import_gwh - v.export_gwh })).sort((a, b) => b.net - a.net);
  const imp = rows.reduce((t, r) => t + r.import_gwh, 0);
  const exp = rows.reduce((t, r) => t + r.export_gwh, 0);
  const topImp = rows[0];
  const topExp = [...rows].sort((a, b) => a.net - b.net).slice(0, 2);
  const hours = f.net_import_by_hour_utc_mw.map((mw, h) => ({ h, mw }));
  const minH = hours.reduce((m, x) => (x.mw < m.mw ? x : m), hours[0]);
  const maxH = hours.reduce((m, x) => (x.mw > m.mw ? x : m), hours[0]);
  const bars = rows.flatMap((r) => [
    { name: r.name, kind: "Import", gwh: r.import_gwh },
    { name: r.name, kind: "Export", gwh: -r.export_gwh },
  ]);
  return (
    <Section
      id="flows"
      eyebrow="Cross-border flows"
      title={`Germany ${imp >= exp ? "imported" : "exported"} ${gwhTxt(Math.abs(imp - exp))} net over the last 12 months: most from ${topImp.name}, most out to ${topExp.map((x) => x.name).join(" and ")}`}
      subtitle="Physical electricity flows between Germany (with Luxembourg) and each neighbour, from the European TSOs' transparency platform."
      asOf={date}
      source={<>Source: <a href={ENTSOE} className="underline" target="_blank" rel="noreferrer">ENTSO-E Transparency Platform</a>, physical flows {f.first} to {f.last}. Processed by MaStR Radar.</>}
      takeaways={[
        `Imports ${gwhTxt(imp)}, exports ${gwhTxt(exp)} in the last 12 months.`,
        `Around ${minH.h}:00 UTC Germany exports ${gwhTxt(Math.abs(minH.mw) / 1000).replace("GWh", "GW")} net on average, at ${maxH.h}:00 UTC it imports ${gwhTxt(maxH.mw / 1000).replace("GWh", "GW")}: solar makes Germany an exporter at noon, the evening and night bring imports.`,
        `${topImp.name} sends the most (${gwhTxt(topImp.import_gwh)}); ${topExp[0].name} and ${topExp[1].name} take the most German power.`,
      ]}
      caveats={["Physical flows include transit, e.g. power from France passing through Germany to Austria.", "Local time is UTC + 1 in winter and UTC + 2 in summer."]}
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Imports and exports by neighbour, last 12 months (GWh)</p>
          <PlotFigure
            deps={[bars]}
            height={rows.length * 26 + 50}
            render={(width) =>
              Plot.plot({
                width, height: rows.length * 26 + 50, marginLeft: 100, ...axis(),
                x: { label: "← export   import →", grid: true, tickFormat: (d: number) => `${Math.abs(d / 1000)}k` },
                y: { label: null, domain: rows.map((r) => r.name) },
                color: { domain: ["Import", "Export"], range: [cssVar("--accent"), CT], legend: true },
                marks: [Plot.barX(bars, { x: "gwh", y: "name", fill: "kind", rx: 3, tip: true, title: (d: (typeof bars)[number]) => `${d.name} · ${d.kind}: ${gwhTxt(Math.abs(d.gwh))}` }), Plot.ruleX([0])],
              })
            }
          />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Average net import by hour of day (MW, UTC)</p>
          <PlotFigure
            deps={[hours]}
            render={(width) =>
              Plot.plot({
                width, height: 260, marginLeft: 48, ...axis(),
                x: { label: "hour (UTC)", domain: [0, 23], ticks: [0, 6, 12, 18, 23] },
                y: { label: "↑ import   ↓ export", grid: true },
                marks: [
                  Plot.ruleY([0]),
                  Plot.areaY(hours, { x: "h", y: "mw", fill: cssVar("--accent"), fillOpacity: 0.15 }),
                  Plot.line(hours, { x: "h", y: "mw", stroke: cssVar("--accent"), strokeWidth: 2.5 }),
                ],
              })
            }
          />
        </div>
      </div>
    </Section>
  );
}
