"use client";

// Rise and fall of auction winners, business models and exits. Shared by the
// wind and solar storylines.
import * as Plot from "@observablehq/plot";
import type { ReactNode } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { mw, type CompanyFacts, type DynGroup, type Dynamics } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

import { roundLabel } from "./Auctions";
import { Section } from "./ui";

type Status = DynGroup["status"];
const STATUS: Record<Status, { label: string; color: string; note: string }> = {
  new: { label: "New", color: "#2563eb", note: "first award in the last third of the rounds" },
  rising: { label: "Rising", color: "#10b981", note: "share up by ≥ 0.5 points" },
  steady: { label: "Steady", color: "#94a3b8", note: "share within ± 0.5 points" },
  fading: { label: "Fading", color: "#ef4444", note: "share down by ≥ 0.5 points" },
  dropped: { label: "Dropped out", color: "#475569", note: "no award in the latest rounds" },
};
const MODEL: Record<CompanyFacts["companies"][number]["model"], string> = {
  develop_sell: "Develops & sells",
  ipp: "Develops & keeps (IPP)",
  mixed: "Keeps some, sells some",
  investor: "Fund-backed buyer",
};
const FINANCE: Record<string, string> = {
  project: "Project finance",
  corporate: "Corporate finance",
  fund: "Fund equity",
  mixed: "Project + corporate",
};
const KIND: Record<CompanyFacts["events"][number]["kind"], string> = {
  insolvency: "Insolvency",
  restructuring: "Restructuring",
  sales_halt: "Sales halt",
  exit: "Exit",
};

const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const pp = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toFixed(1)} pts`;
const span = (ys: string[]) => (ys.length > 1 ? `${ys[0]}–${ys.at(-1)}` : ys[0]);
const names = (gs: DynGroup[], n = 4) => gs.slice(0, n).map((g) => g.group).join(", ");
const month = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

function Sources({ urls }: { urls: string[] }) {
  return (
    <span className="text-[11px] text-ink-muted">
      {urls.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" className="mr-1 underline decoration-rule underline-offset-2 hover:text-ink">
          [{i + 1}] {new URL(u).hostname.replace(/^www\./, "")}
        </a>
      ))}
    </span>
  );
}

// --- Rise and fall -----------------------------------------------------------

export function RiseFallSection({
  dyn,
  facts,
  tech,
  date,
  source,
}: {
  dyn: Dynamics;
  facts: CompanyFacts | null;
  tech: "wind" | "solar";
  date: string;
  source: ReactNode;
}) {
  const g = dyn.groups;
  const by = (s: Status) => g.filter((x) => x.status === s);
  const risers = by("rising").sort((a, b) => b.momentum_pp - a.momentum_pp);
  const faders = by("fading").sort((a, b) => a.momentum_pp - b.momentum_pp);
  const fresh = by("new").sort((a, b) => b.mw - a.mw);
  const dropped = by("dropped");
  const top = g.slice(0, 10);
  const steadyPipes = top.filter((x) => (x.hit_rate ?? 0) >= 0.75).sort((a, b) => (b.hit_rate ?? 0) - (a.hit_rate ?? 0));
  const lumpy = g.filter((x) => (x.volatility ?? 0) >= 1.2 && (x.hit_rate ?? 1) < 0.5).sort((a, b) => b.mw - a.mw);
  const trouble = (facts?.events ?? []).filter((e) => e.group && g.some((x) => x.group === e.group) && e.date >= "2024");

  const bars = [...g].sort((a, b) => Math.abs(b.momentum_pp) - Math.abs(a.momentum_pp)).slice(0, 18).sort((a, b) => b.momentum_pp - a.momentum_pp);
  const scatter = g.filter((x) => x.hit_rate != null && x.volatility != null);
  const labelled = new Set([...g.slice(0, 8), ...risers.slice(0, 3), ...faders.slice(0, 3)].map((x) => x.group));
  const unit = tech === "wind" ? "wind" : "solar";

  return (
    <Section
      id="rise-and-fall"
      eyebrow="Rise and fall"
      title={
        risers.length && faders.length
          ? `${names(risers, 3)} grabbed share; ${names(faders, 3)} lost ground`
          : "Who gains and who loses share in the auctions"
      }
      subtitle={`Each group's share of the awarded ${unit} capacity in ${span(dyn.early)} against ${span(dyn.late)}, how regularly it wins and how much its volume swings from year to year. Groups with at least 100 MW awarded.`}
      asOf={date}
      source={source}
      takeaways={[
        steadyPipes.length ? `Steady pipelines: ${steadyPipes.slice(0, 5).map((x) => `${x.group} (${x.rounds_won} of ${x.rounds_possible} rounds)`).join(", ")} win almost every round since their first award. That takes land and permits secured years earlier.` : "",
        risers.length ? `Share grabbers: ${risers.slice(0, 5).map((x) => `${x.group} ${pp(x.momentum_pp)}`).join(", ")}.${risers.some((x) => facts?.companies.find((c) => c.group === x.group)?.model === "investor") ? " Qualitas grew mainly by buying developers and pipelines, not by developing from scratch." : ""}` : "",
        fresh.length ? `New names: ${fresh.slice(0, 5).map((x) => `${x.group} (first award ${roundLabel(x.first_bid)})`).join(", ")}.` : "",
        faders.length ? `Losing share: ${faders.slice(0, 5).map((x) => `${x.group} ${pp(x.momentum_pp)}`).join(", ")}. Most still win, but less than the market grows.` : "",
        dropped.length ? `Dropped out (no award in the last ${dyn.recent_rounds} rounds): ${dropped.map((x) => `${x.group} (last ${roundLabel(x.last_bid)})`).join(", ")}.` : "",
        lumpy.length ? `Opportunistic bidders with big swings and few rounds: ${names(lumpy, 5)}.` : "",
        trouble.length ? `Financial trouble among the winners: ${trouble.map((e) => `${e.company} (${KIND[e.kind].toLowerCase()}, ${month(e.date)})`).join(", ")}. See "Business models and exits" below.` : "",
      ].filter(Boolean)}
      caveats={[
        "Losing bids are not published. \"Rounds with an award\" counts rounds since a group's first award, not its bids.",
        "Shares depend on attribution: groups that bid through anonymous project companies look smaller.",
        `Early = ${span(dyn.early)}, late = ${span(dyn.late)}; the running year is incomplete.${tech === "solar" ? " Award-level solar data starts in 2023, so the period is short." : ""}`,
        "Year-to-year swing = coefficient of variation of the yearly awarded MW since the first award.",
      ]}
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Change in share of awarded capacity, {span(dyn.early)} → {span(dyn.late)}</p>
          <PlotFigure
            deps={[bars]}
            height={bars.length * 22 + 40}
            render={(width) =>
              Plot.plot({
                width,
                height: bars.length * 22 + 40,
                marginLeft: Math.min(130, width * 0.34),
                marginRight: 52,
                ...axis(),
                x: { label: "Share change (percentage points)", grid: true, insetLeft: 40, tickFormat: (d: number) => `${d > 0 ? "+" : ""}${d}` },
                y: { label: null, domain: bars.map((x) => x.group) },
                marks: [
                  Plot.ruleX([0], { stroke: cssVar("--ink-muted") }),
                  Plot.barX(bars, { x: "momentum_pp", y: "group", fill: (d: DynGroup) => STATUS[d.status].color, rx: 3 }),
                  ...([true, false] as const).map((up) =>
                    Plot.text(bars.filter((d) => (d.momentum_pp >= 0) === up), {
                      x: "momentum_pp",
                      y: "group",
                      text: (d: DynGroup) => pp(d.momentum_pp).replace(" pts", ""),
                      textAnchor: up ? "start" : "end",
                      dx: up ? 4 : -4,
                      fill: cssVar("--ink"),
                      fontSize: 11,
                    }),
                  ),
                  Plot.tip(bars, Plot.pointerY({ x: "momentum_pp", y: "group", title: (d: DynGroup) => `${d.group} · ${STATUS[d.status].label}\n${(d.share_early * 100).toFixed(1)}% → ${(d.share_late * 100).toFixed(1)}%\n${mw(d.mw)} awarded` })),
                ],
              })
            }
          />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Steady pipeline or opportunistic? Regularity vs swing</p>
          <PlotFigure
            deps={[scatter]}
            height={360}
            render={(width) =>
              Plot.plot({
                width,
                height: 360,
                marginLeft: 44,
                marginBottom: 40,
                ...axis(),
                x: { label: "Rounds with an award since first win →", percent: true, domain: [0, 100], grid: true, tickFormat: (d: number) => `${d}%` },
                y: { label: "↑ Year-to-year swing", grid: true },
                r: { range: [3, 16] },
                marks: [
                  Plot.text(["Steady pipeline"], { frameAnchor: "bottom-right", dx: -6, dy: -6, fill: cssVar("--ink-muted"), fontSize: 11, fontWeight: 700 }),
                  Plot.text(["Opportunistic"], { frameAnchor: "top-left", dx: 6, dy: 6, fill: cssVar("--ink-muted"), fontSize: 11, fontWeight: 700 }),
                  Plot.dot(scatter, { x: "hit_rate", y: "volatility", r: "mw", fill: (d: DynGroup) => STATUS[d.status].color, fillOpacity: 0.75, stroke: cssVar("--paper"), strokeWidth: 1 }),
                  Plot.text(scatter.filter((d) => labelled.has(d.group)), { x: "hit_rate", y: "volatility", text: "group", dy: -12, fontSize: 11, fill: cssVar("--ink") }),
                  Plot.tip(scatter, Plot.pointer({ x: "hit_rate", y: "volatility", title: (d: DynGroup) => `${d.group} · ${STATUS[d.status].label}\n${d.rounds_won} of ${d.rounds_possible} rounds · swing ${d.volatility}\n${mw(d.mw)} awarded` })),
                ],
              })
            }
          />
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(["new", "rising", "fading", "dropped"] as Status[]).map((s) => {
          const list = s === "rising" ? risers : s === "fading" ? faders : s === "new" ? fresh : dropped;
          return (
            <div key={s} className="rounded-[20px] bg-surface p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS[s].color }} />
                {STATUS[s].label} <span className="figures font-normal text-ink-muted">({list.length})</span>
              </p>
              <p className="mt-0.5 text-[11px] text-ink-muted">{STATUS[s].note}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {list.slice(0, 6).map((x) => (
                  <li key={x.group} className="flex justify-between gap-2">
                    <span className="truncate">{x.group}</span>
                    <span className="figures shrink-0 text-ink-muted">
                      {s === "new" ? roundLabel(x.first_bid) : s === "dropped" ? `last ${roundLabel(x.last_bid)}` : pp(x.momentum_pp)}
                    </span>
                  </li>
                ))}
                {!list.length && <li className="text-ink-muted">none</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// --- Business models, finance and exits --------------------------------------

export function CompanyFactsSection({
  facts,
  dyn,
  tech,
  date,
}: {
  facts: CompanyFacts;
  dyn: Dynamics | undefined;
  tech: "wind" | "solar";
  date: string;
}) {
  const groups = new Map((dyn?.groups ?? []).map((g) => [g.group, g]));
  const cards = facts.companies.filter((c) => groups.has(c.group)).sort((a, b) => (groups.get(b.group)?.mw ?? 0) - (groups.get(a.group)?.mw ?? 0));
  const events = facts.events.filter((e) => e.tech === tech || e.tech === "both").slice().reverse();
  const recent = events.filter((e) => e.date >= "2024");
  const byModel = (m: string) => cards.filter((c) => c.model === m).map((c) => c.group);
  const sellers = byModel("develop_sell");
  const keepers = byModel("ipp");
  const mixed = byModel("mixed");
  const buyers = byModel("investor");
  return (
    <Section
      id="business-models"
      eyebrow="Business models and exits"
      title={
        recent.length
          ? `${recent.map((e) => e.company).join(", ")}: ${recent.length} ${tech} players ran into financial trouble since 2024`
          : "How the leading groups make money and finance their growth"
      }
      subtitle="Who develops to sell, who keeps the parks, how they finance it, and who retreated. Hand-collected from company and press sources; each statement links its source."
      asOf={date}
      source={<>Sources: company reports and press, linked on each card, as of {new Date(`${facts.as_of}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}; auction figures: BNetzA, Marktstammdatenregister, as of {date}.</>}
      takeaways={[
        [
          sellers.length ? `Develop and sell: ${sellers.join(", ")}` : "",
          keepers.length ? `develop and keep: ${keepers.join(", ")}` : "",
          mixed.length ? `both: ${mixed.join(", ")}` : "",
          buyers.length ? `fund-backed buyer: ${buyers.join(", ")}` : "",
        ].filter(Boolean).join("; ") + ".",
        "Assessment: selling parks recycles capital fast but depends on buyers paying today's prices; keeping parks needs cheap long-term debt. Both models came under pressure as interest rates rose and auction and power prices fell.",
        recent.length ? `Recent cases: ${recent.map((e) => `${e.company} (${month(e.date)})`).join(", ")}. The reasons given: ${tech === "wind" ? "high debt, failed financings, and for southern wind developers low auction prices" : "failed financings (Enerparc: solar-plus-storage) and high debt"}.` : "",
        tech === "wind" ? "Turbine makers had their own crises: Senvion went insolvent in 2019 and Siemens Gamesa restricted onshore sales in 2023. That left the German market mostly to Enercon, Nordex and Vestas." : "",
      ].filter(Boolean)}
      caveats={[
        "Not a complete list. Financing details are often not published (for UKA we found no public source on its financing).",
        "Facts are checked by hand when the file is updated, not daily.",
      ]}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const d = groups.get(c.group)!;
          return (
            <article key={c.group} className="flex flex-col rounded-[20px] border border-rule p-5">
              <h3 className="text-lg font-extrabold tracking-tight">{c.group}</h3>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                <span className="rounded-full bg-surface px-2.5 py-1">{MODEL[c.model]}</span>
                {c.finance && <span className="rounded-full bg-surface px-2.5 py-1">{FINANCE[c.finance]}</span>}
                {c.international && <span className="rounded-full bg-surface px-2.5 py-1">International</span>}
              </div>
              <p className="figures mt-3 flex items-center gap-1.5 text-sm">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: STATUS[d.status].color }} />
                {mw(d.mw)} awarded · {STATUS[d.status].label.toLowerCase()} · {d.rounds_won} of {d.rounds_possible} rounds
              </p>
              <p className="mt-2 flex-1 text-sm text-ink-muted">{c.note}</p>
              <div className="mt-3"><Sources urls={c.sources} /></div>
            </article>
          );
        })}
      </div>
      {events.length > 0 && (
        <div className="mt-8">
          <p className="text-sm font-semibold">Retreats and crises</p>
          <ol className="mt-3 space-y-3 border-l-2 border-rule pl-4">
            {events.map((e) => (
              <li key={`${e.company}-${e.date}`} className="relative">
                <span aria-hidden className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                <p className="text-sm">
                  <span className="figures font-semibold">{month(e.date)}</span> · <span className="font-semibold">{e.company}</span>{" "}
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold">{KIND[e.kind]}</span>
                </p>
                <p className="mt-0.5 text-sm text-ink-muted">{e.issue}</p>
                <Sources urls={e.sources} />
              </li>
            ))}
          </ol>
        </div>
      )}
    </Section>
  );
}

// --- Turbine makers worldwide ------------------------------------------------

export function OemWorldSection({ facts, date }: { facts: CompanyFacts; date: string }) {
  const o = facts.oems!;
  const m = o.makers;
  return (
    <Section
      id="makers-world"
      eyebrow="Makers worldwide"
      title={`Outside China, ${m[0].maker} installed ${m[0].gw} GW in ${o.source_year}, ${m[1].maker} ${m[1].gw} GW`}
      subtitle={`Wind turbines installed by maker in ${o.source_year}, ${o.scope.toLowerCase()}, and the number of countries with installations.`}
      asOf={date}
      source={<>Source: GWEC global wind turbine supplier ranking {o.source_year}; Nordex Group. <Sources urls={o.sources} /></>}
      takeaways={[
        ...o.notes,
        "Enercon, installed in 22 countries in 2025, is not in the top five outside China.",
        "Chinese makers install most turbines worldwide, almost all of them in China; this ranking leaves China out.",
      ]}
      caveats={["Annual figures from the makers' trade association ranking; they count grid-connected installations and can differ from order intake."]}
    >
      <ol className="space-y-2">
        {m.map((x) => (
          <li key={x.maker} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 sm:grid-cols-[10rem_1fr]">
            <span className="truncate text-sm font-semibold">{x.maker}</span>
            <div className="flex items-center gap-2">
              <div className="h-3 rounded-full bg-accent" style={{ width: `${(x.gw / m[0].gw) * 72}%` }} />
              <span className="figures shrink-0 text-xs text-ink-muted">
                {x.gw} GW{x.countries ? ` · ${x.countries} countries` : ""}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
