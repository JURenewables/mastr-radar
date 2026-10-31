"use client";

// Onshore wind auctions (contract v1.5 draft): award prices per round, winning
// company groups, and who wins by type of bidder.
import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { mw, type AuctionCategory, type Auctions } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

import { Segmented, Stat } from "./ui";
import { brandColor } from "./WindIndustry";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const roundLabel = (bidDate: string) => `${MONTHS[Number(bidDate.slice(5, 7)) - 1]} ${bidDate.slice(2, 4)}`;
const ct = (v: number) => v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const CATEGORY_ORDER: AuctionCategory[] = ["developer", "utility", "citizen", "unattributed"];
export const CATEGORY_COLOR: Record<AuctionCategory, string> = {
  developer: "#2563eb",
  utility: "#f59e0b",
  citizen: "#10b981",
  unattributed: "#94a3b8",
};
const axis = () => ({
  style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") },
});

// --- Prices per round -------------------------------------------------------

export function AuctionPrices({ a }: { a: Auctions }) {
  const rows = a.rounds.map((r) => ({ ...r, label: roundLabel(r.bid_date) }));
  const order = rows.map((r) => r.label);
  const last = rows.at(-1)!;
  const first = rows[0];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={`Average, ${last.label}`} value={`${ct(last.avg_ct)} ct`} sub={`${last.avg_ct - first.avg_ct > 0 ? "+" : "−"}${ct(Math.abs(last.avg_ct - first.avg_ct))} ct since ${first.label}`} />
        <Stat label={`Lowest award, ${last.label}`} value={`${ct(last.min_ct)} ct`} />
        <Stat label={`Highest award, ${last.label}`} value={`${ct(last.max_ct)} ct`} sub={`ceiling ${ct(last.ceiling_ct)} ct`} />
        <Stat label={`Awarded, ${last.label}`} value={mw(last.awarded_kw / 1000)} sub={`${last.awards} awards`} />
      </div>
      <PlotFigure
        deps={[rows]}
        render={(width) =>
          Plot.plot({
            width,
            height: 300,
            marginLeft: 40,
            marginRight: width < 500 ? 10 : 40,
            ...axis(),
            x: { label: null, domain: order, padding: 0.4 },
            y: { label: "ct/kWh", domain: [4, 7.6], grid: true },
            marks: [
              Plot.lineY(rows, { x: "label", y: "ceiling_ct", stroke: cssVar("--ink-muted"), strokeDasharray: "4 4", strokeWidth: 1.5 }),
              Plot.text(rows.slice(-1), { x: "label", y: "ceiling_ct", text: () => "ceiling", dy: -8, fill: cssVar("--ink-muted"), textAnchor: "end" }),
              Plot.ruleX(rows, { x: "label", y1: "min_ct", y2: "max_ct", stroke: cssVar("--accent"), strokeOpacity: 0.35, strokeWidth: width < 500 ? 10 : 16, strokeLinecap: "round" }),
              Plot.dot(rows, { x: "label", y: "avg_ct", r: 5.5, fill: cssVar("--accent"), stroke: cssVar("--paper"), strokeWidth: 2 }),
              Plot.text(rows, { x: "label", y: "avg_ct", text: (d: { avg_ct: number }) => ct(d.avg_ct), dx: width < 500 ? 0 : 14, dy: width < 500 ? -14 : 0, textAnchor: width < 500 ? "middle" : "start", fontWeight: 700, fill: cssVar("--ink") }),
              Plot.tip(
                rows,
                Plot.pointerX({
                  x: "label",
                  y: "avg_ct",
                  title: (d: (typeof rows)[number]) =>
                    `${d.label}: average ${ct(d.avg_ct)} ct/kWh\nlowest ${ct(d.min_ct)} · highest ${ct(d.max_ct)}\n${mw(d.awarded_kw / 1000)} in ${d.awards} awards`,
                }),
              ),
            ],
          })
        }
      />
      <p className="text-xs text-ink-muted">
        Dot: volume-weighted average award value; bar: lowest to highest successful bid; dashed
        line: the legal ceiling (Höchstwert). Award values are paid as a sliding market premium
        for 20 years, adjusted for site quality. Prices of single bids are not published.
      </p>
    </div>
  );
}

// --- Winners ----------------------------------------------------------------

export function AuctionWinners({ a, brands }: { a: Auctions; brands: string[] }) {
  const years = Object.keys(a.winners_by_year).sort();
  const [year, setYear] = useState(years.at(-1)!);
  const winners = a.winners_by_year[year].slice(0, 12);
  const yearRounds = a.rounds.filter((r) => r.bid_date.startsWith(year));
  const max = Math.max(...winners.map((w) => w.kw), 1);

  const split = useMemo(
    () =>
      a.rounds.flatMap((r) => {
        const total = CATEGORY_ORDER.reduce((s, c) => s + r.kw_by_category[c], 0) || 1;
        return CATEGORY_ORDER.map((c) => ({ round: roundLabel(r.bid_date), category: a.categories[c], key: c, share: r.kw_by_category[c] / total, kw: r.kw_by_category[c] }));
      }),
    [a],
  );
  const order = a.rounds.map((r) => roundLabel(r.bid_date));
  const catLabels = CATEGORY_ORDER.map((c) => a.categories[c]);

  // Turbine makers in this year's awards (linked through MaStR).
  const makers: Record<string, number> = {};
  for (const r of yearRounds) for (const [b, kw] of Object.entries(r.kw_by_maker)) makers[b] = (makers[b] ?? 0) + kw;
  const makerTotal = Object.values(makers).reduce((s, v) => s + v, 0) || 1;
  // Makers under 1 % join "Other" so the labels stay readable.
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">
            Top winners {year}: {yearRounds.map((r) => roundLabel(r.bid_date)).join(", ")}
          </p>
          {years.length > 1 && (
            <Segmented label="Year" value={year} onChange={setYear} options={years.map((y) => ({ value: y, label: y }))} />
          )}
        </div>
        <ol className="mt-4 space-y-2.5" aria-label={`Company groups with the most awarded onshore capacity in ${year}`}>
          {winners.map((w, i) => (
            <li key={w.group} className="grid grid-cols-[1.25rem_7.5rem_1fr] items-center gap-2 sm:grid-cols-[1.5rem_11rem_1fr]">
              <span className="figures text-xs text-ink-muted">{i + 1}</span>
              <span className="truncate text-sm font-semibold">{w.group}</span>
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-5 rounded-full" style={{ width: `${(w.kw / max) * 72}%`, background: CATEGORY_COLOR[w.category] }} />
                <span className="figures shrink-0 text-xs font-semibold text-ink-muted sm:text-sm">
                  {mw(w.kw / 1000)} · {(w.share * 100).toFixed(1)}%
                  <span className="hidden sm:inline"> · {w.awards} awards</span>
                </span>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {CATEGORY_ORDER.slice(0, 2).map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
              {a.categories[c]}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Share of all capacity awarded in {year}. Bidders are grouped by the company name in the
          award list (e.g. “wpd Windpark Nr. 440 GmbH & Co. KG” → wpd). Many project companies carry
          no group name ({Math.round(a.unattributed_share * 100)}% of capacity), so groups that bid
          through such companies are undercounted. Citizen wind farms and municipal utilities
          without a group name are counted by type below, not ranked here.
        </p>
      </div>

      <div>
        <p className="text-sm font-semibold">Who wins: awarded capacity by type of bidder</p>
        <div className="mt-2 mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {CATEGORY_ORDER.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
              {a.categories[c]}
            </span>
          ))}
        </div>
        <PlotFigure
          deps={[split]}
          render={(width) =>
            Plot.plot({
              width,
              height: 260,
              marginLeft: 40,
              ...axis(),
              x: { label: null, domain: order, padding: 0.25 },
              y: { label: null, percent: true, tickFormat: (d: number) => `${d}%`, grid: true },
              color: { domain: catLabels, range: CATEGORY_ORDER.map((c) => CATEGORY_COLOR[c]) },
              marks: [
                Plot.barY(split, { x: "round", y: "share", fill: "category", order: catLabels, rx: 3, insetTop: 1 }),
                Plot.tip(
                  split,
                  Plot.pointer(
                    Plot.stackY({
                      x: "round",
                      y: "share",
                      fill: "category",
                      order: catLabels,
                      title: (d: (typeof split)[number]) => `${d.round} · ${d.category}: ${Math.round(d.share * 100)}% (${mw(d.kw / 1000)})`,
                    }),
                  ),
                ),
              ],
            })
          }
        />
        <p className="mt-2 text-xs text-ink-muted">
          Utilities include their joint ventures (e.g. Alterric, EWE) and Stadtwerke; developers
          owned by a utility (e.g. JUWI, part of MVV) count as developers. “Citizen & local”: citizen
          wind farms, cooperatives, farmers’ companies and partnerships.
        </p>
      </div>

      <div>
        <p className="text-sm font-semibold">Turbines in the {year} awards, by maker</p>
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
        <p className="mt-2 text-xs text-ink-muted">
          Each award lists its turbines by MaStR register number;{" "}
          {Math.round((yearRounds.reduce((s, r) => s + r.turbines_in_mastr, 0) / Math.max(1, yearRounds.reduce((s, r) => s + r.turbines, 0))) * 100)}% of
          them were found in the register, with the maker the developer registered.
        </p>
      </div>
    </div>
  );
}
