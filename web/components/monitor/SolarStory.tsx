"use client";

// The Solar page as one storyline (contract v1.7 draft): the price of sun,
// what gets built where (types, yield, batteries), who wins (winners, race,
// portfolios, companies), strategy (wind and solar players), and rooftops.
import * as Plot from "@observablehq/plot";
import { useMemo, useState, type ReactNode } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { mw, type AuctionCategory, type MonitorData, type SolarAuctions, type SolarProfile } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

import { CATEGORY_COLOR, CATEGORY_ORDER, GroupBars, roundLabel } from "./Auctions";
import { AuctionMovie, CompanyMap, type MapSource } from "./AuctionMap";
import { BarRace } from "./BarRace";
import { SolarTypes } from "./Sections";
import { CrossTech, crossTakeaways } from "./Strategy";
import { Chapter, Loading, Section, Segmented, Stat } from "./ui";

export const SOLAR_SECTIONS = [
  ["price", "1 Price"],
  ["where", "2 What & where"],
  ["who", "3 Who wins"],
  ["strategy", "4 Strategy"],
  ["rooftops", "5 Rooftops"],
] as const;

const SUN = "#f59e0b";
const STORAGE = "#8b5cf6";
const WIND = "#2563eb";
const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const ct = (v: number | null | undefined) => (v == null ? "–" : v.toFixed(2));
const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const date_ = (d: string) => new Date(`${d}T00:00:00Z`);

export function SolarStory({ data, date }: { data: MonitorData | null; date: string }) {
  if (!data) return <Loading height={600} />;
  const so = data.solar;
  if (!so) return <p className="py-10 text-ink-muted">Solar auction data is not available yet.</p>;
  return <Story data={data} so={so} date={date} />;
}

function Story({ data, so, date }: { data: MonitorData; so: SolarAuctions; date: string }) {
  const source = <>Source: Bundesnetzagentur, solar and innovation auctions, linked to the Marktstammdatenregister as of {date}. Data processed.</>;
  const sol = so.rounds.filter((r) => r.programme === "solar");
  const inn = so.rounds.filter((r) => r.programme === "innovation" && r.avg_ct != null);
  const lvl = sol.filter((r) => r.award_level);
  const last = sol.at(-1)!;
  const peak = sol.reduce((m, r) => ((r.avg_ct ?? 0) > (m.avg_ct ?? 0) ? r : m), sol[0]);
  const years = so.race.years;
  const yi = years.length - 1;
  const yFull = years.length - 2;
  const map: MapSource = { rounds: lvl, points: so.points, stride: 7, valueLabel: (v) => `≈ ${v.toLocaleString("en-GB")} kWh/kWp` };
  const coloc = lvl.filter((r) => r.co_located_share != null && r.co_located_known_kw > 300_000);
  const firstC = coloc[0];
  const lastC = coloc.at(-1);
  const pf = so.portfolios;
  const pfShare = sum(pf.by_round.map((r) => r.share_in_portfolios)) / (pf.by_round.length || 1);
  const att = so.attribution_kw;
  const attT = sum(Object.values(att)) || 1;
  const named = (y: string) => so.winners_by_year[y].filter((w) => !w.bucket);
  const capRounds = lvl.filter((r) => r.max_award_kw > 0);
  const ys = lvl.filter((r) => r.specific_yield_avg);

  const companyTakeaways = (p: SolarProfile) => {
    const total = sum(p.kw_by_year);
    const states = Object.entries(p.kw_by_state);
    const points: ReactNode[] = [
      `${p.group} won ${mw(total / 1000)} in ${p.awards} solar awards since ${p.first_bid.slice(0, 4)}, in ${p.rounds} of ${lvl.length} rounds.`,
      states.length ? `Strongest in ${states.slice(0, 2).map(([s, v]) => `${s} (${pct(v / total)})`).join(" and ")}; active in ${p.states} states.` : "",
      p.co_located_share != null ? `${pct(p.co_located_share)} of its linked parks have a battery on site.` : "",
      p.specific_yield_avg ? `Estimated yield ${p.specific_yield_avg.toLocaleString("en-GB")} kWh/kWp.` : "",
      `Median award ${p.median_award_mw} MW.`,
    ].filter(Boolean);
    const office = p.attribution_kw.office / (total || 1);
    return { points, caveats: [office > 0.05 ? `${pct(office)} of this capacity is assigned through office addresses (likely, not certain).` : "", "Battery and yield figures only cover parks already registered in MaStR."].filter(Boolean) };
  };

  return (
    <>
      <Chapter id="price" n={1} title="The price of sun">
        Ground-mounted solar is Germany&apos;s cheapest new power. {sol.length} rounds since {sol[0].bid_date.slice(0, 4)} show the price, the
        cap per bid, and the premium for solar parks that come with a battery.
      </Chapter>

      <Section
        id="solar-prices"
        eyebrow="Solar auctions"
        title={`Solar awards average ${ct(last.avg_ct)} ct/kWh in ${roundLabel(last.bid_date)}, after a peak of ${ct(peak.avg_ct)} ct in ${peak.bid_date.slice(0, 4)}`}
        subtitle="Average award value per round: ground-mounted solar (first segment), innovation rounds (mostly solar plus battery) and onshore wind for comparison."
        asOf={date}
        source={source}
        takeaways={[
          inn.length ? `Innovation rounds, which demand a battery, pay ${ct(inn.at(-1)!.avg_ct)} ct in ${roundLabel(inn.at(-1)!.bid_date)}, against ${ct(last.avg_ct)} ct for plain solar: the battery premium is about ${ct((inn.at(-1)!.avg_ct ?? 0) - (last.avg_ct ?? 0))} ct.` : "",
          data.auctions ? `Onshore wind (${ct(data.auctions.rounds.at(-1)!.avg_ct)} ct in ${roundLabel(data.auctions.rounds.at(-1)!.bid_date)}) now bids about the same as solar, but after the EEG site correction (about ${(data.auctions.rounds.at(-1)!.correction_factor_avg ?? 1).toFixed(2)}×) wind projects receive more per kWh.` : "",
          capRounds.length ? `Largest single award: up to ${mw(Math.max(...capRounds.filter((r) => r.bid_date < "2024").map((r) => r.max_award_kw)) / 1000)} in 2023, exactly ${mw(Math.max(...capRounds.filter((r) => r.bid_date >= "2024").map((r) => r.max_award_kw)) / 1000)} since 2024: the bid size cap is binding.` : "",
        ].filter(Boolean)}
        caveats={["Solar has no site correction factor: the award value is what the park receives."]}
      >
        <SolarPrices data={data} so={so} />
      </Section>

      <Chapter id="where" n={2} title="What gets built, and where">
        Bavaria leads by far, almost every park is fixed-tilt, and more and more parks bring their own battery.
      </Chapter>

      <Section
        id="solar-map"
        eyebrow="Where the awards went"
        title={(() => {
          const sh = Object.entries(so.kw_by_state_year).map(([s, v]) => [s, v[yFull] / (sum(Object.values(so.kw_by_state_year).map((x) => x[yFull])) || 1)] as const).sort((a, b) => b[1] - a[1]);
          return `In ${years[yFull]}, ${sh.slice(0, 3).map(([s]) => s).join(", ")} took ${pct(sum(sh.slice(0, 3).map(([, v]) => v)))} of the awarded solar capacity`;
        })()}
        subtitle="Press play: every awarded solar park since 2023, round by round. Parks not yet in the register are placed at the centre of their municipality."
        asOf={date}
        source={source}
        takeaways={[
          `Awarded ${mw(sum(lvl.map((r) => r.list_kw)) / 1000)} in ${lvl.length} ground-mounted rounds since ${lvl[0].bid_date.slice(0, 4)}.`,
          ys.length ? `Average estimated yield ${Math.round(sum(ys.map((r) => r.specific_yield_avg! * r.list_kw)) / sum(ys.map((r) => r.list_kw)))} kWh/kWp, nearly identical from round to round: solar wins where land and grid are available, not only where the sun is strongest.` : "",
        ].filter(Boolean)}
        caveats={["Awards of bidders that are not companies are not shown."]}
      >
        <AuctionMovie a={map} geo={data.districts} />
      </Section>

      <Section
        id="systems"
        eyebrow="Systems and batteries"
        title={firstC && lastC ? `Batteries on site: ${pct(firstC.co_located_share)} of linked solar award capacity in ${roundLabel(firstC.bid_date)}, ${pct(lastC.co_located_share)} in ${roundLabel(lastC.bid_date)}` : "Batteries, trackers and special sites"}
        subtitle="Of the awarded parks already registered in MaStR: share with a battery on site, on trackers, and on special sites (Agri-PV, floating, parking and similar)."
        asOf={date}
        source={source}
        takeaways={[
          firstC && lastC ? `Co-location is rising: from ${pct(firstC.co_located_share)} to ${pct(lastC.co_located_share)} of linked capacity in ordinary solar rounds; innovation rounds are 100 % solar plus battery by design.` : "",
          `Trackers stay rare: ${pct(Math.max(...lvl.map((r) => r.tracker_share ?? 0)))} at most in any round; German parks are fixed-tilt.`,
          `Special sites (Agri-PV, floating, parking and similar) reach ${pct(Math.max(...lvl.map((r) => r.special_share ?? 0)))} of capacity in the best round.`,
        ].filter(Boolean)}
        caveats={["Battery = MaStR flag 'storage at the same site', a battery unit linked to the award, or a battery of at least 500 kW within 1 km of the park.", "Recent rounds are mostly not yet registered; their shares rest on few parks."]}
      >
        <SolarSystems so={so} />
      </Section>

      <Chapter id="who" n={3} title="Who wins">
        Specialised solar developers lead, utilities and Stadtwerke enter through solar, and big parks come as bundles of capped bids.
      </Chapter>

      <Section
        id="solar-winners"
        eyebrow="Solar winners"
        title={`So far in ${years[yi]}, ${named(years[yi]).slice(0, 3).map((w) => w.group).join(", ")} lead the named solar winners`}
        subtitle="Awarded ground-mounted solar capacity by company group, with citizen projects and unknown owners as their own bars."
        asOf={date}
        source={source}
        takeaways={[
          `Since 2023: ${so.winners_by_year.all.filter((w) => !w.bucket).slice(0, 4).map((w) => `${w.group} (${mw(w.kw / 1000)})`).join(", ")}.`,
          `Owners found by company name (${pct(att.name / attT)}), office address (${pct(att.office / attT)}); ${pct(att.none / attT)} stays unknown, more than in wind because solar parks are often sold to investors.`,
        ]}
        caveats={["Solar is a younger, more fragmented market; many bidders are project companies of small developers."]}
      >
        <SolarWinners so={so} />
      </Section>

      <Section
        id="solar-race"
        eyebrow="Since 2023"
        title={`Developers and IPPs won ${pct(so.kw_by_category_year.developer[yFull] / (sum(CATEGORY_ORDER.filter((c) => c !== "unattributed").map((c) => so.kw_by_category_year[c][yFull])) || 1))} of the known solar capacity in ${years[yFull]}`}
        subtitle="Press play: the race of solar winners by company group or by bidder type."
        asOf={date}
        source={source}
        takeaways={[
          `Utilities ${pct(sum(so.kw_by_category_year.utility) / sum(CATEGORY_ORDER.map((c) => sum(so.kw_by_category_year[c]))))} and Stadtwerke ${pct(sum(so.kw_by_category_year.municipal) / sum(CATEGORY_ORDER.map((c) => sum(so.kw_by_category_year[c]))))} of all solar capacity since 2023: a bigger slice than in wind.`,
        ]}
        caveats={[`${pct(so.unattributed_share)} of solar capacity has no known owner.`]}
      >
        <SolarRace so={so} />
      </Section>

      <Section
        id="portfolios"
        eyebrow="Portfolios"
        title={`${pct(pfShare)} of solar capacity comes as portfolios: several capped bids by one company in the same district`}
        subtitle="Bids by the same company group (or the same bidder) in the same district and round, the way large parks are split under the bid size cap."
        asOf={date}
        source={source}
        takeaways={[
          pf.largest[0] ? `Largest portfolio: ${pf.largest[0].owner ?? "one bidder"} with ${pf.largest[0].bids} bids and ${mw(pf.largest[0].kw / 1000)} in ${pf.largest[0].district} (${roundLabel(pf.largest[0].bid_date)}).` : "",
          `Since 2024 no single solar award exceeds 20 MW; the largest portfolios bundle 3–8 bids into 60–135 MW.`,
        ].filter(Boolean)}
        caveats={["Grouped by district; neighbouring districts or later rounds of the same park are counted separately, so portfolios are undercounted."]}
      >
        <Portfolios so={so} />
      </Section>

      <Section
        id="solar-company"
        eyebrow="Company deep dive"
        title="Pick a company: where it has won solar, year by year"
        subtitle="Each dot is one award, coloured by year (the running year in orange)."
        asOf={date}
        source={source}
      >
        <CompanyMap
          a={map}
          geo={data.districts}
          profiles={so.company_profiles}
          years={years}
          takeaways={companyTakeaways}
          stats={(p) => (
            <>
              <Stat label="Battery on site" value={pct(p.co_located_share)} sub="of linked parks" />
              <Stat label="Yield (est.)" value={p.specific_yield_avg ? `${p.specific_yield_avg.toLocaleString("en-GB")}` : "–"} sub="kWh per kWp" />
              <Stat label="Median award" value={`${p.median_award_mw} MW`} sub={`${p.states} states`} />
            </>
          )}
        />
      </Section>

      <Chapter id="strategy" n={4} title="Strategy">
        Wind developers branch into solar, utilities use solar to enter the auctions, and batteries become the edge.
      </Chapter>

      <Section
        id="solar-wind-players"
        eyebrow="Wind and solar"
        title={`${so.cross_tech.filter((c) => c.wind_kw_since_2023 > 0 && c.solar_kw_since_2023 > 0).length} of the larger groups win in both wind and solar auctions`}
        subtitle="Awarded capacity since 2023 per company group in onshore wind and ground-mounted solar."
        asOf={date}
        source={source}
        takeaways={crossTakeaways(data)}
        caveats={["Groups found by name and office address; solar attribution is weaker than wind."]}
      >
        <CrossTech data={data} />
      </Section>

      <Section
        id="battery-leaders"
        eyebrow="Battery leaders"
        title="Who builds solar with batteries"
        subtitle="Share of each company's linked solar award capacity with a battery on site (companies with at least 30 MW)."
        asOf={date}
        source={source}
        takeaways={(() => {
          const r = so.company_profiles.filter((p) => p.co_located_share != null).sort((a, b) => (b.co_located_share ?? 0) - (a.co_located_share ?? 0));
          return [
            r.length ? `Highest battery share: ${r.slice(0, 4).map((p) => `${p.group} (${pct(p.co_located_share)})`).join(", ")}.` : "",
            "A battery lets a park shift midday power into the evening, when prices are higher; it also eases grid connection limits.",
          ].filter(Boolean);
        })()}
        caveats={["Only parks already registered in MaStR; battery detection as described above."]}
      >
        <BatteryLeaders so={so} />
      </Section>

      <Chapter id="rooftops" n={5} title="Beyond the auctions: rooftops and balconies">
        Most solar units sit on roofs and balconies and never enter an auction.
      </Chapter>

      <Section id="balcony" eyebrow="Rooftops and balconies" title="Ground-mounted parks, rooftops and balcony units, year by year" subtitle="Solar added per year by type, all sizes." asOf={date}>
        <SolarTypes data={data} />
      </Section>
    </>
  );
}

function SolarPrices({ data, so }: { data: MonitorData; so: SolarAuctions }) {
  const rows = [
    ...so.rounds.filter((r) => r.avg_ct != null).map((r) => ({ d: date_(r.bid_date), v: r.avg_ct!, s: r.programme === "solar" ? "Solar" : "Innovation (solar + battery)", label: roundLabel(r.bid_date) })),
    ...(data.auctions?.rounds ?? []).map((r) => ({ d: date_(r.bid_date), v: r.avg_ct, s: "Onshore wind", label: roundLabel(r.bid_date) })),
  ];
  const ceil = so.rounds.filter((r) => r.programme === "solar" && r.ceiling_ct).map((r) => ({ d: date_(r.bid_date), v: r.ceiling_ct! }));
  const series = ["Solar", "Innovation (solar + battery)", "Onshore wind"];
  const colors = [SUN, STORAGE, WIND];
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {series.map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: colors[i] }} />{s}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 border-t border-dashed border-ink-muted" />Solar ceiling</span>
      </div>
      <PlotFigure
        deps={[rows]}
        render={(width) =>
          Plot.plot({
            width, height: 320, marginLeft: 40, ...axis(),
            x: { label: null, type: "utc" },
            y: { label: "ct/kWh", grid: true },
            color: { domain: series, range: colors },
            marks: [
              Plot.lineY(ceil, { x: "d", y: "v", curve: "step-after", stroke: cssVar("--ink-muted"), strokeDasharray: "4 4" }),
              Plot.lineY(rows, { x: "d", y: "v", stroke: "s", strokeWidth: 2.2, curve: "monotone-x" }),
              Plot.dot(rows, { x: "d", y: "v", fill: "s", r: 3 }),
              Plot.tip(rows, Plot.pointer({ x: "d", y: "v", title: (d: (typeof rows)[number]) => `${d.s} · ${d.label}: ${d.v.toFixed(2)} ct/kWh` })),
            ],
          })
        }
      />
    </div>
  );
}

function SolarSystems({ so }: { so: SolarAuctions }) {
  const lvl = so.rounds.filter((r) => r.programme === "solar" && r.award_level);
  const rows = lvl.flatMap((r) => [
    { d: date_(r.bid_date), k: "Battery on site", v: r.co_located_share, n: r.co_located_known_kw },
    { d: date_(r.bid_date), k: "Special site", v: r.special_share, n: r.co_located_known_kw },
    { d: date_(r.bid_date), k: "Tracker", v: r.tracker_share, n: r.co_located_known_kw },
  ]).filter((x) => x.v != null && x.n > 100_000) as { d: Date; k: string; v: number; n: number }[];
  const keys = ["Battery on site", "Special site", "Tracker"];
  const cols = [STORAGE, "#10b981", SUN];
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {keys.map((k, i) => (<span key={k} className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: cols[i] }} />{k}</span>))}
      </div>
      <PlotFigure
        deps={[rows]}
        render={(width) =>
          Plot.plot({
            width, height: 280, marginLeft: 40, ...axis(),
            x: { label: null, type: "utc" },
            y: { label: null, percent: true, tickFormat: (d: number) => `${d}%`, grid: true, zero: true },
            color: { domain: keys, range: cols },
            marks: [
              Plot.lineY(rows, { x: "d", y: "v", stroke: "k", strokeWidth: 2.5 }),
              Plot.dot(rows, { x: "d", y: "v", fill: "k", r: (d: (typeof rows)[number]) => Math.max(2.5, Math.sqrt(d.n / 1e5)) }),
              Plot.tip(rows, Plot.pointer({ x: "d", y: "v", title: (d: (typeof rows)[number]) => `${d.k}: ${Math.round(d.v * 100)}% of ${mw(d.n / 1000)} linked` })),
            ],
          })
        }
      />
      <p className="mt-2 text-xs text-ink-muted">Dot size: capacity already linked to MaStR in that round (rounds with less than 100 MW linked are left out).</p>
    </div>
  );
}

function SolarWinners({ so }: { so: SolarAuctions }) {
  const years = Object.keys(so.winners_by_year).filter((y) => y !== "all").sort();
  const [year, setYear] = useState(years.at(-1)!);
  const rows = so.winners_by_year[year].slice(0, 15).map((w) => ({ ...w, mw: w.kw / 1000 }));
  return (
    <div>
      <Segmented label="Year" value={year} onChange={setYear} options={[...years.map((y) => ({ value: y, label: y })), { value: "all", label: `All ${years[0]}–${years.at(-1)!.slice(2)}` }]} />
      <div className="mt-4">
        <GroupBars rows={rows} max={Math.max(...rows.map((r) => r.mw), 1)} value={(r) => `${mw(r.mw)} · ${((r.share ?? 0) * 100).toFixed(1)}%`} />
      </div>
      <p className="mt-3 text-xs text-ink-muted">Striped bars stand for many companies. Owners are found by company name and the office address of the operating company.</p>
    </div>
  );
}

function SolarRace({ so }: { so: SolarAuctions }) {
  const [view, setView] = useState<"companies" | "types">("companies");
  const cum = (xs: number[]) => xs.reduce<number[]>((acc, v) => [...acc, (acc.at(-1) ?? 0) + v], []);
  const companies = useMemo(() => Object.fromEntries(so.race.groups.map((g) => [g, cum(so.race.kw[g]).map((v) => v / 1000)])), [so]);
  const types = useMemo(() => Object.fromEntries(CATEGORY_ORDER.map((c) => [so.categories[c], cum(so.kw_by_category_year[c]).map((v) => v / 1000)])), [so]);
  const catOf = Object.fromEntries(so.race.groups.map((g, i) => [g, so.race.categories[i]]));
  const catOfLabel = Object.fromEntries(CATEGORY_ORDER.map((c) => [so.categories[c], c])) as Record<string, AuctionCategory>;
  const controls = <Segmented label="View" value={view} onChange={setView} options={[{ value: "companies", label: "Companies" }, { value: "types", label: "Bidder types" }]} />;
  return view === "companies" ? (
    <BarRace key="c" steps={so.race.years} names={so.race.groups} values={companies} colorOf={(n) => CATEGORY_COLOR[catOf[n] ?? "unattributed"]} pinned={["Not attributed"]} rows={12} totalLabel={(s) => `awarded ${so.race.years[0]}–${s}`} controls={controls} ariaLabel="Solar auction winners by company group" />
  ) : (
    <BarRace key="t" steps={so.race.years} names={Object.keys(types)} values={types} colorOf={(n) => CATEGORY_COLOR[catOfLabel[n]]} rows={5} totalLabel={(s) => `awarded ${so.race.years[0]}–${s}`} controls={controls} ariaLabel="Solar auction winners by bidder type" />
  );
}

function Portfolios({ so }: { so: SolarAuctions }) {
  const rows = so.portfolios.by_round.map((r) => ({ d: date_(r.bid_date), v: r.share_in_portfolios, label: roundLabel(r.bid_date) }));
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
      <div className="min-w-0">
        <p className="text-sm font-semibold">Share of each round in portfolios</p>
        <PlotFigure
          deps={[rows]}
          render={(width) =>
            Plot.plot({
              width, height: 240, marginLeft: 40, ...axis(),
              x: { label: null, type: "band", ticks: rows.filter((_, i) => i % (width < 500 ? 3 : 1) === 0).map((r) => r.d), tickFormat: (d: Date) => roundLabel(d.toISOString().slice(0, 10)) },
              y: { label: null, percent: true, tickFormat: (d: number) => `${d}%`, grid: true },
              marks: [Plot.barY(rows, { x: "d", y: "v", fill: SUN, rx: 3 }), Plot.tip(rows, Plot.pointerX({ x: "d", y: "v", title: (d: (typeof rows)[number]) => `${d.label}: ${Math.round(d.v * 100)}%` }))],
            })
          }
        />
      </div>
      <div className="min-w-0 overflow-x-auto rounded-[20px] border border-rule">
        <table className="figures w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-xs text-ink-muted">
              <th className="p-3 font-semibold">Company</th><th className="p-3 font-semibold">District</th><th className="p-3 font-semibold">Round</th><th className="p-3 font-semibold">Bids</th><th className="p-3 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {so.portfolios.largest.slice(0, 12).map((p, i) => (
              <tr key={i} className="border-b border-rule last:border-0">
                <td className="p-3 font-semibold">{p.owner ?? <span className="font-normal text-ink-muted">one bidder</span>}</td>
                <td className="p-3">{p.district}</td>
                <td className="p-3">{roundLabel(p.bid_date)}</td>
                <td className="p-3">{p.bids}</td>
                <td className="p-3">{mw(p.kw / 1000)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BatteryLeaders({ so }: { so: SolarAuctions }) {
  const rows = so.company_profiles
    .filter((p) => p.co_located_share != null)
    .sort((a, b) => (b.co_located_share ?? 0) - (a.co_located_share ?? 0))
    .slice(0, 15);
  return (
    <ol className="space-y-2">
      {rows.map((p) => (
        <li key={p.group} className="grid grid-cols-[8rem_1fr] items-center gap-2 sm:grid-cols-[12rem_1fr]">
          <span className="truncate text-sm font-semibold">{p.group}</span>
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-4 rounded-full" style={{ width: `${Math.max(1, (p.co_located_share ?? 0) * 70)}%`, background: STORAGE }} />
            <span className="figures text-xs text-ink-muted">{pct(p.co_located_share)} · {mw(sum(p.kw_by_year) / 1000)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
