"use client";

// Players worldwide: the companies that compete in Germany's wind and solar
// auctions, and what they are at home and abroad (auctions/players.json).
import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { Loading, Section, Segmented } from "@/components/monitor/ui";
import { mw } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

type Momentum = "forward" | "steady" | "transition" | "stuck";
type PType = "utility" | "municipal" | "ipp" | "investor" | "developer";
export interface Player {
  name: string;
  group: string | null;
  group_note?: string;
  type: PType;
  hq?: string;
  owner?: string;
  year?: number;
  employees?: { value: number; unit: string; note?: string };
  currency?: string;
  revenue?: number;
  revenue_label?: string;
  ebitda?: { value: number; label: string };
  net_debt?: number;
  net_debt_label?: string;
  capacity_gw?: number;
  renewables_gw?: number;
  own_portfolio_gw?: number;
  capacity_note?: string;
  markets?: string;
  mix?: string;
  turbines?: string;
  momentum: Momentum;
  why: string;
  sources: string[];
  germany: {
    wind_awarded_mw: number | null;
    wind_status: string | null;
    solar_awarded_mw: number | null;
    solar_status: string | null;
    wind_fleet_mw: number | null;
  };
}
interface PlayersFile {
  as_of: string;
  players: Player[];
}

const TYPE_LABEL: Record<PType, string> = {
  utility: "Utility",
  municipal: "Stadtwerk",
  ipp: "IPP",
  investor: "Investor",
  developer: "Developer",
};
const TYPE_COLOR: Record<PType, string> = {
  utility: "#ef4444",
  municipal: "#f59e0b",
  ipp: "#8b5cf6",
  investor: "#0d9488",
  developer: "#2563eb",
};
const MOMENTUM: Record<Momentum, { label: string; color: string }> = {
  forward: { label: "Moving forward", color: "#10b981" },
  steady: { label: "Steady", color: "#94a3b8" },
  transition: { label: "In transition", color: "#f59e0b" },
  stuck: { label: "Stuck or in crisis", color: "#ef4444" },
};
const SYM: Record<string, string> = { EUR: "€", SEK: "SEK ", NOK: "NOK " };

function money(v: number | undefined, cur?: string): string {
  if (v == null || !cur) return "–";
  const s = SYM[cur] ?? `${cur} `;
  const a = Math.abs(v);
  const txt = a >= 1000 ? `${(a / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}bn` : `${a.toLocaleString("en-GB", { maximumFractionDigits: 0 })}m`;
  return `${v < 0 ? "−" : ""}${s}${txt}`;
}
const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
const awarded = (p: Player) => (p.germany.wind_awarded_mw ?? 0) + (p.germany.solar_awarded_mw ?? 0);
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });

export function Players({ version }: { version: string }) {
  const [data, setData] = useState<PlayersFile | null>(null);
  const [filter, setFilter] = useState<"all" | PType>("all");
  useEffect(() => {
    fetch(`/data/auctions/players.json?v=${version}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ as_of: "", players: [] }));
  }, [version]);

  const ps = useMemo(() => data?.players ?? [], [data]);
  if (!data) return <Loading height={500} />;
  if (!ps.length) return <p className="py-10 text-ink-muted">Player data is not available.</p>;

  const shown = filter === "all" ? ps : ps.filter((p) => p.type === filter);
  const scatter = ps.filter((p) => p.employees && awarded(p) > 0);
  const dev = scatter.filter((p) => p.type === "developer").sort((a, b) => awarded(b) - awarded(a))[0];
  const big = scatter.filter((p) => p.type === "utility").sort((a, b) => b.employees!.value - a.employees!.value)[0];
  const asOf = new Date(`${data.as_of}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const source = <>Sources: company reports and press, linked per company, checked {asOf}; German auction figures: Bundesnetzagentur, Marktstammdatenregister. Data processed.</>;
  const by = (m: Momentum) => ps.filter((p) => p.momentum === m);

  return (
    <>
      <Section
        id="size"
        eyebrow="Size vs German success"
        title={dev && big ? `${dev.name} (about ${dev.employees!.value.toLocaleString("en-GB")} staff) won ${mw(awarded(dev))} in German auctions; ${big.name} (${big.employees!.value.toLocaleString("en-GB")}) won ${mw(awarded(big))}` : "Size does not decide German auctions"}
        subtitle="Employees worldwide against capacity won in German onshore wind (since 2019) and ground-mounted solar (since 2023) auctions."
        asOf={asOf}
        source={source}
        takeaways={[
          "Big utilities spread their capital across offshore wind, grids, gas and many countries; German onshore auctions are a small part of their business.",
          "Lean developers live from these auctions: for UKA, wpd or JUWI a won round is the core product.",
          "Utilities buy back in later: many developer-built parks end up with utilities, Stadtwerke and funds, which these award figures do not show.",
        ]}
        caveats={[
          "Awards are attributed by company name and office address; groups bidding through anonymous project companies look smaller.",
          "Employee counts mix headcount and FTE and come from different dates; see each card.",
        ]}
      >
        <PlotFigure
          deps={[scatter]}
          height={360}
          render={(width) =>
            Plot.plot({
              width,
              height: 360,
              marginLeft: 52,
              marginBottom: 40,
              ...axis(),
              x: { type: "log", label: "Employees worldwide →", grid: true, tickFormat: "~s" },
              y: { type: "log", label: "↑ MW won in German auctions", grid: true, tickFormat: "~s" },
              marks: [
                Plot.dot(scatter, { x: (d: Player) => d.employees!.value, y: awarded, r: 7, fill: (d: Player) => TYPE_COLOR[d.type], fillOpacity: 0.85, stroke: cssVar("--paper") }),
                Plot.text(scatter, { x: (d: Player) => d.employees!.value, y: awarded, text: "name", dy: -13, fontSize: 11, fill: cssVar("--ink") }),
                Plot.tip(scatter, Plot.pointer({ x: (d: Player) => d.employees!.value, y: awarded, title: (d: Player) => `${d.name} · ${TYPE_LABEL[d.type]}\n${d.employees!.value.toLocaleString("en-GB")} staff\n${mw(awarded(d))} won in Germany` })),
              ],
            })
          }
        />
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-muted">
          {(Object.keys(TYPE_LABEL) as PType[]).filter((t) => ps.some((p) => p.type === t)).map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLOR[t] }} />{TYPE_LABEL[t]}</span>
          ))}
        </div>
      </Section>

      <Section
        id="compare"
        eyebrow="Side by side"
        title={`${ps.length} players compared: scale, money, footprint and German results`}
        subtitle="Latest reported year per company, in its reporting currency. Scroll the table sideways on a phone."
        asOf={asOf}
        source={source}
        caveats={["Figures are not fully comparable: EBITDA definitions differ (adjusted, underlying, EBIT where nothing else is published), and some companies publish no financials."]}
      >
        <div className="overflow-x-auto rounded-[20px] border border-rule">
          <table className="figures w-full min-w-[960px] text-left text-sm">
            <thead className="bg-surface text-xs text-ink-muted">
              <tr>
                {["Player", "Type", "Staff", "Revenue", "EBITDA / EBIT", "Net debt", "Capacity", "Markets", "German wind won", "German solar won", "Momentum"].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ps.map((p) => (
                <tr key={p.name} className="border-t border-rule align-top">
                  <td className="px-3 py-2 font-semibold">{p.name}{p.year ? <span className="block text-[11px] font-normal text-ink-muted">{p.year}</span> : null}</td>
                  <td className="px-3 py-2">{TYPE_LABEL[p.type]}</td>
                  <td className="px-3 py-2">{p.employees ? p.employees.value.toLocaleString("en-GB") : "–"}</td>
                  <td className="px-3 py-2">{money(p.revenue, p.currency)}</td>
                  <td className="px-3 py-2">{p.ebitda ? <>{money(p.ebitda.value, p.currency)}<span className="block text-[11px] text-ink-muted">{p.ebitda.label}</span></> : "–"}</td>
                  <td className="px-3 py-2">{p.net_debt != null ? (p.net_debt < 0 ? `net cash ${money(-p.net_debt, p.currency)}` : money(p.net_debt, p.currency)) : "–"}</td>
                  <td className="px-3 py-2">{p.capacity_gw ? `${p.capacity_gw} GW` : "–"}{p.own_portfolio_gw ? <span className="block text-[11px] text-ink-muted">own {p.own_portfolio_gw} GW</span> : null}</td>
                  <td className="max-w-[14rem] px-3 py-2 text-xs text-ink-muted">{p.markets ?? "–"}</td>
                  <td className="px-3 py-2">{p.germany.wind_awarded_mw ? mw(p.germany.wind_awarded_mw) : "–"}</td>
                  <td className="px-3 py-2">{p.germany.solar_awarded_mw ? mw(p.germany.solar_awarded_mw) : "–"}</td>
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: MOMENTUM[p.momentum].color }} />{MOMENTUM[p.momentum].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="momentum"
        eyebrow="Who moves, who is stuck"
        title={`${by("forward").length} players moving forward, ${by("stuck").length} stuck or in crisis`}
        subtitle="Our assessment from the reported figures, German auction results and recent news; each card gives the reason and sources."
        asOf={asOf}
        source={source}
        caveats={["Momentum is an editorial assessment, not a rating; it reflects the last 12–18 months."]}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(MOMENTUM) as Momentum[]).map((m) => (
            <div key={m} className="rounded-[20px] bg-surface p-4">
              <p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: MOMENTUM[m].color }} />{MOMENTUM[m].label}</p>
              <ul className="mt-2 space-y-2 text-sm">
                {by(m).map((p) => (
                  <li key={p.name}><span className="font-semibold">{p.name}</span><span className="block text-xs text-ink-muted">{p.why}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="profiles"
        eyebrow="Profiles"
        title="What each player is: generation mix, footprint and strategy"
        subtitle="From coal, gas and nuclear utilities to pure wind and solar developers."
        asOf={asOf}
        source={source}
      >
        <Segmented
          label="Player type"
          value={filter}
          onChange={setFilter}
          options={[{ value: "all", label: "All" }, ...(Object.keys(TYPE_LABEL) as PType[]).filter((t) => ps.some((p) => p.type === t)).map((t) => ({ value: t, label: TYPE_LABEL[t], swatch: TYPE_COLOR[t] }))]}
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <article key={p.name} className="flex flex-col rounded-[20px] border border-rule p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-lg font-extrabold tracking-tight">{p.name}</h3>
                <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white" style={{ background: TYPE_COLOR[p.type] }}>{TYPE_LABEL[p.type]}</span>
              </div>
              {(p.hq || p.owner) && <p className="mt-1 text-xs text-ink-muted">{[p.hq, p.owner].filter(Boolean).join(" · ")}</p>}
              <dl className="figures mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {p.employees && (<><dt className="text-ink-muted">Staff</dt><dd>{p.employees.value.toLocaleString("en-GB")} {p.employees.note ? <span className="text-[11px] text-ink-muted">({p.employees.note})</span> : null}</dd></>)}
                {p.ebitda && (<><dt className="text-ink-muted">{p.ebitda.label}</dt><dd>{money(p.ebitda.value, p.currency)}</dd></>)}
                {p.net_debt != null && (<><dt className="text-ink-muted">{p.net_debt_label ?? "Net debt"}</dt><dd>{money(Math.abs(p.net_debt), p.currency)}{p.net_debt < 0 ? " (cash)" : ""}</dd></>)}
                {p.capacity_gw && (<><dt className="text-ink-muted">Capacity</dt><dd>{p.capacity_gw} GW</dd></>)}
                {(p.germany.wind_awarded_mw || p.germany.solar_awarded_mw) && (<><dt className="text-ink-muted">Won in Germany</dt><dd>{[p.germany.wind_awarded_mw ? `${mw(p.germany.wind_awarded_mw)} wind` : "", p.germany.solar_awarded_mw ? `${mw(p.germany.solar_awarded_mw)} solar` : ""].filter(Boolean).join(", ")}</dd></>)}
              </dl>
              {p.group_note && <p className="mt-1 text-[11px] text-ink-muted">{p.group_note}</p>}
              {p.capacity_note && <p className="mt-3 text-sm text-ink-muted">{p.capacity_note}</p>}
              {p.mix && <p className="mt-2 text-sm"><span className="font-semibold">Mix: </span>{p.mix}</p>}
              {p.markets && <p className="mt-2 text-sm"><span className="font-semibold">Markets: </span>{p.markets}</p>}
              {p.turbines && <p className="mt-2 text-sm"><span className="font-semibold">Turbines: </span>{p.turbines}</p>}
              <p className="mt-3 flex items-start gap-1.5 text-sm"><span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: MOMENTUM[p.momentum].color }} /><span><span className="font-semibold">{MOMENTUM[p.momentum].label}: </span>{p.why}</span></p>
              <p className="mt-3 flex-1 text-[11px] text-ink-muted">
                {p.sources.map((u, i) => (<a key={u} href={u} target="_blank" rel="noreferrer" className="mr-1 underline decoration-rule underline-offset-2 hover:text-ink">[{i + 1}] {host(u)}</a>))}
              </p>
            </article>
          ))}
        </div>
      </Section>
    </>
  );
}
