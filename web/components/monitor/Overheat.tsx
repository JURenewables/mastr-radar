"use client";

// "A market under strain": how the wind and solar auctions overheated, and the
// risks that follow (contract v1.7 draft, auctions/market_risk.json).
import * as Plot from "@observablehq/plot";
import type { ReactNode } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { mw, type MonitorData, type RiskRound, type TechRisk } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

import { roundLabel } from "./Auctions";
import { Section, Stat } from "./ui";

const BUILT = "#10b981";
const OPEN = "#94a3b8";
const SOON = "#f59e0b";
const LAPSED = "#ef4444";
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const gw = (kw: number) => mw(kw / 1000);
const pct = (x: number) => `${Math.round(x * 100)} %`;
const month = (ym: string) => new Date(`${ym.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:text-ink">
      {children}
    </a>
  );
}

type Step = { when: string; what: ReactNode };

function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-3 border-l-2 border-rule pl-4">
      {steps.map((s, i) => (
        <li key={i} className="relative">
          <span aria-hidden className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
          <p className="figures text-sm font-semibold">{s.when}</p>
          <p className="text-sm text-ink-muted">{s.what}</p>
        </li>
      ))}
    </ol>
  );
}

function PriceChart({ rounds, market }: { rounds: RiskRound[]; market: TechRisk["market"] }) {
  const r = rounds.filter((x) => x.avg_ct != null);
  const factor = new Map(market.map((m) => [m.bid_date, m.submitted_mw / m.tender_mw]));
  const labelled = r.filter((x) => factor.has(x.bid_date)).slice(-1);
  return (
    <PlotFigure
      deps={[r]}
      render={(width) =>
        Plot.plot({
          width,
          height: 260,
          marginLeft: 40,
          ...axis(),
          x: { label: null, type: "utc", tickFormat: (d: Date) => String(d.getUTCFullYear()) },
          y: { label: "ct/kWh", grid: true, domain: [0, Math.max(...r.map((x) => x.ceiling_ct ?? x.avg_ct!)) * 1.15] },
          marks: [
            Plot.line(r.filter((x) => x.ceiling_ct != null), { x: (d: RiskRound) => new Date(d.bid_date), y: "ceiling_ct", stroke: cssVar("--ink-muted"), strokeDasharray: "4 3", curve: "step-after" }),
            Plot.line(r, { x: (d: RiskRound) => new Date(d.bid_date), y: "avg_ct", stroke: cssVar("--accent"), strokeWidth: 2.5 }),
            Plot.dot(r, { x: (d: RiskRound) => new Date(d.bid_date), y: "avg_ct", fill: cssVar("--accent"), r: 3 }),
            Plot.text(labelled, { x: (d: RiskRound) => new Date(d.bid_date), y: "avg_ct", text: (d: RiskRound) => `${factor.get(d.bid_date)!.toFixed(1)}× bids`, dy: 16, fontSize: 11, fontWeight: 700, fill: cssVar("--ink") }),
            Plot.tip(r, Plot.pointerX({ x: (d: RiskRound) => new Date(d.bid_date), y: "avg_ct", title: (d: RiskRound) => `${roundLabel(d.bid_date)}: ${d.avg_ct} ct average${d.ceiling_ct ? `, ceiling ${d.ceiling_ct} ct` : ""}` })),
          ],
        })
      }
    />
  );
}

function BacklogChart({ risk, asOf }: { risk: TechRisk; asOf: string }) {
  const soon = new Date(asOf);
  soon.setMonth(soon.getMonth() + 12);
  const soonIso = soon.toISOString().slice(0, 10);
  const r = risk.rounds.filter((x) => x.programme !== "innovation" && x.bid_date >= "2022-01-01");
  const state = (x: RiskRound) => (x.past_deadline ? "Past deadline, not running" : x.expires && x.expires <= soonIso ? "Deadline within 12 months" : "Not yet running");
  const rows = r.flatMap((x) => [
    { round: roundLabel(x.bid_date), kind: "Running", mw: x.operating_kw / 1000 },
    { round: roundLabel(x.bid_date), kind: state(x), mw: x.unbuilt_kw / 1000 },
  ]);
  const order = ["Running", "Not yet running", "Deadline within 12 months", "Past deadline, not running"];
  return (
    <PlotFigure
      deps={[rows]}
      render={(width) =>
        Plot.plot({
          width,
          height: 280,
          marginLeft: 48,
          marginBottom: 46,
          ...axis(),
          x: { label: null, domain: r.map((x) => roundLabel(x.bid_date)), tickRotate: -45 },
          y: { label: "MW awarded", grid: true },
          color: { domain: order, range: [BUILT, OPEN, SOON, LAPSED], legend: true },
          marks: [
            Plot.barY(rows, { x: "round", y: "mw", fill: "kind", order }),
            Plot.tip(rows, Plot.pointer({ x: "round", y: "mw", fill: "kind", title: (d: (typeof rows)[number]) => `${d.round} · ${d.kind}\n${mw(d.mw)}` })),
          ],
        })
      }
    />
  );
}

export function OverheatSection({ data, tech, date }: { data: MonitorData; tech: "wind" | "solar"; date: string }) {
  const risk = data.risk?.[tech];
  if (!risk || !risk.price_peak || !risk.price_last) return null;
  const peak = risk.price_peak;
  const last = risk.price_last;
  const drop = 1 - last.avg_ct / peak.avg_ct;
  const latest = risk.market.at(-1);
  const factor = latest ? latest.submitted_mw / latest.tender_mw : null;
  const exposed = risk.exposure.reduce((t, e) => t + e.unbuilt_kw, 0);
  const main = risk.rounds.filter((r) => r.programme !== "innovation");
  const soon = new Date(data.risk!.as_of);
  soon.setMonth(soon.getMonth() + 12);
  const mature = main.filter((r) => r.expires && !r.past_deadline && r.expires <= soon.toISOString().slice(0, 10));
  const capture = risk.facts.find((f) => f.text.includes("capture"));
  const facts = risk.facts;
  const ceilings = main.filter((r) => r.ceiling_ct != null);
  const ceilFirst = ceilings[0];
  const ceilLast = ceilings.at(-1);

  // Wind only: share of awards in Bavaria and Baden-Württemberg, first vs latest year.
  const au = data.auctions;
  let south: { first: number; last: number; y0: string; y1: string } | null = null;
  if (tech === "wind" && au) {
    const ys = au.race.years;
    const tot = ys.map((_, i) => Object.values(au.kw_by_state_year).reduce((t, v) => t + (v[i] ?? 0), 0));
    const s = ys.map((_, i) => (au.kw_by_state_year["Bayern"]?.[i] ?? 0) + (au.kw_by_state_year["Baden-Württemberg"]?.[i] ?? 0));
    const share = s.map((v, i) => (tot[i] ? v / tot[i] : 0));
    const peakI = share.indexOf(Math.max(...share));
    south = { first: share[peakI], last: share.at(-1)!, y0: ys[peakI], y1: ys.at(-1)! };
  }

  const steps: Step[] =
    tech === "wind"
      ? [
          { when: "2022–2023", what: <>Energy crisis and higher costs: the ceiling price was raised{ceilLast ? <> to {Math.max(...ceilings.map((c) => c.ceiling_ct!))} ct</> : null}, and rounds were undersubscribed, so almost every bid won at the ceiling.</> },
          { when: "2023–2025", what: <>Faster permits flood the pipeline. Bids now exceed the tender volume in every round{facts.find((f) => f.text.includes("ninth")) ? <> (<Link href={facts.find((f) => f.text.includes("ninth"))!.source}>nine in a row by Aug 2026</Link>)</> : null}.</> },
          { when: `${roundLabel(peak.bid_date)} → ${roundLabel(last.bid_date)}`, what: <>Pay-as-bid competition pushes the average award from {peak.avg_ct} to {last.avg_ct} ct (−{pct(drop)}), far below the ceiling.</> },
          { when: "2026", what: <>Developers with thin balance sheets crack: SoWiTec insolvent (Jul), ABO Energy in out-of-court restructuring with a bank standstill to 30 Nov 2026. SoWiTec&apos;s CEO blamed the low prices and the northern bias of awards.</> },
        ]
      : [
          { when: "2023", what: <>Ceiling raised to {ceilFirst?.ceiling_ct} ct after the energy crisis; the first rounds clear near it.</> },
          { when: "2022–2026", what: <>So many solar parks feed in at noon that solar&apos;s market value collapses{capture ? <> (<Link href={capture.source}>capture rate from about 98 % to 54 %</Link>)</> : null} and negative-price hours multiply. Batteries become the way out, and need fresh money.</> },
          { when: "2023–2026", what: <>Rounds are oversubscribed{risk.market.length ? <> ({risk.market.map((m) => `${(m.submitted_mw / m.tender_mw).toFixed(1)}× in ${roundLabel(m.bid_date)}`).join(", ")})</> : null}; the average award falls from {peak.avg_ct} to {last.avg_ct} ct and the ceiling is cut to {ceilLast?.ceiling_ct} ct.</> },
          { when: "Sept 2026", what: <>Enerparc, the largest solar auction winner, files for insolvency after a key financing for solar-plus-storage projects fails, about six months after a €1bn financing package.</> },
        ];

  const dangers: string[] =
    tech === "wind"
      ? [
          `Winner's curse: awards near ${last.avg_ct} ct leave little buffer. If turbine prices, interest rates or grid costs rise, or the permit is challenged, projects stop being viable.`,
          `Deadline wave: ${gw(risk.unbuilt_expiring_12m_kw)} of awarded wind must be running within 12 months or the award lapses (36 months; late commissioning costs 10–30 €/kW).`,
          exposed ? `Weak owners: ${gw(exposed)} of unbuilt awards sit with companies in insolvency or restructuring (${risk.exposure.map((e) => `${e.company} ${gw(e.unbuilt_kw)}`).join(", ")}). Asset sales move projects to new owners and cost time.` : "",
          south ? `Regional imbalance: Bavaria and Baden-Württemberg won ${pct(south.first)} of awarded capacity in ${south.y0}, ${pct(south.last)} in ${south.y1}. Southern projects need more money per kWh; the lowest bids come from the north.` : "",
          "Buyers' market for projects: developers in trouble sell pipelines at the same time (SoWiTec's project rights, ABO's project sales), which presses valuations for everyone who develops to sell.",
        ]
      : [
          `Winner's curse: awards near ${last.avg_ct} ct assume cheap modules, cheap money and a quick grid connection. Any delay or price rise eats the margin.`,
          exposed ? `Weak owners: ${gw(exposed)} of awarded, unbuilt solar sits with companies in insolvency or restructuring (${risk.exposure.map((e) => `${e.company} ${gw(e.unbuilt_kw)}`).join(", ")}): ${pct(exposed / risk.unbuilt_kw)} of the whole solar backlog.` : "",
          "Revenue risk: more solar output falls into hours with negative prices, which earn little or nothing. Parks without a battery are the most exposed.",
          "Financing risk: storage is the answer to falling solar prices, but it needs more capital. Enerparc shows what happens when that capital does not come.",
          "A lapsed solar award costs 50 €/kW, so winners have a strong incentive to sell rather than drop projects: expect more transactions and some delays.",
        ];

  return (
    <Section
      id="overheating"
      eyebrow="Overheating"
      title={`${tech === "wind" ? "Wind" : "Solar"} award prices fell ${pct(drop)} from ${roundLabel(peak.bid_date)} to ${roundLabel(last.bid_date)}${factor ? `, with ${factor.toFixed(1)}× more bids than volume` : ""}: a cutthroat market`}
      subtitle={`How the auctions went from ${tech === "wind" ? "too few bids" : "prices near the ceiling"} to fierce price competition, what is still waiting to be built, and where the risks sit.`}
      asOf={date}
      source={<>Source: Bundesnetzagentur auction results, linked to the Marktstammdatenregister as of {date}; submitted bids from BNetzA press releases; market facts linked. Data processed.</>}
      takeaways={dangers.filter(Boolean)}
      caveats={[
        "\"Running\" means the linked units are in operation in MaStR. Units are often registered weeks late, so recent rounds look less built than they are.",
        tech === "wind" ? "Deadline = publication of the award + 36 months. BNetzA can extend it (lawsuits against the permit, insolvency of a turbine supplier; up to 18 months)." : "No deadline is shown for solar; unbuilt capacity is everything not yet running.",
        "Prices are round averages: single bids are not published.",
        "The dangers are our assessment, built on the figures shown and the linked sources.",
      ]}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Average award" value={`${last.avg_ct} ct`} sub={`${roundLabel(last.bid_date)}, −${pct(drop)} vs ${roundLabel(peak.bid_date)}`} />
        <Stat label="Bids vs volume" value={factor ? `${factor.toFixed(1)}×` : "–"} sub={latest ? `${mw(latest.submitted_mw)} bid for ${mw(latest.tender_mw)}, ${roundLabel(latest.bid_date)}` : ""} />
        <Stat label="Awarded, not yet running" value={gw(risk.unbuilt_kw)} sub={tech === "wind" ? `${gw(risk.unbuilt_expiring_12m_kw)} due within 12 months` : "awards since 2023"} />
        <Stat label="With firms in trouble" value={gw(exposed)} sub={risk.exposure.map((e) => e.company).join(", ") || "none"} />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Average award (line) and ceiling (dashed), ct/kWh</p>
          <PriceChart rounds={main} market={risk.market} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Awarded capacity per round since 2022: running vs not yet running</p>
          <BacklogChart risk={risk} asOf={data.risk!.as_of} />
          {tech === "wind" && mature.length > 0 && (
            <p className="mt-1 text-xs text-ink-muted">
              {mature.map((r) => `${roundLabel(r.bid_date)}: ${pct(r.operating_kw / r.awarded_kw)} running, deadline ${month(r.expires!)}`).join(" · ")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[3fr_2fr]">
        <div>
          <p className="mb-3 text-sm font-semibold">What led up to it</p>
          <Timeline steps={steps} />
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">Facts from the market</p>
          <ul className="space-y-2 text-sm text-ink-muted">
            {facts.map((f) => (
              <li key={f.text}>
                {f.text} <Link href={f.source}>Source</Link>
              </li>
            ))}
            {risk.market.map((m) => (
              <li key={m.bid_date}>
                {roundLabel(m.bid_date)}: {m.bids ? `${m.bids} bids, ` : ""}{mw(m.submitted_mw)} for {mw(m.tender_mw)} tendered ({(m.submitted_mw / m.tender_mw).toFixed(1)}×). <Link href={m.source}>Source</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
