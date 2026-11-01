"use client";

// Strategy views shared by the wind and solar storylines: groups active in both
// technologies, and what distinguishes winning wind projects.
import * as Plot from "@observablehq/plot";
import type { ReactNode } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { mw, type MonitorData } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

import { CATEGORY_COLOR, roundLabel } from "./Auctions";
import { Section } from "./ui";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const WIND = "#2563eb";
const SUN = "#f59e0b";

// --- Wind and solar ----------------------------------------------------------

export function crossTakeaways(data: MonitorData): ReactNode[] {
  const c = data.solar?.cross_tech ?? [];
  const both = c.filter((x) => x.wind_kw_since_2023 > 0 && x.solar_kw_since_2023 > 0);
  const branched = both.filter((x) => x.first_wind && x.first_solar && x.first_solar > x.first_wind);
  const solarHeavy = both.filter((x) => x.solar_kw_since_2023 > x.wind_kw_since_2023);
  const windOnly = c.filter((x) => x.wind_kw_since_2023 > 100_000 && x.solar_kw_since_2023 === 0).slice(0, 6);
  return [
    both.length ? `Active in both: ${both.slice(0, 8).map((x) => x.group).join(", ")}.` : "",
    branched.length ? `Wind first, solar later: ${branched.slice(0, 6).map((x) => `${x.group} (first solar award ${roundLabel(x.first_solar!)})`).join(", ")}.` : "",
    solarHeavy.length ? `More solar than wind since 2023: ${solarHeavy.slice(0, 5).map((x) => x.group).join(", ")}, mostly utilities and Stadtwerke that use solar as their entry into auctions.` : "",
    windOnly.length ? `Pure wind players (no solar award since 2023): ${windOnly.map((x) => x.group).join(", ")}.` : "",
  ].filter(Boolean);
}

export function CrossTech({ data }: { data: MonitorData }) {
  const rows = (data.solar?.cross_tech ?? []).slice(0, 24);
  const max = Math.max(...rows.map((r) => Math.max(r.wind_kw_since_2023, r.solar_kw_since_2023)), 1);
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: WIND }} />Onshore wind</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: SUN }} />Ground-mounted solar</span>
      </div>
      <ol className="space-y-2">
        {rows.map((r) => (
          <li key={r.group} className="grid grid-cols-[8rem_1fr] items-center gap-2 sm:grid-cols-[12rem_1fr]">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{r.group}</span>
              <span className="block text-[11px] text-ink-muted">{data.auctions?.categories[r.category]}</span>
            </span>
            <div className="min-w-0 space-y-1">
              {[["wind", r.wind_kw_since_2023, WIND], ["solar", r.solar_kw_since_2023, SUN]].map(([k, v, c]) => (
                <div key={k as string} className="flex items-center gap-2">
                  <div className="h-2.5 shrink-0 rounded-full" style={{ width: `${Math.max(0.5, ((v as number) / max) * 70)}%`, background: c as string, opacity: v ? 1 : 0.2 }} />
                  <span className="figures text-[11px] text-ink-muted">{v ? mw((v as number) / 1000) : "–"}</span>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-ink-muted">Awarded capacity since 2023 (both technologies have award-level data from then).</p>
    </div>
  );
}

// --- What makes a wind project win -------------------------------------------

export function SuccessSection({ data, date, source }: { data: MonitorData; date: string; source: ReactNode }) {
  const au = data.auctions!;
  const s = au.success!;
  const byYear = s.permits_by_year;
  const q = s.awarded_by_quality.filter((x) => x.awarded_share != null);
  const vq = s.volume_vs_quality;
  const v = s.awarded_by_voltage.filter((x) => x.voltage !== "unknown");
  const qMin = Math.min(...q.map((x) => x.awarded_share!));
  const qMax = Math.max(...q.map((x) => x.awarded_share!));
  const late = byYear.at(-1);
  const early = byYear.filter((x) => x.year <= 2022);
  return (
    <Section
      id="success"
      eyebrow="What makes a project win"
      title={`Almost every permitted turbine wins: ${pct(s.mature_pool_awarded_share ?? 0)} of those permitted in 2021–2023 already have an award, whatever the wind`}
      subtitle="BNetzA publishes only the winners, so we compare them with all turbines that received a permit: which ones got an award, by year, site quality and grid connection, and whether bigger developers sit on weaker sites."
      asOf={date}
      source={source}
      takeaways={[
        `Award rate by site quality ranges only from ${pct(qMin)} to ${pct(qMax)}: the EEG correction factor neutralises the wind advantage, so weak sites win as often as strong ones.`,
        late && early.length ? `Competition is new: ${pct(early.reduce((t, x) => t + x.awarded_share * x.turbines, 0) / early.reduce((t, x) => t + x.turbines, 0))} of turbines permitted in 2021–22 won, against ${pct(late.awarded_share)} of the ${late.year} permits so far, as permits now outpace the auction volume.` : "",
        v.length ? `Grid connection level makes no visible difference: high- and medium-voltage projects win at the same rate.` : "",
        s.volume_quality_spearman != null ? `Bigger players do not sit on weaker sites (rank correlation volume vs site quality ${s.volume_quality_spearman >= 0 ? "+" : ""}${s.volume_quality_spearman}). If large buyers get cheaper turbines, it does not show up as winning on worse wind.` : "",
        "What really decides is price: with almost equal sites after the correction, the winners are the cheapest bidders, which rewards low turbine, capital and grid costs.",
      ].filter(Boolean)}
      caveats={[
        "Turbines without an award may still bid later, may have lost, or may sell power without EEG support; losing bids are not published.",
        "Turbine prices are confidential, so the theory that volume buyers pay less can only be tested indirectly. Public framework orders (e.g. UKA ordering about 700 MW from Nordex in July 2026) show the partnerships exist.",
        "Distance to the grid connection point needs grid maps (OpenStreetMap, decision pending); the connection voltage level is used as a proxy.",
      ]}
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Share of permitted turbines with an award, by permit year</p>
          <PlotFigure
            deps={[byYear]}
            render={(width) =>
              Plot.plot({
                width, height: 220, marginLeft: 40, ...axis(),
                x: { label: null, type: "band", tickFormat: (d: number) => String(d) },
                y: { label: null, percent: true, domain: [0, 100], tickFormat: (d: number) => `${d}%`, grid: true },
                marks: [
                  Plot.barY(byYear, { x: "year", y: "awarded_share", fill: WIND, rx: 4 }),
                  Plot.text(byYear, { x: "year", y: "awarded_share", text: (d: (typeof byYear)[number]) => pct(d.awarded_share), dy: -8, fill: cssVar("--ink"), fontWeight: 700 }),
                ],
              })
            }
          />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Award rate by site quality (permits 2021–2023)</p>
          <PlotFigure
            deps={[q]}
            render={(width) =>
              Plot.plot({
                width, height: 220, marginLeft: 40, ...axis(),
                x: { label: null, type: "band", domain: q.map((x) => x.band) },
                y: { label: null, percent: true, domain: [0, 100], tickFormat: (d: number) => `${d}%`, grid: true },
                marks: [
                  Plot.barY(q, { x: "band", y: "awarded_share", fill: CATEGORY_COLOR.citizen, rx: 4 }),
                  Plot.text(q, { x: "band", y: "awarded_share", text: (d: (typeof q)[number]) => pct(d.awarded_share!), dy: -8, fill: cssVar("--ink"), fontWeight: 700 }),
                ],
              })
            }
          />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <p className="text-sm font-semibold">Company volume vs average site quality of its awards (groups ≥ 100 MW)</p>
          <PlotFigure
            deps={[vq]}
            render={(width) =>
              Plot.plot({
                width, height: 300, marginLeft: 44, ...axis(),
                x: { label: "Awarded since 2019 (MW) →", type: "log", grid: true },
                y: { label: "Site quality (%)", grid: true },
                marks: [
                  Plot.dot(vq, { x: "mw", y: "quality_pct", r: 5, fill: (d: (typeof vq)[number]) => CATEGORY_COLOR[d.category], fillOpacity: 0.8 }),
                  Plot.text(vq.filter((d) => d.mw > 600), { x: "mw", y: "quality_pct", text: "group", dy: -10, fontSize: 11, fill: cssVar("--ink") }),
                  Plot.tip(vq, Plot.pointer({ x: "mw", y: "quality_pct", title: (d: (typeof vq)[number]) => `${d.group}\n${mw(d.mw)} · site quality ${d.quality_pct}%` })),
                ],
              })
            }
          />
        </div>
      </div>
    </Section>
  );
}
