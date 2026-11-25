"use client";

// Outlook: looking ahead (contract v1.9 draft, outlook/outlook.json).
// Repowering potential of the ageing wind fleet, and what the next auction
// rounds are likely to look like.
import * as Plot from "@observablehq/plot";
import { useEffect, useRef, useState } from "react";

import { PlotFigure } from "@/components/explorer/PlotFigure";
import { projectGermany, setupCanvas } from "@/components/monitor/canvasMap";
import { Loading, Section, Stat } from "@/components/monitor/ui";
import { mw } from "@/lib/monitor";
import { cssVar } from "@/lib/theme";

interface Round { bid_date: string; avg_ct: number; ceiling_ct: number | null; volume_mw: number }
interface Over { bid_date: string; tender_mw: number; submitted_mw: number; source: string }
interface OutlookFile {
  as_of: string;
  repowering: {
    eeg_years: number;
    next_wave_years: number;
    old: { units: number; mw: number; avg_mw: number };
    next_wave: { units: number; mw: number };
    potential: { replacement_ratio: number; new_turbine_mw: number; mw: number };
    by_state_mw: Record<string, number>;
    districts: Record<string, [number, number, number]>;
    points: number[];
    models: { model: string; units: number; mw: number; hub_m: number | null; rotor_m: number | null }[];
    owners: { owner: string; mw: number; units: number }[];
    retired_mw_by_year: Record<string, number>;
    added_mw_by_year: Record<string, number>;
  };
  auction_outlook: {
    wind: { next_bid_dates: string[]; permitted_pool_mw: number; permitted_pool_by_permit_year_mw: Record<string, number>; awarded_not_built_mw: number; avg_volume_mw: number | null; rounds_covered: number | null; recent_rounds: Round[]; oversubscription: Over[] };
    solar: { next_bid_dates: string[]; recent_rounds: Round[]; oversubscription: Over[] };
  };
}

const OLD = "#1e3a8a";
const WAVE = "#60a5fa";
const axis = () => ({ style: { fontFamily: "var(--font-sans)", fontSize: "12px", color: cssVar("--ink-muted") } });
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const mon = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

function RepowerMap({ r, geo }: { r: OutlookFile["repowering"]; geo: GeoJSON.FeatureCollection }) {
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
    const { ctx, width, height } = setupCanvas(c, 640);
    const { projection, districts } = projectGermany(geo, width, height, 12);
    ctx.clearRect(0, 0, width, height);
    const dens = districts.map((d) => (r.districts[d.key]?.[0] ?? 0) / d.km2);
    const max = Math.max(...dens, 0.001);
    districts.forEach((d, i) => {
      ctx.fillStyle = cssVar("--surface");
      ctx.fill(d.path);
      if (dens[i] > 0) {
        ctx.globalAlpha = 0.1 + 0.6 * Math.sqrt(dens[i] / max);
        ctx.fillStyle = OLD;
        ctx.fill(d.path);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = cssVar("--paper");
      ctx.lineWidth = 0.5;
      ctx.stroke(d.path);
    });
    const p = r.points;
    for (const pass of [2, 1]) {
      for (let i = 0; i < p.length; i += 4) {
        if (p[i + 3] !== pass) continue;
        const xy = projection([p[i] / 100, p[i + 1] / 100]);
        if (!xy) continue;
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], pass === 1 ? 1.8 : 1.4, 0, Math.PI * 2);
        ctx.fillStyle = pass === 1 ? OLD : WAVE;
        ctx.globalAlpha = pass === 1 ? 0.85 : 0.6;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }, [r, geo, tick]);
  return <canvas ref={ref} className="w-full" role="img" aria-label="Map of Germany: districts shaded by wind capacity past EEG support per km², dark dots for turbines older than 20 years, light dots for turbines aged 15 to 20 years." />;
}

function Bars({ rows, color, unit = "" }: { rows: { label: string; value: number; note?: string }[]; color: string; unit?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[9.5rem_1fr] items-center gap-2 text-sm sm:grid-cols-[12rem_1fr]">
          <span className="min-w-0"><span className="block truncate">{r.label}</span>{r.note && <span className="block text-[11px] text-ink-muted">{r.note}</span>}</span>
          <span className="flex items-center gap-2"><span className="h-2.5 rounded-full" style={{ width: `${(r.value / max) * 65}%`, background: color }} /><span className="figures shrink-0 text-xs text-ink-muted">{r.value.toLocaleString("en-GB")}{unit}</span></span>
        </li>
      ))}
    </ol>
  );
}

export function Outlook({ version }: { version: string }) {
  const [d, setD] = useState<OutlookFile | null>(null);
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    Promise.all([fetch(`/data/outlook/outlook.json?v=${version}`).then((r) => r.json()), fetch(`/data/boundaries/districts.geojson?v=${version}`).then((r) => r.json())])
      .then(([a, b]) => { setD(a); setGeo(b); })
      .catch(() => setFailed(true));
  }, [version]);
  if (failed) return <p className="py-10 text-ink-muted">Outlook data is not available.</p>;
  if (!d || !geo) return <Loading height={500} />;
  const r = d.repowering;
  const w = d.auction_outlook.wind;
  const s = d.auction_outlook.solar;
  const asOf = day(d.as_of);
  const src = <>Source: Marktstammdatenregister, Bundesnetzagentur auction results, as of {asOf}. Data processed.</>;
  const years = Object.keys(r.retired_mw_by_year);
  const flow = years.flatMap((y) => [
    { y, kind: "Added", mw: r.added_mw_by_year[y] ?? 0 },
    { y, kind: "Retired", mw: -(r.retired_mw_by_year[y] ?? 0) },
  ]);
  const topState = Object.entries(r.by_state_mw)[0];
  const pool = Object.entries(w.permitted_pool_by_permit_year_mw).map(([y, v]) => ({ y, mw: v }));
  const lastW = w.recent_rounds.at(-1);
  const lastO = w.oversubscription.at(-1);
  const lastS = s.recent_rounds.at(-1);
  const lastSO = s.oversubscription.at(-1);
  const priceRows = [
    ...w.recent_rounds.map((x) => ({ d: new Date(x.bid_date), ct: x.avg_ct, tech: "Onshore wind" })),
    ...s.recent_rounds.map((x) => ({ d: new Date(x.bid_date), ct: x.avg_ct, tech: "Solar" })),
  ];
  return (
    <>
      <Section
        id="repowering"
        eyebrow="Repowering potential"
        title={`${r.old.units.toLocaleString("en-GB")} wind turbines (${mw(r.old.mw)}) have outlived their ${r.eeg_years} years of EEG support; ${r.next_wave.units.toLocaleString("en-GB")} more follow within five years`}
        subtitle="Where the old turbines stand, what they are, who owns them, and how much new capacity their sites could hold."
        asOf={asOf}
        source={src}
        takeaways={[
          `${topState[0]} has the most capacity past EEG support (${mw(topState[1])}), followed by ${Object.keys(r.by_state_mw).slice(1, 3).join(" and ")}.`,
          `The typical old turbine is small: ${r.old.avg_mw} MW on average, led by the ${r.models.slice(0, 3).map((m) => m.model).join(", ")}. A new turbine averages ${r.potential.new_turbine_mw} MW.`,
          `Illustration: replacing every old turbine with one new turbine per two old ones would bring about ${mw(r.potential.mw)} on the same sites, about ${(r.potential.mw / r.old.mw).toFixed(1)}× today's capacity there.`,
          (() => {
            const rec = years.filter((y) => Number(y) >= 2023).map((y) => r.retired_mw_by_year[y] ?? 0);
            return rec.length ? `Retirements have risen to ${mw(Math.min(...rec))}–${mw(Math.max(...rec))} a year since 2023. Whether a site can be repowered depends on the new permit: distance rules, bird protection and height limits decide site by site.` : "";
          })(),
        ]}
        caveats={[
          `Age from the commissioning date; EEG support counts ${r.eeg_years} years plus the commissioning year.`,
          `The potential uses fixed assumptions (one new per ${1 / r.potential.replacement_ratio} old turbines, today's average size); real projects depend on the site and the permit.`,
          "Owner names only for companies and turbines of 1 MW or more. Retirements are tracked in the register from 2019; earlier years are incomplete.",
          "Points: turbines with a public location (companies); private owners' turbines count in the district totals only.",
        ]}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Past EEG support" value={mw(r.old.mw)} sub={`${r.old.units.toLocaleString("en-GB")} turbines`} swatch={OLD} />
          <Stat label="Next wave (15–20 years)" value={mw(r.next_wave.mw)} sub={`${r.next_wave.units.toLocaleString("en-GB")} turbines`} swatch={WAVE} />
          <Stat label="Average old turbine" value={`${r.old.avg_mw} MW`} sub={`new: ${r.potential.new_turbine_mw} MW`} />
          <Stat label="Repowering potential" value={mw(r.potential.mw)} sub="illustration" />
        </div>
        <div className="mt-8 grid gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0">
            <RepowerMap r={r} geo={geo} />
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: OLD }} />Older than {r.eeg_years} years</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: WAVE }} />{r.next_wave_years}–{r.eeg_years} years</span>
              <span>District shade: old capacity per km²</span>
            </div>
          </div>
          <div className="min-w-0 space-y-8">
            <div><p className="mb-3 text-sm font-semibold">Most common old models</p><Bars rows={r.models.slice(0, 8).map((m) => ({ label: m.model, value: m.units, note: `${mw(m.mw)} · ${m.hub_m ?? "–"} m hub · ${m.rotor_m ?? "–"} m rotor` }))} color={OLD} unit=" turbines" /></div>
            <div><p className="mb-3 text-sm font-semibold">Largest owners of old turbines</p><Bars rows={r.owners.slice(0, 8).map((o) => ({ label: o.owner, value: o.mw }))} color={OLD} unit=" MW" /></div>
          </div>
        </div>
        <div className="mt-8 min-w-0">
          <p className="text-sm font-semibold">Onshore wind added and retired per year (MW)</p>
          <PlotFigure
            deps={[flow]}
            render={(width) =>
              Plot.plot({
                width, height: 240, marginLeft: 48, ...axis(),
                x: { type: "band", label: null },
                y: { label: null, grid: true },
                color: { domain: ["Added", "Retired"], range: ["#2563eb", "#ef4444"], legend: true },
                marks: [Plot.barY(flow, { x: "y", y: "mw", fill: "kind", rx: 3, tip: true }), Plot.ruleY([0])],
              })
            }
          />
        </div>
      </Section>

      <Section
        id="auction-outlook"
        eyebrow="Auction outlook"
        title={w.rounds_covered ? `${mw(w.permitted_pool_mw)} of permitted wind waits for an award: enough for about ${Math.round(w.rounds_covered)} rounds at today's volume` : "What the next rounds look like"}
        subtitle="Permitted projects that have not won yet, the next bid dates, and where prices are heading. Looking ahead, so partly our assessment."
        asOf={asOf}
        source={src}
        takeaways={[
          `Next onshore wind rounds: ${w.next_bid_dates.map(day).join(", ")}. Next solar rounds: ${s.next_bid_dates.map(day).join(", ")}.`,
          lastW && lastO ? `Assessment: with ${(lastO.submitted_mw / lastO.tender_mw).toFixed(1)}× more bids than volume in ${mon(lastO.bid_date)} and a pool of ${mw(w.permitted_pool_mw)} still growing, competition stays fierce. Expect award prices to stay near or below ${lastW.avg_ct} ct unless volumes rise.` : "",
          `Most of the pool was permitted in ${Object.entries(w.permitted_pool_by_permit_year_mw).slice(-2).map(([y]) => y).join(" and ")}: the permit wave of the new wind law arrives in the auctions now.`,
          lastS && lastSO ? `Solar: ${(lastSO.submitted_mw / lastSO.tender_mw).toFixed(1)}× oversubscribed in ${mon(lastSO.bid_date)}, last average ${lastS.avg_ct} ct. Oversubscription is easing, so solar prices may stabilise.` : "",
          `On top of the pool, ${mw(w.awarded_not_built_mw)} has already won and still needs to be built.`,
        ].filter(Boolean)}
        caveats={[
          "The pool counts planned turbines with a permit in the register that are on no award list yet; some will never bid (failed financing, lawsuits) and new permits keep arriving.",
          "Price direction is an assessment from oversubscription and the pool, not a forecast model.",
          "Bid dates follow the legal schedule; volumes can change when BNetzA adjusts them.",
        ]}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Permitted, no award yet" value={mw(w.permitted_pool_mw)} sub="onshore wind" />
          <Stat label="Average round volume" value={w.avg_volume_mw ? mw(w.avg_volume_mw) : "–"} sub="last four rounds" />
          <Stat label="Rounds covered" value={w.rounds_covered ? `${w.rounds_covered}` : "–"} sub="pool ÷ volume" />
          <Stat label="Next wind round" value={day(w.next_bid_dates[0])} sub={`solar: ${day(s.next_bid_dates[0])}`} />
        </div>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Permitted wind without an award, by permit year (MW)</p>
            <PlotFigure deps={[pool]} render={(width) => Plot.plot({ width, height: 240, marginLeft: 48, ...axis(), x: { type: "band", label: null }, y: { label: null, grid: true }, marks: [Plot.barY(pool, { x: "y", y: "mw", fill: "#2563eb", rx: 3, tip: true })] })} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Average award per round (ct/kWh)</p>
            <PlotFigure
              deps={[priceRows]}
              render={(width) =>
                Plot.plot({
                  width, height: 240, marginLeft: 36, ...axis(),
                  x: { type: "utc", label: null },
                  y: { label: null, grid: true, domain: [0, Math.max(...priceRows.map((p) => p.ct)) * 1.2] },
                  color: { domain: ["Onshore wind", "Solar"], range: ["#2563eb", "#f59e0b"], legend: true },
                  marks: [Plot.line(priceRows, { x: "d", y: "ct", stroke: "tech", strokeWidth: 2.5 }), Plot.dot(priceRows, { x: "d", y: "ct", fill: "tech", r: 3, tip: true })],
                })
              }
            />
          </div>
        </div>
      </Section>
    </>
  );
}
