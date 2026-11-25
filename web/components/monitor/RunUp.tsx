"use client";

// Registration run-up before auction bid dates (contract v1.9,
// auctions/runup.json): when permits and units of awarded projects appear in
// the Marktstammdatenregister relative to the bid date.
import * as Plot from "@observablehq/plot";
import { useEffect, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { cssVar } from "@/lib/theme";

import { Section, Stat } from "./ui";

interface Summary { n: number; median_days: number | null; share_before_bid: number | null; share_last_8_weeks: number | null }
interface WindRound { id: string; bid_date: string; permit_deadline: string | null; deadline_days: number | null; turbines: number; permit_days: number[]; unit_days: number[]; permit: Summary; unit: Summary; eligible_earlier?: { n: number; share_1plus: number | null; share_2plus: number | null } | null }
interface SolarRound { id: string; bid_date: string; awards: number; unit_days: number[]; unit: Summary }
interface Weekly { weeks: string[]; units: number[]; mw: number[] }
interface RunupFile {
  as_of: string;
  wind: { rounds: WindRound[]; weekly_permits: Weekly; awarded_turbines?: number; reawarded_turbines?: number };
  solar?: { rounds: SolarRound[]; weekly_ground_mounted: Weekly };
}

const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)} %`);
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const ACC = "#2563eb";
const SUN = "#f59e0b";

function useRunup(version: string) {
  const [d, setD] = useState<RunupFile | null>(null);
  useEffect(() => {
    fetch(`/data/auctions/runup.json?v=${version}`).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null));
  }, [version]);
  return d;
}

/** Weekly bins of day offsets, -horizon..+after weeks. */
function bins(days: number[], from: number, to: number) {
  const out: { week: number; n: number }[] = [];
  for (let w = from; w <= to; w++) out.push({ week: w, n: 0 });
  for (const d of days) {
    const w = Math.floor(d / 7);
    const b = out.find((x) => x.week === w);
    if (b) b.n += 1;
  }
  const tot = days.length || 1;
  return out.map((b) => ({ ...b, share: b.n / tot }));
}

function WeeklyChart({ w, marks, color, label, since }: { w: Weekly; marks: { date: string; kind: string }[]; color: string; label: string; since: string }) {
  const rows = w.weeks.map((d, i) => ({ d: new Date(d), units: w.units[i], mw: w.mw[i] })).filter((r) => r.d >= new Date(since));
  const m = marks.filter((x) => new Date(x.date) >= new Date(since)).map((x) => ({ ...x, d: new Date(x.date) }));
  return (
    <PlotFigure
      deps={[rows, m]}
      render={(width) =>
        Plot.plot({
          width, height: 260, marginLeft: 44, ...axis(),
          x: { type: "utc", label: null },
          y: { label: label, grid: true },
          marks: [
            Plot.ruleX(m.filter((x) => x.kind === "deadline"), { x: "d", stroke: "#dc2626", strokeDasharray: "3 3", strokeOpacity: 0.8 }),
            Plot.ruleX(m.filter((x) => x.kind === "bid"), { x: "d", stroke: cssVar("--ink-muted"), strokeOpacity: 0.5 }),
            Plot.rectY(rows, { x1: "d", x2: (r: { d: Date }) => new Date(r.d.getTime() + 6 * 864e5), y: "mw", fill: color, fillOpacity: 0.85 }),
            Plot.tip(rows, Plot.pointerX({ x: "d", y: "mw", title: (r: { d: Date; units: number; mw: number }) => `Week of ${r.d.toISOString().slice(0, 10)}\n${r.units} units, ${r.mw} MW` })),
          ],
        })
      }
    />
  );
}

function OffsetChart({ days, from, to, color, deadline, xLabel }: { days: number[]; from: number; to: number; color: string; deadline?: number | null; xLabel: string }) {
  const b = bins(days, from, to);
  return (
    <PlotFigure
      deps={[b, deadline]}
      render={(width) =>
        Plot.plot({
          width, height: 240, marginLeft: 40, ...axis(),
          x: { label: xLabel, domain: [from, to + 1] },
          y: { label: null, percent: true, grid: true, tickFormat: (d: number) => `${d}%` },
          marks: [
            Plot.rectY(b, { x1: "week", x2: (d: { week: number }) => d.week + 0.9, y: "share", fill: color }),
            Plot.ruleX([0], { stroke: cssVar("--ink"), strokeWidth: 1.5 }),
            ...(deadline != null ? [Plot.ruleX([deadline / 7], { stroke: "#dc2626", strokeDasharray: "3 3" })] : []),
            Plot.tip(b, Plot.pointerX({ x: (d: { week: number }) => d.week + 0.45, y: "share", title: (d: { week: number; n: number; share: number }) => `Week ${d.week >= 0 ? "+" : ""}${d.week}: ${d.n} (${pct(d.share)})` })),
          ],
        })
      }
    />
  );
}

export function WindRunUp({ version, date }: { version: string; date: string }) {
  const d = useRunup(version);
  if (!d) return null;
  const rs = d.wind.rounds.filter((r) => r.permit.n > 0);
  const recent = rs.filter((r) => r.bid_date >= "2022-01-01");
  const permitDays = recent.flatMap((r) => r.permit_days);
  const unitDays = recent.flatMap((r) => r.unit_days);
  const dl = recent.map((r) => r.deadline_days).filter((x): x is number => x != null);
  const medDeadline = dl.length ? dl.sort((a, b) => a - b)[Math.floor(dl.length / 2)] : null;
  const inLast = (days: number[], lo: number, hi: number) => days.filter((x) => x > lo && x <= hi).length / (days.length || 1);
  const before = permitDays.filter((x) => x <= 0);
  const lastMonthBeforeDeadline = medDeadline != null ? before.filter((x) => x > medDeadline - 28 && x <= medDeadline).length / (before.length || 1) : null;
  const medPermit = permitDays.length ? [...permitDays].sort((a, b) => a - b)[Math.floor(permitDays.length / 2)] : null;
  const elig = rs.filter((r) => r.eligible_earlier?.n && r.bid_date >= "2023-01-01").map((r) => ({ round: r.bid_date.slice(0, 7), one: r.eligible_earlier!.share_1plus ?? 0, two: r.eligible_earlier!.share_2plus ?? 0, n: r.eligible_earlier!.n }));
  const eligRows = elig.flatMap((e) => [
    { round: e.round, kind: "Could have bid in 1 earlier round", share: e.one - e.two },
    { round: e.round, kind: "In 2 or more earlier rounds", share: e.two },
  ]);
  const lastE = elig.at(-1);
  const yearShare = (yr: string) => {
    const x = elig.filter((e) => e.round.startsWith(yr));
    const n = x.reduce((t, e) => t + e.n, 0);
    return n ? x.reduce((t, e) => t + e.one * e.n, 0) / n : null;
  };
  const marks = [
    ...d.wind.rounds.map((r) => ({ date: r.bid_date, kind: "bid" })),
    ...d.wind.rounds.filter((r) => r.permit_deadline).map((r) => ({ date: r.permit_deadline!, kind: "deadline" })),
  ];
  return (
    <Section
      id="runup"
      eyebrow="Run-up to the bid date"
      title={lastMonthBeforeDeadline != null ? `${pct(lastMonthBeforeDeadline)} of the permits behind awarded turbines were registered in the four weeks before the deadline` : "When awarded projects show up in the register"}
      subtitle="Wind projects can only bid with a permit that is registered in the Marktstammdatenregister by the deadline, about four weeks before the bid date. When did the permits and turbines that later won appear?"
      asOf={date}
      source={<>Source: Marktstammdatenregister (permit and unit registration dates), Bundesnetzagentur award lists and round pages (deadlines), as of {date}. Data processed.</>}
      takeaways={[
        medPermit != null ? `Median: the permit of an awarded turbine was registered ${Math.abs(medPermit)} days ${medPermit <= 0 ? "before" : "after"} the bid date.` : "",
        `${pct(inLast(permitDays, -56, 0))} of these permits appeared in the last eight weeks before the bid date; companies keep their projects out of view until shortly before the round.`,
        `The turbines are mostly registered together with their permit: ${pct(unitDays.filter((x) => x <= 0).length / (unitDays.length || 1))} of them before the bid date.`,
        "The weekly chart shows the waves: permit registrations peak just before each deadline (red dashed lines), then drop.",
        lastE ? `Many winners had tried before: ${pct(lastE.one)} of the turbines awarded in ${lastE.round} could already have bid in an earlier round (${pct(lastE.two)} in two or more), against ${pct(yearShare("2024"))} across 2024. In oversubscribed rounds (since 2024) the likely reason is a lost earlier bid, then a lower one; in early 2023, when rounds had too few bids, projects more likely waited for the higher price ceiling.` : "",
        d.wind.reawarded_turbines ? `${d.wind.reawarded_turbines} of ${(d.wind.awarded_turbines ?? 0).toLocaleString("en-GB")} awarded turbines won in two different rounds: their first award most likely lapsed or was returned.` : "",
        (() => {
          const med = (yr: string) => {
            const m = rs.filter((r) => r.bid_date.startsWith(yr)).map((r) => r.permit.median_days).filter((x): x is number => x != null);
            return m.length ? m.reduce((t, x) => t + x, 0) / m.length : null;
          };
          const a = med("2024");
          const lastYear = rs.at(-1)?.bid_date.slice(0, 4) ?? "";
          const b = med(lastYear);
          return a != null && b != null && b < a - 30
            ? `In ${lastYear} the permits of winners were older: registered about ${Math.round(Math.abs(b))} days before the bid on average, against ${Math.round(Math.abs(a))} in 2024. With more bids than volume, many winners had bid and lost before.`
            : "";
        })(),
      ].filter(Boolean)}
      caveats={[
        "Rounds since 2022 (earlier pages give no deadline). Turbines linked through the register numbers on the award lists.",
        "Losing bids are not published. \"Could have bid earlier\" means the permit was registered before an earlier round's deadline; it does not prove the project bid then.",
        "A permit can be registered once for a whole wind farm; the date then counts for each of its turbines.",
        "The permit's registration date is when it was entered in the register, not when the authority issued it.",
      ]}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Deadline before bid" value={medDeadline != null ? `${Math.abs(medDeadline)} days` : "–"} sub="median, rounds since 2022" />
        <Stat label="Permits in last 4 weeks" value={pct(lastMonthBeforeDeadline)} sub="before the deadline" />
        <Stat label="Median permit registration" value={medPermit != null ? `${Math.abs(medPermit)} days` : "–"} sub="before the bid date" />
        <Stat label="Awarded turbines analysed" value={permitDays.length.toLocaleString("en-GB")} sub="with a permit date" />
      </div>
      {eligRows.length > 0 && (
        <div className="mt-8 min-w-0">
          <p className="text-sm font-semibold">Did the winners try before? Share of awarded turbines that could already have bid in earlier rounds</p>
          <PlotFigure
            deps={[eligRows]}
            render={(width) =>
              Plot.plot({
                width, height: 240, marginLeft: 40, ...axis(),
                x: { type: "band", label: null, tickRotate: width < 640 ? -45 : 0 },
                y: { label: null, percent: true, domain: [0, 100], grid: true, tickFormat: (v: number) => `${v}%` },
                color: { domain: ["Could have bid in 1 earlier round", "In 2 or more earlier rounds"], range: ["#93c5fd", ACC], legend: true },
                marks: [Plot.barY(eligRows, { x: "round", y: "share", fill: "kind", order: ["In 2 or more earlier rounds", "Could have bid in 1 earlier round"], tip: true, title: (r: { round: string; kind: string; share: number }) => `${r.round} · ${r.kind}: ${pct(r.share)}` })],
              })
            }
          />
          <p className="text-xs text-ink-muted">Rounds since 2023. Bars stack to the share eligible for at least one earlier round.</p>
        </div>
      )}
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Permit registration of awarded turbines, weeks relative to the bid date</p>
          <OffsetChart days={permitDays} from={-26} to={4} color={ACC} deadline={medDeadline} xLabel="weeks before (−) / after (+) the bid date" />
          <p className="text-xs text-ink-muted">Black line: bid date. Red dashed: typical permit deadline.</p>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">All onshore wind permits registered per week (MW)</p>
          <WeeklyChart w={d.wind.weekly_permits} marks={marks} color={ACC} label="MW per week" since="2023-01-01" />
          <p className="text-xs text-ink-muted">Red dashed: permit deadlines. Grey: bid dates.</p>
        </div>
      </div>
    </Section>
  );
}

export function SolarRunUp({ version, date }: { version: string; date: string }) {
  const d = useRunup(version);
  if (!d?.solar) return null;
  const rs = d.solar.rounds.filter((r) => r.unit.n > 0);
  const days = rs.flatMap((r) => r.unit_days);
  const med = days.length ? [...days].sort((a, b) => a - b)[Math.floor(days.length / 2)] : null;
  const before = days.filter((x) => x <= 0).length / (days.length || 1);
  const linked = rs.reduce((t, r) => t + r.unit.n, 0);
  const awards = d.solar.rounds.reduce((t, r) => t + r.awards, 0);
  const marks = d.solar.rounds.map((r) => ({ date: r.bid_date, kind: "bid" }));
  return (
    <Section
      id="runup"
      eyebrow="Run-up to the bid date"
      title={med != null ? `Awarded solar parks appear in the register ${Math.round(Math.abs(med) / 30)} months ${med >= 0 ? "after" : "before"} the bid date (median); only ${pct(before)} before` : "When awarded solar parks show up in the register"}
      subtitle="Unlike wind, solar bids need no registered permit, so parks enter the Marktstammdatenregister late, often only when they are built. When did the parks that won appear?"
      asOf={date}
      source={<>Source: Marktstammdatenregister (registration dates, award numbers), Bundesnetzagentur award lists, as of {date}. Data processed.</>}
      takeaways={[
        `${linked.toLocaleString("en-GB")} of ${awards.toLocaleString("en-GB")} solar awards since 2023 are already linked to a registered park.`,
        "Before a solar round, the register shows almost nothing of what will bid: the competition is invisible until the results.",
        "Large ground-mounted registrations per week show the building wave, not the bidding wave.",
      ]}
      caveats={["Only awards whose park already carries the award number in the register; recent rounds are mostly not registered yet.", "Ground-mounted parks of 750 kW and more in the weekly chart."]}
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">First registration of awarded parks, weeks relative to the bid date</p>
          <OffsetChart days={days} from={-26} to={104} color={SUN} xLabel="weeks before (−) / after (+) the bid date" />
          <p className="text-xs text-ink-muted">Black line: bid date.</p>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Large ground-mounted solar registered per week (MW)</p>
          <WeeklyChart w={d.solar.weekly_ground_mounted} marks={marks} color={SUN} label="MW per week" since="2023-01-01" />
          <p className="text-xs text-ink-muted">Grey: solar bid dates.</p>
        </div>
      </div>
    </Section>
  );
}
