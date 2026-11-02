"use client";

// Storage and co-location on the energy-transition page: how long large
// batteries can run, how many sit next to wind and solar parks, the battery
// share in solar auctions, and the storage pipeline. Computed in the browser
// from monitor/points.json, monitor/stats.json and auctions/solar.json.
import * as Plot from "@observablehq/plot";
import { useMemo } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { mw, type MonitorData } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

import { roundLabel } from "./Auctions";
import { Section, Stat } from "./ui";

const NEAR_KM = 1.5; // point coordinates are rounded to 0.01°, about 1 km
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const pct = (x: number) => `${Math.round(x * 100)} %`;

interface Row { year: number; series: string; share: number; n: number }

/** Share of new large batteries next to a wind or solar plant, and of new solar parks next to a battery. */
export function colocation(data: MonitorData, from = 2016): Row[] {
  const p = data.points;
  const ti = (t: string) => (p.techs as readonly string[]).indexOf(t);
  const [S, W, B] = [ti("solar"), ti("wind_onshore"), ti("storage")];
  const pts: { x: number; y: number; year: number; t: number }[] = [];
  for (let i = 0; i < p.operating.length; i += 5) {
    const t = p.operating[i + 3];
    if (t === S || t === W || t === B) pts.push({ x: p.operating[i], y: p.operating[i + 1], year: p.first_year + p.operating[i + 2], t });
  }
  const cells = new Map<string, typeof pts>();
  for (const q of pts) {
    const k = `${q.x},${q.y}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(q);
  }
  const near = (q: (typeof pts)[number], want: (t: number) => boolean) => {
    const kx = Math.cos((q.y / 100) * (Math.PI / 180)) * 1.113; // km per 0.01° longitude
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++)
        for (const o of cells.get(`${q.x + dx},${q.y + dy}`) ?? [])
          if (o !== q && want(o.t) && Math.hypot((o.x - q.x) * kx, (o.y - q.y) * 1.113) <= NEAR_KM) return true;
    return false;
  };
  const acc = new Map<string, { hit: number; n: number }>();
  const add = (series: string, year: number, hit: boolean) => {
    const k = `${series}|${year}`;
    const a = acc.get(k) ?? { hit: 0, n: 0 };
    a.n += 1;
    a.hit += hit ? 1 : 0;
    acc.set(k, a);
  };
  for (const q of pts) {
    if (q.year < from) continue;
    if (q.t === B) add("Large batteries next to a wind or solar park", q.year, near(q, (t) => t === S || t === W));
    if (q.t === S) add("Solar parks with a large battery nearby", q.year, near(q, (t) => t === B));
  }
  return [...acc.entries()]
    .map(([k, a]) => {
      const [series, year] = k.split("|");
      return { year: Number(year), series, share: a.hit / a.n, n: a.n };
    })
    .filter((r) => r.n >= 5)
    .sort((a, b) => a.year - b.year);
}

export function StorageColocation({ data, date }: { data: MonitorData; date: string }) {
  const rows = useMemo(() => colocation(data), [data]);
  const st = data.stats;
  const lb = st.battery_storage.buckets.large;
  const years = st.battery_storage.years;
  const dur = years
    .map((y, i) => ({ year: y, h: lb.mw[i] ? lb.mwh[i] / lb.mw[i] : null, mw: lb.mw[i] }))
    .filter((r): r is { year: number; h: number; mw: number } => r.h != null && r.mw >= 50);
  const durNow = dur.at(-1);
  const dur0 = dur.find((r) => r.year >= 2018) ?? dur[0];
  const lastFull = Math.max(...rows.map((r) => r.year)) - 1;
  const bat = rows.filter((r) => r.series.startsWith("Large batteries"));
  const sol = rows.filter((r) => r.series.startsWith("Solar parks"));
  const batLast = bat.find((r) => r.year === lastFull) ?? bat.at(-1);
  const solLast = sol.find((r) => r.year === lastFull) ?? sol.at(-1);
  const solFirst = sol[0];
  const auctions = (data.solar?.rounds ?? []).filter((r) => r.programme === "solar" && r.co_located_share != null);
  const aFirst = auctions[0];
  const aLast = auctions.at(-1);
  const plannedSt = st.planned_mw.storage ?? 0;
  const installedSt = st.installed_mw.storage ?? 0;

  return (
    <Section
      id="colocation"
      eyebrow="Storage and co-location"
      title={
        durNow && batLast
          ? `New large batteries now store ${durNow.h.toFixed(1)} hours of power, and ${pct(batLast.share)} of those built in ${batLast.year} sit next to a wind or solar park`
          : "Batteries move next to wind and solar"
      }
      subtitle="How long Germany's large batteries can run at full power, how many share a site with wind or solar, and how fast batteries join solar parks."
      asOf={date}
      source={<>Source: Marktstammdatenregister (plants of 1 MW and more), Bundesnetzagentur solar auctions, as of {date}. Data processed.</>}
      takeaways={[
        durNow && dur0 ? `Duration of new large batteries rose from ${dur0.h.toFixed(1)} h (${dur0.year}) to ${durNow.h.toFixed(1)} h (${durNow.year}): from grid-frequency services towards shifting solar power into the evening.` : "",
        solLast && solFirst ? `Solar parks with a large battery nearby: ${pct(solFirst.share)} of those built in ${solFirst.year}, ${pct(solLast.share)} in ${solLast.year}.` : "",
        aFirst && aLast ? `In the solar auctions, the share of awarded capacity with a battery on site rose from ${pct(aFirst.co_located_share!)} (${roundLabel(aFirst.bid_date)}) to ${pct(aLast.co_located_share!)} (${roundLabel(aLast.bid_date)}).` : "",
        `${mw(plannedSt)} of storage is registered as planned, against ${mw(installedSt)} in operation.`,
        "Why it matters: a battery at a solar park earns the evening price instead of the midday price, and lets the park use a grid connection that is too small for its peak.",
      ].filter(Boolean)}
      caveats={[
        `"Next to" means within about ${NEAR_KM} km in the register's rounded coordinates (plants of 1 MW and more); the register's own on-site flag is used for the auction share.`,
        "Storage includes a few large pumped-hydro plants; since 2016 almost all new large storage is batteries.",
        "The latest year is incomplete because units are registered late.",
      ]}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Storage in operation" value={mw(installedSt)} sub="all sizes" />
        <Stat label="Storage planned" value={mw(plannedSt)} sub="registered in MaStR" />
        <Stat label="Hours per new large battery" value={durNow ? `${durNow.h.toFixed(1)} h` : "–"} sub={durNow ? `${durNow.year}` : ""} />
        <Stat label="Solar auctions with battery" value={aLast ? pct(aLast.co_located_share!) : "–"} sub={aLast ? roundLabel(aLast.bid_date) : ""} />
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Co-location by year built</p>
          <PlotFigure
            deps={[rows]}
            render={(width) =>
              Plot.plot({
                width, height: 260, marginLeft: 40, ...axis(),
                x: { label: null, tickFormat: (d: number) => String(d) },
                y: { label: null, percent: true, domain: [0, 100], grid: true, tickFormat: (d: number) => `${d}%` },
                color: { domain: ["Large batteries next to a wind or solar park", "Solar parks with a large battery nearby"], range: [cssVar("--tech-storage"), cssVar("--tech-solar")], legend: true },
                marks: [
                  Plot.line(rows, { x: "year", y: "share", stroke: "series", strokeWidth: 2.5 }),
                  Plot.dot(rows, { x: "year", y: "share", fill: "series", r: 3, tip: true, title: (d: Row) => `${d.series}\n${d.year}: ${pct(d.share)} of ${d.n}` }),
                ],
              })
            }
          />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Hours of storage per MW, new large batteries</p>
          <PlotFigure
            deps={[dur]}
            render={(width) =>
              Plot.plot({
                width, height: 260, marginLeft: 36, ...axis(),
                x: { type: "band", label: null, tickFormat: (d: number) => String(d) },
                y: { label: "hours", grid: true },
                marks: [
                  Plot.barY(dur, { x: "year", y: "h", fill: cssVar("--tech-storage"), rx: 4 }),
                  Plot.text(dur, { x: "year", y: "h", text: (d: { h: number }) => d.h.toFixed(1), dy: -8, fontSize: 11, fill: cssVar("--ink") }),
                ],
              })
            }
          />
        </div>
      </div>
    </Section>
  );
}
