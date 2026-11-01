"use client";

// Onshore wind auctions (contract v1.6 draft): award prices and the estimated
// value projects receive after the site correction, a merit order of the
// awarded projects by estimated full-load hours, winners by company group and
// bidder type over time, who owns the turbines, and why developers win.
import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { mw, type AuctionCategory, type Auctions } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

import { BarRace } from "./BarRace";
import { Segmented, Stat } from "./ui";
import { brandColor } from "./WindIndustry";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const roundLabel = (bidDate: string) => `${MONTHS[Number(bidDate.slice(5, 7)) - 1]} ${bidDate.slice(2, 4)}`;
const ct = (v: number | null | undefined) =>
  v == null ? "–" : v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (v: number | null | undefined) => (v == null ? "–" : Math.round(v).toLocaleString("en-GB"));

export const CATEGORY_ORDER: AuctionCategory[] = ["developer", "utility", "municipal", "citizen", "unattributed"];
export const CATEGORY_COLOR: Record<AuctionCategory, string> = {
  developer: "#2563eb",
  utility: "#ef4444",
  municipal: "#f59e0b",
  citizen: "#10b981",
  unattributed: "#94a3b8",
};
const BUCKET_NOTE: Record<string, string> = {
  "Not attributed": "project companies, owner unknown",
  "Citizen & local (all)": "many citizen wind farms, co-ops, farmers",
  "Other Stadtwerke": "many municipal utilities",
};
const axis = () => ({
  style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") },
});
const date = (d: string) => new Date(`${d}T00:00:00Z`);

function Legend({ a, cats = CATEGORY_ORDER }: { a: Auctions; cats?: AuctionCategory[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
      {cats.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
          {a.categories[c]}
        </span>
      ))}
    </div>
  );
}

function RoundSelect({ a, value, onChange }: { a: Auctions; value: string; onChange: (id: string) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm font-semibold">
      Round
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-full border border-rule bg-surface px-3 py-1.5 text-sm font-semibold"
      >
        {[...a.rounds].reverse().map((r) => (
          <option key={r.id} value={r.id}>
            {roundLabel(r.bid_date)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Horizontal bars with a label column; buckets (many companies) are striped. */
export function GroupBars({
  rows,
  max,
  value,
}: {
  rows: { group: string; category: AuctionCategory; mw: number; share?: number; extra?: string; bucket?: boolean }[];
  max: number;
  value?: (r: { mw: number; share?: number; extra?: string }) => string;
}) {
  return (
    <ol className="space-y-2.5">
      {rows.map((w, i) => (
        <li key={w.group} className="grid grid-cols-[1.25rem_7.5rem_1fr] items-center gap-2 sm:grid-cols-[1.5rem_12rem_1fr]">
          <span className="figures text-xs text-ink-muted">{i + 1}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{w.group}</span>
            {w.bucket && BUCKET_NOTE[w.group] && (
              <span className="block truncate text-[11px] leading-tight text-ink-muted">{BUCKET_NOTE[w.group]}</span>
            )}
          </span>
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <div
              className="h-5 shrink-0 rounded-full"
              style={{
                width: `${Math.max(1, (w.mw / max) * 55)}%`,
                background: w.bucket
                  ? `repeating-linear-gradient(135deg, ${CATEGORY_COLOR[w.category]} 0 6px, transparent 6px 9px)`
                  : CATEGORY_COLOR[w.category],
                border: w.bucket ? `1.5px solid ${CATEGORY_COLOR[w.category]}` : undefined,
              }}
            />
            <span className="figures min-w-0 truncate text-xs font-semibold text-ink-muted sm:text-sm">
              {value ? value(w) : mw(w.mw)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

// --- Prices: award value and estimated received value -----------------------

export function AuctionPrices({ a }: { a: Auctions }) {
  const rows = a.rounds.map((r) => ({ ...r, d: date(r.bid_date), label: roundLabel(r.bid_date) }));
  const last = rows.at(-1)!;
  const first = rows[0];
  const yMin = Math.floor(Math.min(...rows.map((r) => r.min_ct ?? r.avg_ct)) - 0.3);
  const yMax = Math.ceil(Math.max(...rows.map((r) => Math.max(r.ceiling_ct ?? 0, r.received_ct_est ?? 0))) + 0.2);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={`Average award, ${last.label}`}
          value={`${ct(last.avg_ct)} ct`}
          sub={`${last.avg_ct - first.avg_ct > 0 ? "+" : "−"}${ct(Math.abs(last.avg_ct - first.avg_ct))} ct since ${first.label}`}
        />
        <Stat label="× correction factor (est.)" value={last.correction_factor_avg?.toFixed(3) ?? "–"} sub={`site quality ≈ ${last.quality_pct_avg ?? "–"}%`} />
        <Stat label="= received value (est.)" value={`${ct(last.received_ct_est)} ct`} sub="per kWh, average of the round" />
        <Stat label={`Awarded, ${last.label}`} value={mw((last.awarded_kw ?? last.list_kw) / 1000)} sub={`${last.awards ?? last.list_awards} awards`} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-accent" />Average award value</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4" style={{ background: CATEGORY_COLOR.municipal }} />Estimated value received after correction</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 border-t border-dashed border-ink-muted" />Ceiling</span>
      </div>
      <PlotFigure
        deps={[rows]}
        render={(width) =>
          Plot.plot({
            width,
            height: 320,
            marginLeft: 40,
            marginRight: 16,
            ...axis(),
            x: { label: null, type: "utc" },
            y: { label: "ct/kWh", domain: [yMin, yMax], grid: true },
            marks: [
              Plot.lineY(rows.filter((r) => r.ceiling_ct), { x: "d", y: "ceiling_ct", curve: "step-after", stroke: cssVar("--ink-muted"), strokeDasharray: "4 4", strokeWidth: 1.5 }),
              Plot.ruleX(rows.filter((r) => r.min_ct != null && r.max_ct != null), { x: "d", y1: "min_ct", y2: "max_ct", stroke: cssVar("--accent"), strokeOpacity: 0.3, strokeWidth: width < 500 ? 4 : 7, strokeLinecap: "round" }),
              Plot.lineY(rows.filter((r) => r.received_ct_est), { x: "d", y: "received_ct_est", stroke: CATEGORY_COLOR.municipal, strokeWidth: 2.5 }),
              Plot.lineY(rows, { x: "d", y: "avg_ct", stroke: cssVar("--accent"), strokeWidth: 1.5, strokeOpacity: 0.6 }),
              Plot.dot(rows, { x: "d", y: "avg_ct", r: 4, fill: cssVar("--accent"), stroke: cssVar("--paper"), strokeWidth: 1.5 }),
              Plot.text([last], { x: "d", y: "avg_ct", text: (d: typeof last) => ct(d.avg_ct), dy: 16, textAnchor: "end", fontWeight: 700, fill: cssVar("--ink") }),
              Plot.text([last], { x: "d", y: "received_ct_est", text: (d: typeof last) => ct(d.received_ct_est), dy: -12, textAnchor: "end", fontWeight: 700, fill: CATEGORY_COLOR.municipal }),
              Plot.tip(
                rows,
                Plot.pointerX({
                  x: "d",
                  y: "avg_ct",
                  title: (d: (typeof rows)[number]) =>
                    `${d.label}: average award ${ct(d.avg_ct)} ct/kWh` +
                    (d.min_ct != null ? `\nlowest ${ct(d.min_ct)} · highest ${ct(d.max_ct)}` : "") +
                    (d.received_ct_est ? `\nest. received ${ct(d.received_ct_est)} (factor ${d.correction_factor_avg?.toFixed(3)})` : "") +
                    `\n${mw(d.list_kw / 1000)} awarded`,
                }),
              ),
            ],
          })
        }
      />
      <p className="text-xs text-ink-muted">
        The award value is what a project bid for a reference site. The EEG then multiplies it by a
        correction factor (Korrekturfaktor) that depends on the site&apos;s quality factor (Gütefaktor):
        weaker sites get more than they bid, stronger sites less. Single bids are not published, so the
        received value uses each round&apos;s average award value times the estimated correction factor
        of its projects. Rounds since May 2019.
      </p>
    </div>
  );
}

// --- Merit order by full-load hours ------------------------------------------

type MeritRow = { x1: number; x2: number; flh: number; quality: number; cat: AuctionCategory; mw: number };

export function AuctionYield({ a }: { a: Auctions }) {
  const [id, setId] = useState(a.rounds.at(-1)!.id);
  const [metric, setMetric] = useState<"full_load_hours_avg" | "quality_pct_avg" | "correction_factor_avg">("full_load_hours_avg");
  const round = a.rounds.find((r) => r.id === id)!;
  const merit = useMemo(
    () =>
      a.merit_order[id].reduce<MeritRow[]>((acc, [m, flh, quality, ci]) => {
        const x1 = acc.at(-1)?.x2 ?? 0;
        return [...acc, { x1, x2: x1 + m, flh, quality, cat: CATEGORY_ORDER[ci], mw: m }];
      }, []),
    [a, id],
  );
  const trend = a.rounds
    .filter((r) => r[metric] != null)
    .map((r) => ({ d: date(r.bid_date), v: r[metric] as number, label: roundLabel(r.bid_date) }));
  const unit = metric === "full_load_hours_avg" ? "h" : metric === "quality_pct_avg" ? "%" : "";
  const totalMw = merit.at(-1)?.x2 ?? 0;
  const median = merit.find((m) => m.x2 >= totalMw / 2)?.flh;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RoundSelect a={a} value={id} onChange={setId} />
        <Legend a={a} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Full-load hours (est.)" value={`${int(round.full_load_hours_avg)} h`} sub={`median project ${int(median)} h`} />
        <Stat label="Site quality (Gütefaktor)" value={`${round.quality_pct_avg ?? "–"}%`} sub="of the EEG reference site" />
        <Stat label="Correction factor" value={round.correction_factor_avg?.toFixed(3) ?? "–"} sub="capacity-weighted average" />
        <Stat label="Award → received" value={`${ct(round.avg_ct)} → ${ct(round.received_ct_est)}`} sub="ct/kWh (estimate)" />
      </div>
      <div>
        <p className="text-sm font-semibold">
          Merit order of the {roundLabel(round.bid_date)} awards: estimated full-load hours, best sites first
        </p>
        <PlotFigure
          deps={[merit]}
          render={(width) =>
            Plot.plot({
              width,
              height: 300,
              marginLeft: 48,
              ...axis(),
              x: { label: "Awarded capacity (MW), cumulative →", grid: false },
              y: { label: "Full-load hours per year", grid: true, zero: true },
              color: { domain: CATEGORY_ORDER, range: CATEGORY_ORDER.map((c) => CATEGORY_COLOR[c]) },
              marks: [
                Plot.rectY(merit, { x1: "x1", x2: "x2", y: "flh", fill: "cat", insetLeft: merit.length > 150 ? 0 : 0.3 }),
                round.full_load_hours_avg ? Plot.ruleY([round.full_load_hours_avg], { stroke: cssVar("--ink"), strokeDasharray: "3 3" }) : null,
                Plot.tip(
                  merit,
                  Plot.pointerX({
                    x: (d: MeritRow) => (d.x1 + d.x2) / 2,
                    y: "flh",
                    title: (d: MeritRow) =>
                      `${a.categories[d.cat]} · ${d.mw.toFixed(1)} MW\n${d.flh.toLocaleString("en-GB")} full-load hours\nsite quality ${d.quality}%`,
                  }),
                ),
              ],
            })
          }
        />
        <p className="text-xs text-ink-muted">
          Each block is one award, as wide as its capacity. Dashed line: capacity-weighted average.
        </p>
      </div>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">Average per round since 2019</p>
          <Segmented
            label="Measure"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "full_load_hours_avg", label: "Full-load hours" },
              { value: "quality_pct_avg", label: "Site quality" },
              { value: "correction_factor_avg", label: "Correction factor" },
            ]}
          />
        </div>
        <PlotFigure
          deps={[trend, metric]}
          render={(width) =>
            Plot.plot({
              width,
              height: 220,
              marginLeft: 48,
              ...axis(),
              x: { label: null, type: "utc" },
              y: { label: unit || "factor", grid: true, zero: metric === "full_load_hours_avg" },
              marks: [
                Plot.lineY(trend, { x: "d", y: "v", stroke: cssVar("--accent"), strokeWidth: 2.5 }),
                Plot.dot(trend, { x: "d", y: "v", r: 3, fill: cssVar("--accent") }),
                Plot.tip(trend, Plot.pointerX({ x: "d", y: "v", title: (d: (typeof trend)[number]) => `${d.label}: ${d.v}${unit ? ` ${unit}` : ""}` })),
              ],
            })
          }
        />
      </div>
      <p className="text-xs text-ink-muted">
        Estimate, not a yield report. Each awarded turbine is located through its MaStR record
        (coordinates, hub height, rotor, rating). Wind: DWD 200 m grid (mean wind 1981–2000 at 80 and
        100 m, extrapolated to hub height). A generic power curve from rating and rotor gives the gross
        yield; full-load hours are net of {Math.round(a.model.losses * 100)}% typical losses (wake,
        availability). Site quality compares the same turbine with the EEG reference site (6.45 m/s at
        100 m); the correction factor follows the EEG table of the bid year. Curtailment is not included.
      </p>
    </div>
  );
}

// --- Winners ----------------------------------------------------------------

export function AuctionWinners({ a, brands }: { a: Auctions; brands: string[] }) {
  const years = Object.keys(a.winners_by_year).filter((y) => y !== "all").sort();
  const [year, setYear] = useState(years.at(-1)!);
  const [hidden, setHidden] = useState<AuctionCategory[]>([]);
  const winners = a.winners_by_year[year].filter((w) => !hidden.includes(w.category)).slice(0, 15);
  const rounds = year === "all" ? a.rounds : a.rounds.filter((r) => r.bid_date.startsWith(year));
  const max = Math.max(...winners.map((w) => w.kw), 1) / 1000;

  // Turbine makers in the awards (linked through MaStR).
  const makers: Record<string, number> = {};
  for (const r of rounds) for (const [b, kw] of Object.entries(r.kw_by_maker)) makers[b] = (makers[b] ?? 0) + kw;
  const makerTotal = Object.values(makers).reduce((s, v) => s + v, 0) || 1;
  const makerRows = Object.entries(
    Object.entries(makers).reduce<Record<string, number>>((acc, [b, kw]) => {
      const key = kw / makerTotal < 0.01 ? "Other" : b;
      acc[key] = (acc[key] ?? 0) + kw;
      return acc;
    }, {}),
  ).sort((x, y) => (x[0] === "Other" ? 1 : y[0] === "Other" ? -1 : y[1] - x[1]));

  return (
    <div className="space-y-10">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Year"
            value={year}
            onChange={setYear}
            options={[...years.map((y) => ({ value: y, label: y })), { value: "all", label: `All ${years[0]}–${years.at(-1)!.slice(2)}` }]}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Show bidder types">
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
        <p className="mt-4 text-sm font-semibold">
          Awarded onshore capacity {year === "all" ? `${years[0]}–${years.at(-1)}` : year}
          {year !== "all" && `: ${rounds.map((r) => roundLabel(r.bid_date)).join(", ")}`}
        </p>
        <div className="mt-3" aria-label={`Company groups with the most awarded onshore capacity, ${year}`}>
          <GroupBars
            rows={winners.map((w) => ({ ...w, mw: w.kw / 1000 }))}
            max={max}
            value={(w) => `${mw(w.mw)} · ${((w.share ?? 0) * 100).toFixed(1)}%`}
          />
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Striped bars stand for many companies, not one competitor. Bidders are grouped by the company
          name in the award list (e.g. “wpd Windpark Nr. 440 GmbH & Co. KG” → wpd). Project companies
          that carry no group name are traced through the office address the operator company registered
          in MaStR: if the other companies registered there belong to one group, the award counts for
          it. Awards that company sources tie to a group are assigned by hand. Share of capacity:{" "}
          {(() => {
            const t = Object.values(a.attribution_kw).reduce((x, y) => x + y, 0) || 1;
            const pct = (k: keyof typeof a.attribution_kw) => Math.round((a.attribution_kw[k] / t) * 100);
            return `${pct("name")}% by company name, ${pct("office")}% by office address, ${pct("reviewed") || "<1"}% by hand, ${pct("none")}% still not attributed.`;
          })()}
          Alterric (EWE / Aloys Wobben Stiftung) counts as an IPP; enercity as a Stadtwerk.
        </p>
      </div>

      <div>
        <p className="text-sm font-semibold">Turbines in these awards, by maker</p>
        <div className="mt-3 flex h-7 overflow-hidden rounded-full" role="img" aria-label={makerRows.map(([b, kw]) => `${b} ${Math.round((kw / makerTotal) * 100)}%`).join(", ")}>
          {makerRows.map(([b, kw]) => (
            <div key={b} style={{ width: `${(kw / makerTotal) * 100}%`, background: brandColor(brands, b) }} title={`${b}: ${Math.round((kw / makerTotal) * 100)}%`} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {makerRows.map(([b, kw]) => (
            <span key={b} className="figures">
              <b className="text-ink">{b}</b> {Math.round((kw / makerTotal) * 100)}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Cross-check with company announcements ---------------------------------

export function AuctionCrossCheck({ a }: { a: Auctions }) {
  const rows = [...a.company_reported].sort((x, y) => y.bid_date.localeCompare(x.bid_date) || x.group.localeCompare(y.group));
  const verdict = (r: (typeof rows)[number]) => {
    const ratio = r.ours_mw / r.reported_mw;
    if (r.qualifier === "over") return ratio >= 0.97 ? "match" : "under";
    if (Math.abs(ratio - 1) <= 0.04) return "match";
    return ratio < 1 ? "under" : "over";
  };
  const matches = rows.filter((r) => verdict(r) === "match").length;
  const q = { exact: "", about: "≈ ", over: "> " } as const;
  const max = Math.max(...rows.map((r) => Math.max(r.reported_mw, r.ours_mw)), 1);
  return (
    <div>
      <p className="text-sm font-semibold">Checked against company announcements</p>
      <p className="mt-1 text-xs text-ink-muted">
        {matches} of {rows.length} round totals that companies announced match the award list within 4%.
        Groups that bid through neutrally named project companies show less here than they announce; the
        gap sits in “Not attributed”. {a.reviewed_awards} awards are assigned by hand from company
        sources.
      </p>
      <div className="mt-3 overflow-x-auto rounded-[20px] border border-rule">
        <table className="figures w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-xs text-ink-muted">
              <th className="p-3 font-semibold">Company</th>
              <th className="p-3 font-semibold">Round</th>
              <th className="p-3 font-semibold">In the award list</th>
              <th className="p-3 font-semibold">Company says</th>
              <th className="w-1/3 p-3 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = verdict(r);
              return (
                <tr key={`${r.group}-${r.round}`} className="border-b border-rule last:border-0 align-top">
                  <td className="p-3 font-semibold">{r.group}</td>
                  <td className="p-3">{roundLabel(r.bid_date)}</td>
                  <td className="p-3">{mw(r.ours_mw)}</td>
                  <td className="p-3">
                    <a href={r.source} className="underline decoration-rule underline-offset-2" target="_blank" rel="noreferrer">
                      {q[r.qualifier]}
                      {mw(r.reported_mw)}
                    </a>
                    {r.note && <span className="block text-[11px] text-ink-muted">{r.note}</span>}
                  </td>
                  <td className="p-3">
                    <div className="relative h-4 rounded-full bg-surface" aria-label={v === "match" ? "matches" : v === "under" ? "less in the award list" : "more in the award list"}>
                      <div className="absolute inset-y-0 left-0 rounded-full border-2 border-dashed border-ink-muted" style={{ width: `${(r.reported_mw / max) * 100}%` }} />
                      <div className="absolute inset-y-0.5 left-0.5 rounded-full" style={{ width: `${(r.ours_mw / max) * 100}%`, background: v === "match" ? CATEGORY_COLOR.citizen : CATEGORY_COLOR.municipal }} />
                    </div>
                    <span className="mt-1 block text-[11px] text-ink-muted">{v === "match" ? "✓ matches" : v === "under" ? `${Math.round((1 - r.ours_mw / r.reported_mw) * 100)}% not visible by name` : "more in the list than announced"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Dashed outline: what the company announced; filled bar: what the award list shows for that group.
        Linked figures open the company or press source.
      </p>
    </div>
  );
}

// --- Race of winners and the share of the cake ------------------------------

export function AuctionRace({ a }: { a: Auctions }) {
  const [view, setView] = useState<"companies" | "types">("companies");
  const [mode, setMode] = useState<"cumulative" | "year">("cumulative");
  const steps = a.race.years;
  const cum = (xs: number[]) => xs.reduce<number[]>((acc, v) => [...acc, (acc.at(-1) ?? 0) + v], []);
  const toMw = (xs: number[]) => xs.map((v) => v / 1000);
  const companies = useMemo(() => {
    const v: Record<string, number[]> = {};
    for (const g of a.race.groups) v[g] = toMw(mode === "cumulative" ? cum(a.race.kw[g]) : a.race.kw[g]);
    return v;
  }, [a, mode]);
  const types = useMemo(() => {
    const v: Record<string, number[]> = {};
    for (const c of CATEGORY_ORDER) v[a.categories[c]] = toMw(mode === "cumulative" ? cum(a.kw_by_category_year[c]) : a.kw_by_category_year[c]);
    return v;
  }, [a, mode]);
  const catOfGroup = Object.fromEntries(a.race.groups.map((g, i) => [g, a.race.categories[i]]));
  const catOfLabel = Object.fromEntries(CATEGORY_ORDER.map((c) => [a.categories[c], c]));
  const controls = (
    <>
      <Segmented label="View" value={view} onChange={setView} options={[{ value: "companies", label: "Companies" }, { value: "types", label: "Bidder types" }]} />
      <Segmented label="Measure" value={mode} onChange={setMode} options={[{ value: "cumulative", label: "Since 2019" }, { value: "year", label: "Per year" }]} />
    </>
  );
  return (
    <div className="space-y-3">
      {view === "companies" ? (
        <BarRace
          key="companies"
          steps={steps}
          names={a.race.groups}
          values={companies}
          colorOf={(n) => CATEGORY_COLOR[catOfGroup[n] ?? "unattributed"]}
          pinned={["Not attributed", "Citizen & local (all)"]}
          rows={12}
          totalLabel={(s) => (mode === "cumulative" ? `awarded ${steps[0]}–${s}` : `awarded in ${s}`)}
          controls={controls}
          ariaLabel="Auction winners by company group"
        />
      ) : (
        <BarRace
          key="types"
          steps={steps}
          names={Object.keys(types)}
          values={types}
          colorOf={(n) => CATEGORY_COLOR[catOfLabel[n]]}
          rows={5}
          totalLabel={(s) => (mode === "cumulative" ? `awarded ${steps[0]}–${s}` : `awarded in ${s}`)}
          controls={controls}
          ariaLabel="Auction winners by bidder type"
        />
      )}
      <Legend a={a} />
      <p className="text-xs text-ink-muted">
        {steps.at(-1)} includes the rounds awarded so far. The 15 company groups with the most capacity
        since 2019 race against the many citizen wind farms and the project companies whose owner is
        unknown.
      </p>
    </div>
  );
}

export function AuctionCake({ a }: { a: Auctions }) {
  const [base, setBase] = useState<"known" | "all">("known");
  const cats = base === "known" ? CATEGORY_ORDER.filter((c) => c !== "unattributed") : CATEGORY_ORDER;
  const rows = useMemo(
    () =>
      a.race.years.flatMap((y, i) => {
        const total = cats.reduce((s, c) => s + a.kw_by_category_year[c][i], 0) || 1;
        return cats.map((c) => ({ year: Number(y), cat: a.categories[c], key: c, share: a.kw_by_category_year[c][i] / total }));
      }),
    [a, cats],
  );
  const labels = cats.map((c) => a.categories[c]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">Share of awarded capacity per year</p>
        <Segmented label="Base" value={base} onChange={setBase} options={[{ value: "known", label: "Known bidders" }, { value: "all", label: "All capacity" }]} />
      </div>
      <Legend a={a} cats={cats} />
      <PlotFigure
        deps={[rows]}
        render={(width) =>
          Plot.plot({
            width,
            height: 280,
            marginLeft: 40,
            ...axis(),
            x: { label: null, tickFormat: (d: number) => String(d), ticks: a.race.years.map(Number) },
            y: { label: null, percent: true, tickFormat: (d: number) => `${d}%`, grid: true },
            color: { domain: labels, range: cats.map((c) => CATEGORY_COLOR[c]) },
            marks: [
              Plot.areaY(rows, { x: "year", y: "share", fill: "cat", order: labels, stroke: cssVar("--paper"), strokeWidth: 0.5, curve: "monotone-x" }),
              Plot.tip(
                rows,
                Plot.pointerX(
                  Plot.stackY({
                    x: "year",
                    y: "share",
                    z: "cat",
                    order: labels,
                    title: (d: (typeof rows)[number]) => `${d.year} · ${d.cat}: ${Math.round(d.share * 100)}%`,
                  }),
                ),
              ),
            ],
          })
        }
      />
      <p className="text-xs text-ink-muted">
        “Known bidders” leaves out the {Math.round(a.unattributed_share * 100)}% of capacity whose owner
        the award list does not reveal; that share is spread across all types, mostly developers&apos;
        project companies.
      </p>
    </div>
  );
}

// --- Who owns the turbines, and why developers win ---------------------------

export function AuctionPlayers({ a }: { a: Auctions }) {
  const [view, setView] = useState<"awards" | "fleet">("awards");
  const awards = a.operating_from_awards.slice(0, 12).map((r) => ({ ...r, bucket: r.group in BUCKET_NOTE }));
  const fleet = a.fleet.groups.slice(0, 14);
  const rows = view === "awards" ? awards : fleet;
  const max = Math.max(...rows.map((r) => r.mw), 1);
  const d = a.drivers;
  const cols: AuctionCategory[] = ["developer", "utility", "municipal", "citizen"];
  const metrics: { label: string; v: (x: (typeof d)[AuctionCategory]) => string; note?: string }[] = [
    { label: "Awarded since 2019", v: (x) => mw(x.awarded_mw) },
    { label: "Awards", v: (x) => x.awards.toLocaleString("en-GB") },
    { label: "Bidding companies", v: (x) => x.distinct_bidders.toLocaleString("en-GB") },
    { label: "Median award size", v: (x) => (x.median_award_mw == null ? "–" : `${x.median_award_mw} MW`) },
    { label: "Site quality (est.)", v: (x) => (x.quality_pct_avg == null ? "–" : `${x.quality_pct_avg}%`), note: "Lower = weaker wind sites, which need a lower cost base to win" },
    { label: "Full-load hours (est.)", v: (x) => `${int(x.full_load_hours_avg)} h` },
    { label: "Months from bid to operation", v: (x) => (x.median_months_to_operation == null ? "–" : `${x.median_months_to_operation}`), note: "Median of turbines already running" },
    { label: `In operation (awards before ${a.drivers_realised_cutoff.slice(0, 7)})`, v: (x) => (x.realised_share == null ? "–" : `${Math.round(x.realised_share * 100)}%`) },
  ];
  return (
    <div className="space-y-12">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">{view === "awards" ? "Auction projects since 2019 now in operation" : "All onshore wind in operation, by operator"}</p>
          <Segmented label="Basis" value={view} onChange={setView} options={[{ value: "awards", label: "From auctions" }, { value: "fleet", label: "Whole fleet" }]} />
        </div>
        <div className="mt-4">
          <GroupBars rows={rows} max={max} value={(r) => (r.share != null ? `${mw(r.mw)} · ${(r.share * 100).toFixed(1)}%` : mw(r.mw))} />
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          {view === "awards"
            ? "Capacity of awarded turbines that MaStR lists as in operation, by the group that won the award."
            : `Operator names from MaStR for all ${mw(a.fleet.total_mw)} of onshore wind in operation. Most wind farms are run by their own project company, so the owner is often not visible from the name (“not attributed”), and private owners are never named.`}
        </p>
      </div>

      <div>
        <p className="text-sm font-semibold">What the data shows, by bidder type</p>
        <div className="mt-3 overflow-x-auto rounded-[20px] border border-rule">
          <table className="figures w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs text-ink-muted">
                <th className="p-3 font-semibold" />
                {cols.map((c) => (
                  <th key={c} className="p-3 font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
                      {a.categories[c]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.label} className="border-b border-rule last:border-0">
                  <th className="p-3 text-left font-semibold">
                    {m.label}
                    {m.note && <span className="block text-[11px] font-normal text-ink-muted">{m.note}</span>}
                  </th>
                  {cols.map((c) => (
                    <td key={c} className="p-3">{m.v(d[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold">Why developers and IPPs win more: our assessment</p>
        <p className="mt-1 text-xs text-ink-muted">
          Editorial analysis based on industry practice and the figures above. It is not measured from
          the register and simplifies a varied market.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {DRIVERS.map((x) => (
            <div key={x.title} className="rounded-[20px] bg-surface p-5">
              <p className="font-bold">{x.title}</p>
              <p className="mt-1 text-sm text-ink-muted">{x.text}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                {(["developer", "utility", "municipal"] as const).map((c, i) => (
                  <div key={c}>
                    <p className="truncate text-ink-muted">{a.categories[c]}</p>
                    <p className="font-semibold tracking-widest" style={{ color: CATEGORY_COLOR[c] }} aria-label={`${x.scores[i]} of 3`}>
                      {"●".repeat(x.scores[i])}
                      <span className="text-rule">{"●".repeat(3 - x.scores[i])}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Scores: developers & IPPs, utilities, Stadtwerke (3 = strong advantage in auctions). */
const DRIVERS: { title: string; text: string; scores: [number, number, number] }[] = [
  {
    title: "Pipeline and land",
    text: "Securing sites, permits and landowners is the developers' core business, with local teams in every region. Utilities often buy projects instead; Stadtwerke stay in their own region.",
    scores: [3, 2, 2],
  },
  {
    title: "Lean cost base",
    text: "Small teams and standardised projects keep overheads low, so developers can bid lower and still earn their margin, even at weaker sites.",
    scores: [3, 1, 2],
  },
  {
    title: "Project finance",
    text: "Non-recourse project finance and funds or institutional investors fund each wind farm on its own merits. Banks check every project element, which forces tight budgets and schedules.",
    scores: [3, 2, 2],
  },
  {
    title: "Speed of decisions",
    text: "Bids are due four times a year. Owner-managed developers decide in days; group investment committees and municipal boards take longer.",
    scores: [3, 1, 2],
  },
  {
    title: "Pricing and risk appetite",
    text: "Developers price close to cost and often sell projects (or stakes) after the award to recycle capital. Utilities set group hurdle rates and put capital into offshore, grids or abroad.",
    scores: [3, 1, 1],
  },
  {
    title: "Local acceptance",
    text: "Citizen participation and local ownership help get permits. Stadtwerke and citizen wind farms are strong here; developers increasingly partner with municipalities.",
    scores: [2, 1, 3],
  },
];

// --- Turbine makers per company ---------------------------------------------

const MAKER_COLS = ["Enercon", "Vestas", "Nordex", "Siemens Gamesa", "GE"];

export function makerShares(p: { kw_by_maker: Record<string, number> }) {
  const total = Object.values(p.kw_by_maker).reduce((s, v) => s + v, 0) || 1;
  const row: Record<string, number> = {};
  for (const m of MAKER_COLS) row[m] = (p.kw_by_maker[m] ?? 0) / total;
  row.Other = 1 - MAKER_COLS.reduce((s, m) => s + row[m], 0);
  return row;
}

export function TurbinePartners({ a, brands }: { a: Auctions; brands: string[] }) {
  const rows = a.company_profiles.slice(0, 18).map((p) => {
    const sh = makerShares(p);
    const top = [...MAKER_COLS, "Other"].reduce((b, m) => (sh[m] > sh[b] ? m : b), "Enercon");
    return { group: p.group, sh, top, topShare: sh[top], mw: p.kw_by_year.reduce((s, v) => s + v, 0) / 1000 };
  });
  const cols = [...MAKER_COLS, "Other"];
  return (
    <div>
      <div className="overflow-x-auto rounded-[20px] border border-rule">
        <table className="figures w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-xs text-ink-muted">
              <th className="p-3 font-semibold">Company (awarded MW)</th>
              {cols.map((m) => (
                <th key={m} className="p-2 text-center font-semibold">
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: brandColor(brands, m) }} />
                    {m.replace("Siemens Gamesa", "SGRE")}
                  </span>
                </th>
              ))}
              <th className="p-2 text-center font-semibold">Style</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.group} className="border-b border-rule last:border-0">
                <td className="p-3 font-semibold">
                  {r.group} <span className="font-normal text-ink-muted">{mw(r.mw)}</span>
                </td>
                {cols.map((m) => (
                  <td key={m} className="p-1 text-center">
                    <span
                      className="block rounded-lg px-1 py-1.5 text-xs"
                      style={{
                        background: r.sh[m] > 0.005 ? `color-mix(in srgb, ${brandColor(brands, m)} ${Math.round(15 + r.sh[m] * 75)}%, transparent)` : undefined,
                        fontWeight: r.sh[m] >= 0.5 ? 700 : 400,
                      }}
                    >
                      {r.sh[m] > 0.005 ? `${Math.round(r.sh[m] * 100)}%` : "·"}
                    </span>
                  </td>
                ))}
                <td className="p-2 text-center text-xs text-ink-muted">{r.topShare >= 0.7 ? `${r.top} house` : r.topShare >= 0.5 ? `leans ${r.top}` : "multi-vendor"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Share of each company&apos;s awarded capacity by the turbine maker registered in MaStR (the most
        common maker among each award&apos;s turbines). “House”: ≥ 70 % with one maker; “leans”: ≥ 50 %.
      </p>
    </div>
  );
}
