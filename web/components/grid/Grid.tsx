"use client";

// Germany's grid (contract v1.7 draft, grid/grid.json): who connects the large
// renewables, the four TSO control areas, where big demand sits and comes,
// what congestion costs, and the rules that are changing.
import * as Plot from "@observablehq/plot";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { projectGermany, setupCanvas } from "@/components/monitor/canvasMap";
import { Loading, Section, Stat } from "@/components/monitor/ui";
import { mw } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

type Tech = "wind_onshore" | "solar" | "storage";
type KW = Record<Tech, number>;
interface Src { source: string }
interface GridFile {
  as_of: string;
  scope: string;
  coverage_share: number;
  control_areas: { name: string; kw: KW; planned_kw: KW; consumers_operating: number; consumers_planned: number }[];
  operators: {
    registered: number;
    tsos: number;
    with_large_units: number;
    top10_share: number;
    operators_for_half: number;
    top: { name: string; tso: boolean; kw: KW; units: number; share: number; high_voltage_share: number | null }[];
  };
  voltage: { level: string; kw: KW }[];
  areas: string[];
  districts: Record<string, [number, number, number]>;
  consumers: {
    operating: number;
    planned: number;
    sites_with_units_over_50mw: number;
    by_state: Record<string, [number, number]>;
    planned_by_year: Record<string, number>;
    points: number[];
  };
  context: {
    congestion: ({ year: number; cost_meur: number; volume_twh?: number; re_compensation_meur?: number } & Src)[];
    congestion_split_2025: { source: string; items: { label: string; meur: number }[] };
    facts: ({ topic: string; text: string } & Src)[];
    regulation: ({ date: string; name: string; status: "in_force" | "in_parliament"; what: string } & Src)[];
  };
}

const TECH: Record<Tech, { label: string; color: string }> = {
  wind_onshore: { label: "Onshore wind", color: "#2563eb" },
  solar: { label: "Solar", color: "#f59e0b" },
  storage: { label: "Storage", color: "#8b5cf6" },
};
const AREA_COLOR: Record<string, string> = { "50Hertz": "#0891b2", Amprion: "#ea580c", TenneT: "#4f46e5", TransnetBW: "#16a34a" };
const VOLT: Record<string, string> = {
  extra_high: "Extra-high voltage (TSO)",
  extra_high_to_high: "Substation extra-high/high",
  high: "High voltage (110 kV)",
  high_to_medium: "Substation high/medium",
  medium: "Medium voltage",
  medium_to_low: "Substation medium/low",
  low: "Low voltage",
};
const sum = (k: KW) => k.wind_onshore + k.solar + k.storage;
const gw = (kw: number) => mw(kw / 1000);
const pct = (x: number) => `${Math.round(x * 100)} %`;
const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const month = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

function SrcLink({ href }: { href: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:text-ink">{host(href)}</a>;
}

function TechBars({ rows }: { rows: { label: ReactNode; kw: KW; note?: string }[] }) {
  const max = Math.max(...rows.map((r) => sum(r.kw)), 1);
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="grid grid-cols-[8.5rem_1fr] items-center gap-2 sm:grid-cols-[14rem_1fr]">
          <span className="min-w-0 text-sm"><span className="block truncate font-semibold">{r.label}</span>{r.note && <span className="block text-[11px] text-ink-muted">{r.note}</span>}</span>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-3 overflow-hidden rounded-full" style={{ width: `${(sum(r.kw) / max) * 75}%` }}>
              {(Object.keys(TECH) as Tech[]).map((t) => <div key={t} style={{ width: `${(r.kw[t] / Math.max(sum(r.kw), 1)) * 100}%`, background: TECH[t].color }} />)}
            </div>
            <span className="figures shrink-0 text-xs text-ink-muted">{gw(sum(r.kw))}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Legend({ items }: { items: { label: string; color: string; ring?: boolean }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={i.ring ? { border: `2px solid ${i.color}` } : { background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function AreaMap({ g, geo }: { g: GridFile; geo: GeoJSON.FeatureCollection }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas, 640);
    const { projection, districts } = projectGermany(geo, width, height, 12);
    ctx.clearRect(0, 0, width, height);
    const dens = districts.map((d) => (g.districts[d.key]?.[1] ?? 0) / d.km2);
    const maxD = Math.max(...dens, 1);
    districts.forEach((d, i) => {
      const v = g.districts[d.key];
      ctx.globalAlpha = v ? 0.15 + 0.75 * Math.sqrt(dens[i] / maxD) : 1;
      ctx.fillStyle = v ? AREA_COLOR[g.areas[v[0]]] : cssVar("--surface");
      ctx.fill(d.path);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = cssVar("--paper");
      ctx.lineWidth = 0.5;
      ctx.stroke(d.path);
    });
    const p = g.consumers.points;
    for (let i = 0; i < p.length; i += 4) {
      const xy = projection([p[i] / 100, p[i + 1] / 100]);
      if (!xy) continue;
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], p[i + 3] ? 3.6 : 2.4, 0, Math.PI * 2);
      if (p[i + 2] === 1) {
        ctx.fillStyle = cssVar("--ink");
        ctx.fill();
      } else {
        ctx.strokeStyle = "#dc2626";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }, [g, geo, tick]);
  return <canvas ref={ref} className="w-full" role="img" aria-label="Map of German districts coloured by TSO control area, darker where more large wind and solar capacity is installed per km², with dots for large electricity consumers in operation and rings for planned ones." />;
}

export function Grid({ version }: { version: string }) {
  const [g, setG] = useState<GridFile | null>(null);
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([
      fetch(`/data/grid/grid.json?v=${version}`).then((r) => r.json()),
      fetch(`/data/boundaries/districts.geojson?v=${version}`).then((r) => r.json()),
    ])
      .then(([a, b]) => { setG(a); setGeo(b); })
      .catch(() => setFailed(true));
  }, [version]);
  if (failed) return <p className="py-10 text-ink-muted">Grid data is not available.</p>;
  if (!g || !geo) return <Loading height={500} />;

  const asOf = new Date(`${g.as_of}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const mastr = <>Source: Marktstammdatenregister (grid connection points, grid operators, large consumers), as of {asOf}. {g.scope}. Data processed.</>;
  const op = g.operators;
  const areas = [...g.control_areas].sort((a, b) => sum(b.kw) - sum(a.kw));
  const north = areas[0];
  const south = areas.find((a) => a.name === "TransnetBW")!;
  const vTotal = g.voltage.reduce((t, v) => t + sum(v.kw), 0);
  const dist = g.voltage.filter((v) => !v.level.startsWith("extra_high")).reduce((t, v) => t + sum(v.kw), 0);
  const ctx = g.context;
  const last = ctx.congestion.at(-1)!;
  const facts = (t: string) => ctx.facts.filter((f) => f.topic === t);
  const years = Object.entries(g.consumers.planned_by_year).map(([y, n]) => ({ y, n }));
  const overdue = years.filter((x) => Number(x.y) < Number(g.as_of.slice(0, 4))).reduce((t, x) => t + x.n, 0);
  const states = Object.entries(g.consumers.by_state).map(([s, [o, p]]) => ({ s, o, p })).sort((a, b) => b.o + b.p - (a.o + a.p)).slice(0, 10);

  return (
    <>
      <Section
        id="operators"
        eyebrow="Who connects the energy transition"
        title={`${op.operators_for_half} grid operators connect half of Germany's large wind, solar and storage; ${op.with_large_units} share the rest`}
        subtitle="Capacity of large units in operation by the grid operator they are connected to (the network operator named at each grid connection point)."
        asOf={asOf}
        source={mastr}
        takeaways={[
          `${op.registered} electricity grid operators are registered; ${op.tsos} entities hold the transmission role (the four TSOs).`,
          `The top 10 carry ${pct(op.top10_share)} of large renewable capacity. They are mostly rural distribution operators in the north and east, where wind and solar parks are built far from cities.`,
          "Each operator sets its own connection process, so a project's grid date depends heavily on which operator's area it is in.",
        ]}
        caveats={[`Grid data found for ${pct(g.coverage_share)} of large-unit capacity; small rooftop solar is not included.`, "Pumped hydro counts as storage."]}
      >
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Grid operators registered" value={op.registered.toLocaleString("en-GB")} sub={`${op.tsos} with the TSO role`} />
          <Stat label="With large units" value={op.with_large_units.toLocaleString("en-GB")} sub="wind, solar, storage" />
          <Stat label="Top 10 share" value={pct(op.top10_share)} sub="of large-unit capacity" />
          <Stat label="Half of capacity" value={`${op.operators_for_half} operators`} />
        </div>
        <TechBars rows={op.top.slice(0, 15).map((o) => ({ label: o.name, kw: o.kw, note: `${o.tso ? "TSO · " : ""}${o.units.toLocaleString("en-GB")} units${o.high_voltage_share != null ? ` · ${pct(o.high_voltage_share)} at high voltage or above` : ""}` }))} />
        <Legend items={(Object.keys(TECH) as Tech[]).map((t) => TECH[t])} />
      </Section>

      <Section
        id="control-areas"
        eyebrow="Four control areas"
        title={`${north.name}'s area holds ${gw(sum(north.kw))} of large renewables and storage, ${south.name}'s ${gw(sum(south.kw))}`}
        subtitle="Districts coloured by the TSO control area most of their large units connect to; darker where more wind and solar capacity sits per km². Dots: large electricity consumers (connected at high or extra-high voltage); red rings: planned ones."
        asOf={asOf}
        source={mastr}
        takeaways={[
          "Wind is concentrated in the north and east (TenneT, 50Hertz), while much of the demand is in the west and south. That gap is why power must be moved north to south, and why plants are curtailed when lines are full.",
          `Large consumers: ${g.consumers.operating} in operation and ${g.consumers.planned} planned, ${g.consumers.sites_with_units_over_50mw} of them with units over 50 MW.`,
          "The control areas do not follow state borders exactly; the map shows where most connected capacity belongs.",
        ]}
        caveats={["Control area per district is derived from where its large units connect, not from an official map.", "Large consumers must register in MaStR only when connected at high or extra-high voltage; many data centres connect lower and are not shown.", "This is not a load-flow model: it shows where capacity and demand sit, not line loading."]}
      >
        <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0">
            <AreaMap g={g} geo={geo} />
            <Legend items={[...g.areas.map((a) => ({ label: a, color: AREA_COLOR[a] })), { label: "Large consumer", color: cssVar("--ink") }, { label: "Planned consumer", color: "#dc2626", ring: true }]} />
          </div>
          <div className="min-w-0 space-y-4">
            {areas.map((a) => (
              <div key={a.name} className="rounded-[20px] bg-surface p-4">
                <p className="flex items-center gap-2 font-semibold"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: AREA_COLOR[a.name] }} />{a.name}</p>
                <p className="figures mt-1 text-sm">{gw(a.kw.wind_onshore)} wind · {gw(a.kw.solar)} solar · {gw(a.kw.storage)} storage</p>
                <p className="figures text-xs text-ink-muted">large consumers: {a.consumers_operating} running, {a.consumers_planned} planned</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section
        id="voltage"
        eyebrow="Where they plug in"
        title={`${pct(dist / vTotal)} of large renewable capacity connects to distribution grids, not the transmission grid`}
        subtitle="Capacity of large units in operation by the voltage level of their grid connection."
        asOf={asOf}
        source={mastr}
        takeaways={["Distribution grids at medium and high voltage carry most of the energy transition. That is why congestion and curtailment increasingly happen there, not only on the big north-south lines."]}
      >
        <TechBars rows={g.voltage.map((v) => ({ label: VOLT[v.level] ?? v.level, kw: v.kw }))} />
      </Section>

      <Section
        id="congestion"
        eyebrow="Redispatch and curtailment"
        title={`Grid bottlenecks cost €${(last.cost_meur / 1000).toFixed(1)}bn in ${last.year}; €${last.re_compensation_meur}m of it compensated curtailed renewables`}
        subtitle="Cost of grid congestion management in Germany (redispatch, grid reserve, countertrading and compensation for curtailed renewables)."
        asOf={asOf}
        source={<>Sources: Bundesnetzagentur figures via the linked reports. {ctx.congestion.map((c) => <span key={c.year} className="mr-2">{c.year}: <SrcLink href={c.source} /></span>)}</>}
        takeaways={[
          ...facts("congestion").map((f) => <>{f.text} <SrcLink href={f.source} /></>),
          "Curtailed power is not thrown away: other plants south of the bottleneck ramp up instead. The cost is mainly paying conventional plants and keeping a reserve.",
        ]}
        caveats={["2025 figures are preliminary.", "Netztransparenz and ENTSO-E publish redispatch measures by grid element; once the API access is set up, this section can show which lines and areas are congested."]}
      >
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Total cost per year (€ bn)</p>
            <PlotFigure
              deps={[ctx.congestion]}
              render={(width) =>
                Plot.plot({
                  width, height: 230, marginLeft: 36, ...axis(),
                  x: { type: "band", label: null, tickFormat: (d: number) => String(d) },
                  y: { label: null, grid: true },
                  marks: [
                    Plot.barY(ctx.congestion, { x: "year", y: (d: GridFile["context"]["congestion"][number]) => d.cost_meur / 1000, fill: cssVar("--accent"), rx: 4 }),
                    Plot.text(ctx.congestion, { x: "year", y: (d: GridFile["context"]["congestion"][number]) => d.cost_meur / 1000, text: (d: GridFile["context"]["congestion"][number]) => (d.cost_meur / 1000).toFixed(1), dy: -8, fontWeight: 700, fill: cssVar("--ink") }),
                  ],
                })
              }
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Where the money went, 2025 (€ m)</p>
            <ol className="mt-3 space-y-2">
              {ctx.congestion_split_2025.items.map((it) => (
                <li key={it.label} className="grid grid-cols-[9rem_1fr] items-center gap-2 sm:grid-cols-[13rem_1fr]">
                  <span className="text-sm">{it.label}</span>
                  <span className="flex items-center gap-2"><span className="h-3 rounded-full bg-accent" style={{ width: `${(it.meur / 1200) * 70}%` }} /><span className="figures text-xs text-ink-muted">{it.meur.toLocaleString("en-GB")}</span></span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-ink-muted">Source: <SrcLink href={ctx.congestion_split_2025.source} /></p>
          </div>
        </div>
      </Section>

      <Section
        id="demand"
        eyebrow="The demand wave"
        title={`${g.consumers.planned} large electricity consumers are registered as planned, against ${g.consumers.operating} in operation`}
        subtitle="Large consumers (industry, electrolysers, batteries charging from the grid, rail, some data centres) registered in MaStR, by planned start year and by state."
        asOf={asOf}
        source={mastr}
        takeaways={[
          ...facts("demand").map((f) => <>{f.text} <SrcLink href={f.source} /></>),
          overdue ? `${overdue} planned consumers have a planned start date that has already passed: plans slip, or registrations are not updated.` : "",
        ].filter(Boolean)}
        caveats={["MaStR does not record the capacity of consumers, only whether a site has units over 50 MW.", "Connection requests (GW) are not the same as projects that will be built: many requests are duplicates or speculative."]}
      >
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Planned consumers by planned start year</p>
            <PlotFigure
              deps={[years]}
              render={(width) =>
                Plot.plot({
                  width, height: 220, marginLeft: 36, ...axis(),
                  x: { type: "band", label: null },
                  y: { label: null, grid: true },
                  marks: [
                    Plot.barY(years, { x: "y", y: "n", fill: (d: { y: string }) => (Number(d.y) < Number(g.as_of.slice(0, 4)) ? "#94a3b8" : "#dc2626"), rx: 4 }),
                    Plot.text(years, { x: "y", y: "n", text: "n", dy: -8, fill: cssVar("--ink") }),
                  ],
                })
              }
            />
            <p className="text-xs text-ink-muted">Grey: planned date already passed.</p>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Large consumers by state: in operation and planned</p>
            <ol className="mt-3 space-y-1.5">
              {states.map((s) => (
                <li key={s.s} className="grid grid-cols-[9rem_1fr] items-center gap-2 text-sm">
                  <span className="truncate">{s.s}</span>
                  <span className="flex items-center gap-1">
                    <span className="h-3 rounded-l-full bg-ink" style={{ width: `${s.o / 3}%` }} />
                    <span className="h-3 rounded-r-full" style={{ width: `${s.p / 3}%`, background: "#dc2626" }} />
                    <span className="figures ml-1 text-xs text-ink-muted">{s.o} + {s.p}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Section>

      <Section
        id="rules"
        eyebrow="The rules are changing"
        title="From first come, first served to capped connections and curtailment without pay"
        subtitle="Rules on grid connection, curtailment and redispatch that shape where and how wind, solar, batteries and data centres connect."
        asOf={asOf}
        source={<>Sources linked per rule; status checked {asOf}.</>}
        takeaways={[
          "The 'Redispatchvorbehalt' would shift curtailment risk from grid users to new projects in congested areas: financing gets harder where the grid is full, which steers projects to where it is not.",
          "Flexible connection agreements and the TSO maturity ranking reward projects that are ready to build and accept caps; batteries are the main winners.",
        ]}
        caveats={["The grid package is a bill, not law; its final shape may change in parliament."]}
      >
        <ol className="space-y-3 border-l-2 border-rule pl-4">
          {ctx.regulation.map((r) => (
            <li key={r.name} className="relative">
              <span aria-hidden className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full" style={{ background: r.status === "in_force" ? "#10b981" : "#f59e0b" }} />
              <p className="text-sm"><span className="figures font-semibold">{month(r.date)}</span> · <span className="font-semibold">{r.name}</span> <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold">{r.status === "in_force" ? "In force" : "In parliament"}</span></p>
              <p className="mt-0.5 text-sm text-ink-muted">{r.what} <SrcLink href={r.source} /></p>
            </li>
          ))}
        </ol>
        {facts("expansion").map((f) => <p key={f.text} className="mt-6 text-sm"><span className="font-semibold">Grid expansion: </span>{f.text} <SrcLink href={f.source} /></p>)}
      </Section>

      <Section
        id="model"
        eyebrow="Towards a grid model"
        title="What it takes to show which lines are overloaded"
        subtitle="This page shows where capacity, demand and congestion costs are. A line-level model needs three more sources."
        asOf={asOf}
        source={<>Planned sources; see the open-data page for what is in use.</>}
      >
        <ul className="grid gap-3 sm:grid-cols-3">
          {[
            ["Grid topology", "Lines and substations from OpenStreetMap (ODbL licence; decision pending). Lets us draw the transmission grid and assign plants to substations."],
            ["Redispatch by grid element", "Netztransparenz.de publishes each redispatch measure with the network element and the plants involved (API access with your credentials, stored as GitHub secrets)."],
            ["Flows and prices", "ENTSO-E Transparency: cross-border flows, load and generation per hour (API token as a GitHub secret)."],
          ].map(([h, t]) => (
            <li key={h} className="rounded-[20px] border border-rule p-4"><p className="font-semibold">{h}</p><p className="mt-1 text-sm text-ink-muted">{t}</p></li>
          ))}
        </ul>
      </Section>
    </>
  );
}
