"use client";

// Multi-asset hubs (contract v1.13): hubs/hubs.json, hubs/siting.json,
// hubs/infrastructure.json. Where wind, solar, batteries, gas, hydrogen and
// large consumers come together, the networks around them, and a siting screen.
import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { projectGermany, setupCanvas } from "@/components/monitor/canvasMap";
import { Loading, Section, Stat } from "@/components/monitor/ui";
import { cssVar } from "@/lib/theme";

type HubType = "wind" | "solar" | "battery" | "gas_plant" | "electrolyser" | "gas_storage" | "large_consumer";
interface Hub {
  hub_id: string;
  lat: number;
  lon: number;
  state: string;
  district: string;
  types: HubType[];
  n_types: number;
  parts: Record<string, { units: number; mw: number; planned_units: number; mwh?: number }>;
  has_planned: boolean;
  anchors: string[];
  operators: string[];
}
interface HubsFile { as_of: string; rules: { radius_km: number; min_types: number }; totals: { hubs: number; by_n_types: Record<string, number>; by_type: Record<string, number> }; combinations: { types: HubType[]; hubs: number }[]; hubs: Hub[] }
interface Seg { id: string; kind: string; from: string; to: string; dn: number | null; km: number | null; year: string | null; coords: [number, number][] | null }
interface H2Project { id: string; name: string; district: string; feed_in_mw: number | null; take_off_mw: number | null; electrolysis_mw: number | null; purposes: string[]; lon: number | null; lat: number | null }
interface Infra {
  attribution: Record<string, string>;
  power: { lines: [number, number, [number, number][]][]; substations: [number, number, number, number][] };
  gas: [number | null, [number, number][]][];
  hydrogen: { segments: Seg[]; unmatched_segments: number; projects: H2Project[] };
}
type Factor = "renewables" | "curtailment" | "hydrogen" | "grid" | "demand" | "gas";
interface District { key: string; name: string; lon: number; lat: number; score: number; renewables_mw_km2: number; curtailed_gwh_50km: number; h2_km: number | null; substation_km: number | null; gas_km: number | null; large_consumers: number; h2_take_off_mw_25km: number; h2_electrolysis_mw_25km: number; hubs: number; [k: `s_${string}`]: number }
interface Siting { as_of: string; weights: Record<Factor, number>; labels: Record<Factor, string>; method: string; districts: District[] }

const TYPE: Record<HubType, { label: string; color: string }> = {
  wind: { label: "Wind", color: "#2563eb" },
  solar: { label: "Solar park", color: "#f59e0b" },
  battery: { label: "Battery", color: "#8b5cf6" },
  gas_plant: { label: "Gas / H2 plant", color: "#64748b" },
  electrolyser: { label: "Electrolyser", color: "#06b6d4" },
  gas_storage: { label: "Gas storage", color: "#a16207" },
  large_consumer: { label: "Large consumer", color: "#e11d48" },
};
const FACTORS: Factor[] = ["renewables", "curtailment", "hydrogen", "grid", "demand", "gas"];
const H2_COLOR = { conversion: "#0891b2", new_build: "#22d3ee", existing: "#0e7490", reported: "#67e8f9" } as Record<string, string>;
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const mw = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} GW` : `${Math.round(v).toLocaleString("en-GB")} MW`);

interface Layers { power: boolean; gas: boolean; h2: boolean; h2p: boolean; hubs: boolean }

function LayerMap({ geo, infra, hubs, layers, fill, label }: { geo: GeoJSON.FeatureCollection; infra: Infra; hubs: Hub[]; layers: Layers; fill?: Map<string, number>; label: string }) {
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
    const c = ref.current;
    if (!c) return;
    const { ctx, width, height } = setupCanvas(c, 720);
    const { projection, districts } = projectGermany(geo, width, height, 12);
    ctx.clearRect(0, 0, width, height);
    for (const d of districts) {
      const v = fill?.get(d.key);
      ctx.fillStyle = cssVar("--surface");
      ctx.fill(d.path);
      if (v != null) {
        ctx.globalAlpha = 0.08 + 0.75 * Math.pow(v / 100, 2);
        ctx.fillStyle = "#0d9488";
        ctx.fill(d.path);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = cssVar("--paper");
      ctx.lineWidth = 0.5;
      ctx.stroke(d.path);
    }
    const line = (pts: [number, number][], color: string, w: number, dash: number[] = [], alpha = 0.8) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const xy = projection(p);
        if (!xy) return;
        if (i === 0) ctx.moveTo(xy[0], xy[1]);
        else ctx.lineTo(xy[0], xy[1]);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.setLineDash(dash);
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    };
    if (layers.gas) for (const [, pts] of infra.gas) line(pts, "#a16207", 1, [], 0.45);
    if (layers.power) {
      for (const [v, uc, pts] of infra.power.lines) line(pts, v >= 380 ? "#dc2626" : "#f97316", v >= 380 ? 1.2 : 0.8, uc ? [3, 3] : [], 0.65);
    }
    if (layers.h2) for (const sg of infra.hydrogen.segments) if (sg.coords) line(sg.coords, H2_COLOR[sg.kind] ?? "#0891b2", 2, sg.kind === "new_build" ? [4, 3] : [], 0.9);
    if (layers.h2p) {
      for (const p of infra.hydrogen.projects) {
        if (p.lon == null || p.lat == null) continue;
        const xy = projection([p.lon, p.lat]);
        const size = Math.max(p.electrolysis_mw ?? 0, p.take_off_mw ?? 0);
        if (!xy || size <= 0) continue;
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], Math.min(14, 2 + Math.sqrt(size) / 6), 0, Math.PI * 2);
        ctx.strokeStyle = "#0891b2";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    if (layers.hubs) {
      for (const h of hubs) {
        const xy = projection([h.lon, h.lat]);
        if (!xy) continue;
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], h.n_types >= 4 ? 5 : 3.2, 0, Math.PI * 2);
        ctx.fillStyle = h.types.includes("electrolyser") ? TYPE.electrolyser.color : h.n_types >= 4 ? "#111827" : "#4b5563";
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }, [geo, infra, hubs, layers, fill, tick]);
  return <canvas ref={ref} className="w-full" role="img" aria-label={label} />;
}

function Toggle({ on, onChange, children, color }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode; color: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-ink bg-ink text-paper" : "border-rule text-ink-muted"}`}>
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
      {children}
    </button>
  );
}

export function Hubs({ version }: { version: string }) {
  const [h, setH] = useState<HubsFile | null>(null);
  const [s, setS] = useState<Siting | null>(null);
  const [inf, setInf] = useState<Infra | null>(null);
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);
  const [layers, setLayers] = useState<Layers>({ power: true, gas: false, h2: true, h2p: false, hubs: true });
  const [w, setW] = useState<Record<Factor, number> | null>(null);
  useEffect(() => {
    Promise.all(
      ["hubs/hubs.json", "hubs/siting.json", "hubs/infrastructure.json", "boundaries/districts.geojson"].map((f) => fetch(`/data/${f}?v=${version}`).then((r) => r.json())),
    )
      .then(([a, b, c, g]) => {
        setH(a);
        setS(b);
        setInf(c);
        setGeo(g);
        setW(b.weights);
      })
      .catch(() => setFailed(true));
  }, [version]);
  const ranked = useMemo(() => {
    if (!s || !w) return [];
    const tot = FACTORS.reduce((a, k) => a + w[k], 0) || 1;
    return s.districts.map((d) => ({ ...d, total: Math.round(FACTORS.reduce((a, k) => a + d[`s_${k}`] * w[k], 0) / tot) })).sort((a, b) => b.total - a.total);
  }, [s, w]);
  const fill = useMemo(() => new Map(ranked.map((d) => [d.key, d.total])), [ranked]);
  if (failed) return <p className="py-10 text-ink-muted">Hub data is not available.</p>;
  if (!h || !s || !inf || !geo || !w) return <Loading height={600} />;

  const four = h.hubs.filter((x) => x.n_types >= 4);
  const withH2 = h.hubs.filter((x) => x.types.includes("electrolyser"));
  const planned = h.hubs.filter((x) => x.has_planned).length;
  const h2km = inf.hydrogen.segments.reduce((a, x) => a + (typeof x.km === "number" ? x.km : 0), 0);
  const h2conv = inf.hydrogen.segments.filter((x) => x.kind === "conversion").reduce((a, x) => a + (typeof x.km === "number" ? x.km : 0), 0);
  const elec = inf.hydrogen.projects.reduce((a, p) => a + (p.electrolysis_mw ?? 0), 0);
  const take = inf.hydrogen.projects.reduce((a, p) => a + (p.take_off_mw ?? 0), 0);
  const byYear = Object.entries(
    inf.hydrogen.segments.reduce<Record<string, number>>((acc, x) => {
      const y = (x.year ?? "").match(/20\d\d/)?.[0] ?? (x.year === "sofort" || x.kind === "existing" ? "2025" : null);
      if (y && typeof x.km === "number") acc[y] = (acc[y] ?? 0) + x.km;
      return acc;
    }, {}),
  ).map(([y, km]) => ({ y, km })).sort((a, b) => a.y.localeCompare(b.y));
  const src = <>Sources: Marktstammdatenregister (© Bundesnetzagentur, DL-DE-BY-2.0); power grid © OpenStreetMap contributors (ODbL) via PyPSA-Eur; gas pipelines SciGRID_gas, DLR (CC BY 4.0); hydrogen core network Bundesnetzagentur (approval annexes); as of {day(h.as_of)}. Data processed by MaStR Radar.</>;
  const custom = FACTORS.some((k) => w[k] !== s.weights[k]);
  const top = ranked.slice(0, 15);

  return (
    <>
      <Section
        id="hubs"
        eyebrow="Multi-asset hubs"
        title={`${h.totals.hubs} places already combine three or more kinds of assets; ${four.length} combine four, and ${withH2.length} include an electrolyser`}
        subtitle={`A hub here is a place where at least ${h.rules.min_types} of these meet within ${h.rules.radius_km} km: wind, solar parks, batteries, gas or hydrogen plants, electrolysers, gas storage, large electricity consumers. Operating and planned.`}
        asOf={day(h.as_of)}
        source={src}
        takeaways={[
          `The most common mix is ${h.combinations[0].types.map((t) => TYPE[t].label.toLowerCase()).join(" + ")} (${h.combinations[0].hubs} hubs): batteries are joining existing wind and solar sites.`,
          `${planned} hubs have planned parts: batteries, gas engines and large consumers are being added at places that already have generation and a grid connection.`,
          `Old power-plant and industrial sites become hubs: grid connection, land and permits already exist (for example the former nuclear site at Gundremmingen, chemical parks in the Rhineland, gas storage sites in the north-west).`,
        ]}
        caveats={[
          "A hub is a geographic cluster, not necessarily one project or owner.",
          "Hubs are built around batteries, gas plants, electrolysers, gas storage and large consumers of companies; solar parks, batteries and gas plants of 1 MW or more.",
          "Large consumers are registered without capacity; data centres are not labelled as such in the register.",
          `Hydrogen core network: segments drawn as straight lines between their start and end places (schematic); ${inf.hydrogen.unmatched_segments} segments could not be placed. No open data exists for fibre or internet backbones.`,
          "Power grid layer © OpenStreetMap contributors, Open Database License: the derived layer is shared under the same licence.",
        ]}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Hubs (≥ 3 types)" value={String(h.totals.hubs)} sub={`${four.length} with 4 or more`} />
          <Stat label="With an electrolyser" value={String(withH2.length)} sub="hydrogen production" swatch={TYPE.electrolyser.color} />
          <Stat label="Hydrogen core network" value={`${Math.round(h2km).toLocaleString("en-GB")} km`} sub={`${Math.round((100 * h2conv) / h2km)} % converted gas pipes`} swatch="#0891b2" />
          <Stat label="H2 projects connecting" value={mw(elec)} sub={`electrolysis; ${mw(take)} take-off`} />
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Toggle on={layers.hubs} onChange={(v) => setLayers({ ...layers, hubs: v })} color="#111827">Hubs</Toggle>
          <Toggle on={layers.power} onChange={(v) => setLayers({ ...layers, power: v })} color="#dc2626">Power grid 220/380 kV</Toggle>
          <Toggle on={layers.h2} onChange={(v) => setLayers({ ...layers, h2: v })} color="#0891b2">Hydrogen core network</Toggle>
          <Toggle on={layers.h2p} onChange={(v) => setLayers({ ...layers, h2p: v })} color="#06b6d4">Hydrogen projects</Toggle>
          <Toggle on={layers.gas} onChange={(v) => setLayers({ ...layers, gas: v })} color="#a16207">Gas pipelines</Toggle>
        </div>
        <div className="mt-6 grid gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0">
            <LayerMap geo={geo} infra={inf} hubs={h.hubs} layers={layers} label="Map of Germany with multi-asset hubs as dots, the extra-high-voltage grid, the hydrogen core network (schematic), hydrogen projects and gas pipelines." />
            <p className="mt-2 text-xs text-ink-muted">Dots: hubs (dark: 4+ types, cyan: with electrolyser) · red: 380 kV, orange: 220 kV, dashed: under construction · cyan lines: hydrogen (dashed: new build) · circles: hydrogen projects by size</p>
          </div>
          <div className="min-w-0 space-y-6">
            <div>
              <p className="mb-2 text-sm font-semibold">Most common combinations</p>
              <ol className="space-y-1.5 text-sm">
                {h.combinations.slice(0, 7).map((c) => (
                  <li key={c.types.join("+")} className="flex items-center justify-between gap-2">
                    <span className="flex flex-wrap gap-1">{c.types.map((t) => (<span key={t} className="rounded-full px-1.5 text-[10px] text-white" style={{ background: TYPE[t].color }}>{TYPE[t].label}</span>))}</span>
                    <span className="figures text-ink-muted">{c.hubs}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">Hubs with four or more parts</p>
              <ol className="space-y-2 text-sm">
                {four.slice(0, 8).map((x) => (
                  <li key={x.hub_id}>
                    <span className="font-semibold">{x.anchors[0] ?? x.district}</span>
                    <span className="block text-[11px] text-ink-muted">{x.district} · {x.types.map((t) => `${TYPE[t].label}${x.parts[t].mw && t !== "gas_storage" ? ` ${mw(x.parts[t].mw)}` : ""}`).join(" · ")}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </Section>

      <Section
        id="siting"
        eyebrow="Where the next hubs fit"
        title={`${top.slice(0, 3).map((d) => d.name).join(", ")} score highest for a flexible hub of wind, storage, hydrogen and consumers`}
        subtitle="A screening score per district: renewables nearby, curtailed renewables, the hydrogen core network, the extra-high-voltage grid, large consumers and hydrogen demand, and gas pipelines. Change the weights to fit your project."
        asOf={day(s.as_of)}
        source={src}
        takeaways={[
          "Coastal districts in the north-west combine wind, curtailment and the first hydrogen pipelines: surplus power that would otherwise be curtailed can feed electrolysers and batteries.",
          "Industrial districts (steel, chemicals, refineries) score on demand: the hydrogen take-off planned along the core network sits there.",
          "Set curtailment and renewables high for an electrolyser or battery that absorbs surplus wind; set demand and grid high for a data centre or industrial consumer.",
        ]}
        caveats={[s.method, "A screening aid, not site advice: land, permits, grid capacity and local acceptance decide.", "Curtailment uses only the substations in the Netztransparenz top list; other congested areas score zero on that factor."]}
      >
        <div className="rounded-[20px] border border-rule p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">Weights {custom && <span className="font-normal text-ink-muted">(your weights)</span>}</p>
            {custom && <button type="button" onClick={() => setW(s.weights)} className="text-xs text-accent underline underline-offset-2">Reset</button>}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {FACTORS.map((k) => (
              <label key={k} className="text-xs text-ink-muted">
                <span className="flex justify-between gap-2"><span>{s.labels[k]}</span><span className="figures text-ink">{w[k]}</span></span>
                <input type="range" min={0} max={50} step={5} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="mt-1 w-full accent-[var(--accent)]" aria-label={`Weight for ${s.labels[k]}`} />
              </label>
            ))}
          </div>
        </div>
        <div className="mt-6 grid gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0">
            <LayerMap geo={geo} infra={inf} hubs={h.hubs} layers={{ power: false, gas: false, h2: true, h2p: false, hubs: false }} fill={fill} label="Map of districts shaded by siting score, with the hydrogen core network." />
            <p className="mt-2 text-xs text-ink-muted">Darker teal: higher score · cyan lines: hydrogen core network (schematic)</p>
          </div>
          <div className="min-w-0 overflow-x-auto">
            <table className="figures w-full min-w-[420px] text-xs">
              <thead className="text-left text-ink-muted">
                <tr><th className="py-1 pr-2 font-medium">#</th><th className="py-1 pr-2 font-medium">District</th><th className="py-1 pr-2 font-medium">Score</th><th className="py-1 pr-2 font-medium">Wind+solar MW/km²</th><th className="py-1 pr-2 font-medium">H2 km</th><th className="py-1 font-medium">H2 demand MW</th></tr>
              </thead>
              <tbody>
                {top.map((d, i) => (
                  <tr key={d.key} className="border-t border-rule">
                    <td className="py-1 pr-2 text-ink-muted">{i + 1}</td>
                    <td className="py-1 pr-2 font-semibold">{d.name}</td>
                    <td className="py-1 pr-2 font-bold">{d.total}</td>
                    <td className="py-1 pr-2">{d.renewables_mw_km2.toFixed(2)}</td>
                    <td className="py-1 pr-2">{d.h2_km ?? "–"}</td>
                    <td className="py-1">{Math.round(d.h2_take_off_mw_25km).toLocaleString("en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section
        id="hydrogen"
        eyebrow="Hydrogen core network"
        title={`About ${Math.round(h2km / 100) * 100} km of hydrogen pipelines are planned for ${byYear[0]?.y ?? ""}–${byYear.at(-1)?.y ?? ""}; ${Math.round((100 * h2conv) / h2km)} % are converted gas pipes`}
        subtitle="Kilometres by planned start of operation, from the segments in the Bundesnetzagentur approval, and the hydrogen projects that applied to connect."
        asOf={day(s.as_of)}
        source={<>Source: Bundesnetzagentur, Wasserstoff-Kernnetz approval and annexes (Datenlizenz Deutschland – Namensnennung). Processed by MaStR Radar.</>}
        takeaways={[
          "Converting existing gas pipelines is the backbone: cheaper and faster than new pipes, which close the gaps.",
          `${inf.hydrogen.projects.length} projects applied to connect: electrolysers that feed in (${mw(elec)}) and industrial users that take hydrogen off (${mw(take)}). Demand far exceeds planned domestic production, so imports and storage matter.`,
        ]}
        caveats={["Years as stated in the annexes (planned start of operation or conversion date); 'immediately' counted as 2025.", "Project capacities are the applicants' figures for 2032."]}
      >
        <PlotFigure
          deps={[byYear]}
          render={(width) =>
            Plot.plot({
              width,
              height: 220,
              marginLeft: 48,
              ...axis(),
              x: { type: "band", label: null },
              y: { label: "km", grid: true },
              marks: [Plot.barY(byYear, { x: "y", y: "km", fill: "#0891b2", rx: 3, tip: true }), Plot.ruleY([0])],
            })
          }
        />
      </Section>
    </>
  );
}
