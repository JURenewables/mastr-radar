"use client";

// Wind with batteries or solar (contract v1.12, auctions/colocation.json).
import * as Plot from "@observablehq/plot";
import { useEffect, useState } from "react";

import { DotMap } from "@/components/costs/DotMap";
import { PlotFigure } from "@/components/explorer/PlotFigure";
import { Loading, Section, Segmented, Stat } from "@/components/monitor/ui";
import { cssVar } from "@/lib/theme";

interface Site {
  tier: "same_location" | "nearby";
  kind: "storage" | "solar";
  partner_mw: number;
  partner_mwh: number | null;
  partner_status: string;
  partner_year: number | null;
  wind_mw: number;
  wind_units: number;
  wind_status: string;
  award_rounds: string[];
  distance_km: number;
  state: string | null;
  district: string | null;
  lat: number | null;
  lon: number | null;
  operator: string | null;
}
interface Total { tier: string; kind: string; status: string; sites: number; partner_mw: number; partner_mwh: number | null; wind_mw: number; with_award: number }
interface Combo { tier: string; combo: string; sites: number; wind_mw: number; battery_mw: number; solar_mw: number; planned_sites: number }
interface ByGroup { group: string; "wind+battery": number; "wind+solar": number; "wind+solar+battery": number; battery_mw: number; solar_mw: number }
interface ColocFile { combos?: Combo[]; by_group?: ByGroup[]; as_of: string; rules: { near_km: number; wind_km: number; min_partner_kw: number }; totals: Total[]; by_year: { kind: string; year: number; sites: number; partner_mw: number }[]; sites: Site[] }

const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const mw = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} GW` : `${Math.round(v).toLocaleString("en-GB")} MW`);

export function Colocation({ version }: { version: string }) {
  const [d, setD] = useState<ColocFile | null>(null);
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [kind, setKind] = useState<"storage" | "solar">("storage");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([fetch(`/data/auctions/colocation.json?v=${version}`).then((r) => r.json()), fetch(`/data/boundaries/states.geojson?v=${version}`).then((r) => r.json())])
      .then(([a, g]) => { setD(a); setGeo(g); })
      .catch(() => setFailed(true));
  }, [version]);
  if (failed) return null;
  if (!d || !geo) return <Loading height={400} />;
  const sum = (k: string, st?: string, tier?: string) => d.totals.filter((t) => t.kind === k && (!st || t.status === st) && (!tier || t.tier === tier));
  const agg = (ts: Total[]) => ({ sites: ts.reduce((a, t) => a + t.sites, 0), mw: ts.reduce((a, t) => a + t.partner_mw, 0), mwh: ts.reduce((a, t) => a + (t.partner_mwh ?? 0), 0), award: ts.reduce((a, t) => a + t.with_award, 0) });
  const bOp = agg(sum("storage", "operating"));
  const bPl = agg(sum("storage", "planned"));
  const bSame = agg(sum("storage", undefined, "same_location"));
  const sAll = agg(sum("solar"));
  const sSame = agg(sum("solar", undefined, "same_location"));
  const bAward = agg(sum("storage"));
  const color = kind === "storage" ? cssVar("--tech-storage") : cssVar("--tech-solar");
  const sites = d.sites.filter((s) => s.kind === kind);
  const dots = sites.filter((s) => s.lat != null).map((s) => ({ lon: s.lon!, lat: s.lat!, color, r: Math.max(2.2, Math.min(9, Math.sqrt(s.partner_mw) * 0.9)), ring: s.partner_status === "planned" }));
  const top = sites.filter((s) => s.operator || s.tier === "same_location").slice(0, 10);
  const years = d.by_year.filter((y) => y.kind === kind && y.year >= 2015 && y.year <= 2030);
  const src = <>Source: Marktstammdatenregister, Bundesnetzagentur auction results, as of {day(d.as_of)}. Data processed by MaStR Radar.</>;
  return (
    <Section
      id="colocation"
      eyebrow="Wind with batteries and solar"
      title={`${bOp.sites + bPl.sites} batteries stand or are planned next to wind farms; ${bPl.sites} of them (${mw(bPl.mw)}) are still planned`}
      subtitle={`Two levels: the same grid connection location in the register (confirmed), or a battery or ground-mounted solar park of at least ${d.rules.min_partner_kw / 1000} MW within ${d.rules.near_km * 1000} m of a wind turbine (likely sharing the site). Operating and planned.`}
      asOf={day(d.as_of)}
      source={src}
      takeaways={[
        `Batteries: ${mw(bOp.mw)} operating and ${mw(bPl.mw)} planned (${Math.round(bPl.mwh).toLocaleString("en-GB")} MWh) next to wind. Most are planned: wind-plus-storage is just starting.`,
        (() => {
          const pure = d.combos?.find((c) => c.tier === "same_location" && c.combo === "wind+battery");
          const both = d.combos?.find((c) => c.tier === "same_location" && c.combo === "wind+solar+battery");
          return `Pure wind + battery on one grid connection is still rare: ${pure?.sites ?? 0} sites without solar (${mw(pure?.battery_mw ?? 0)} of batteries), plus ${both?.sites ?? 0} that also have solar. Most batteries next to wind are registered separately, often by a different company.`;
        })(),
        `${bAward.award} battery sites sit next to turbines that won an onshore wind auction.`,
        `Wind and solar together are more common: ${sAll.sites} solar parks (${mw(sAll.mw)}) next to wind, ${sSame.sites} of them on the same grid connection. Wind and sun produce at different times, so they can share one connection.`,
      ]}
      caveats={[
        "\"Nearby\" is a rule of thumb (distance only); a battery near a wind farm may serve the grid rather than the wind farm.",
        "Innovation auctions combine renewables with storage, but the award lists do not say which technologies were combined, so they are not attributed here.",
        "Locations and operator names only for companies; sites of private owners count in the totals only.",
      ]}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Batteries next to wind" value={mw(bOp.mw + bPl.mw)} sub={`${bOp.sites} operating · ${bPl.sites} planned`} swatch={cssVar("--tech-storage")} />
        <Stat label="Battery energy" value={`${Math.round(bOp.mwh + bPl.mwh).toLocaleString("en-GB")} MWh`} sub="operating and planned" />
        <Stat label="Solar parks next to wind" value={mw(sAll.mw)} sub={`${sAll.sites} sites`} swatch={cssVar("--tech-solar")} />
        <Stat label="Same grid connection" value={`${bSame.sites + sSame.sites} sites`} sub={`${bSame.sites} battery · ${sSame.sites} solar`} />
      </div>
      {d.combos && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {(["wind+battery", "wind+solar", "wind+solar+battery"] as const).map((k) => {
            const same = d.combos!.find((c) => c.tier === "same_location" && c.combo === k);
            const near = d.combos!.find((c) => c.tier === "nearby" && c.combo === k);
            return (
              <div key={k} className="rounded-[20px] bg-surface p-4">
                <p className="text-sm font-semibold">{k === "wind+battery" ? "Wind + battery, no solar" : k === "wind+solar" ? "Wind + solar" : "Wind + solar + battery"}</p>
                <p className="figures mt-1 text-2xl font-extrabold">{same?.sites ?? 0} <span className="text-sm font-normal text-ink-muted">on one grid connection</span></p>
                <p className="figures text-sm text-ink-muted">
                  {same ? `${mw(same.battery_mw + same.solar_mw)} with ${mw(same.wind_mw)} wind` : "–"}
                  {near ? ` · ${near.sites} more within ${d.rules.near_km * 1000} m (${near.planned_sites} planned)` : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-6">
        <Segmented
          label="Partner technology"
          value={kind}
          onChange={setKind}
          options={[
            { value: "storage", label: "Batteries", swatch: cssVar("--tech-storage") },
            { value: "solar", label: "Solar parks", swatch: cssVar("--tech-solar") },
          ]}
        />
      </div>
      <div className="mt-6 grid gap-8 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0">
          <DotMap geo={geo} dots={dots} label={`Map of ${kind === "storage" ? "batteries" : "solar parks"} next to onshore wind farms; filled dots operating, rings planned, size by capacity.`} />
          <p className="mt-2 text-xs text-ink-muted">Filled: operating · ring: planned · size: capacity</p>
        </div>
        <div className="min-w-0 space-y-6">
          <div>
            <p className="mb-2 text-sm font-semibold">{kind === "storage" ? "Batteries" : "Solar parks"} added next to wind, per year (MW; planned years ahead)</p>
            <PlotFigure
              deps={[years, kind]}
              render={(width) =>
                Plot.plot({
                  width,
                  height: 200,
                  marginLeft: 40,
                  ...axis(),
                  x: { type: "band", label: null, tickFormat: (y: number) => (y % 2 === 0 ? String(y) : "") },
                  y: { label: null, grid: true },
                  marks: [Plot.barY(years, { x: "year", y: "partner_mw", fill: color, rx: 2, tip: true }), Plot.ruleY([0])],
                })
              }
            />
          </div>
          {d.by_group && (
            <div>
              <p className="mb-2 text-sm font-semibold">Who combines: auction winners with batteries or solar next to their wind</p>
              <div className="overflow-x-auto">
                <table className="figures w-full min-w-[340px] text-xs">
                  <thead className="text-left text-ink-muted"><tr><th className="py-1 pr-2 font-medium">Group</th><th className="py-1 pr-2 font-medium">+battery</th><th className="py-1 pr-2 font-medium">+solar</th><th className="py-1 pr-2 font-medium">+both</th><th className="py-1 font-medium">MW</th></tr></thead>
                  <tbody>
                    {d.by_group.slice(0, 10).map((g) => (
                      <tr key={g.group} className="border-t border-rule">
                        <td className="py-1 pr-2">{g.group}</td>
                        <td className="py-1 pr-2">{g["wind+battery"] || "–"}</td>
                        <td className="py-1 pr-2">{g["wind+solar"] || "–"}</td>
                        <td className="py-1 pr-2">{g["wind+solar+battery"] || "–"}</td>
                        <td className="py-1">{Math.round(g.battery_mw + g.solar_mw)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-semibold">Largest sites</p>
            <ol className="space-y-2 text-sm">
              {top.map((s, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate">{s.operator ?? `${s.district ?? s.state ?? "–"} (same grid connection)`}</span>
                    <span className="block text-[11px] text-ink-muted">
                      {s.district ?? s.state} · {s.partner_status}{s.partner_year ? ` ${s.partner_year}` : ""} · {mw(s.wind_mw)} wind{s.award_rounds.length ? ` · awarded ${s.award_rounds.at(-1)!.slice(0, 7)}` : ""}
                    </span>
                  </span>
                  <span className="figures shrink-0 text-ink-muted">{mw(s.partner_mw)}{s.partner_mwh ? ` · ${Math.round(s.partner_mwh)} MWh` : ""}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </Section>
  );
}
