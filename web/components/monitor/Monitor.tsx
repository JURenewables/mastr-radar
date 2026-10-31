"use client";

import { useMonitorData, mw } from "@/lib/monitor";
import { formatDate } from "@/lib/format";

import { LightUpMap } from "./LightUpMap";
import {
  PipelineMap,
  Repowering,
  SolarTypes,
  StatesRank,
  StorageBoom,
  TargetRace,
  TurbineGrowth,
  YearRace,
} from "./Sections";
import { Loading, Section } from "./ui";

export const SECTIONS = [
  ["light-up", "Germany lights up"],
  ["targets", "Race to 2030"],
  ["this-year", "This year"],
  ["balcony", "Balcony boom"],
  ["turbines", "Turbines"],
  ["where", "Where"],
  ["storage", "Storage"],
  ["pipeline", "Next wave"],
  ["repowering", "Repowering"],
] as const;

export function SectionNav() {
  return (
    <nav
      aria-label="Monitor sections"
      className="sticky top-0 z-20 -mx-5 border-b border-rule bg-paper/90 px-5 backdrop-blur"
    >
      <div className="scroll-row flex gap-1 overflow-x-auto py-2">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-surface hover:text-ink"
          >
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function Monitor({ asOf }: { asOf: string }) {
  const data = useMonitorData(asOf);
  const date = formatDate(asOf);
  const s = data?.stats;
  const b = data?.buildout;
  const y = Number(asOf.slice(0, 4));

  const solarPeakYear =
    b && b.years[b.national.solar.added.slice(0, -1).indexOf(Math.max(...b.national.solar.added.slice(0, -1)))];
  const balcony = s ? s.solar_by_type.units.balcony.at(-2) ?? 0 : 0;
  const turbines = s?.onshore_turbines;
  const t2000 = turbines ? turbines.years.indexOf(2000) : -1;
  const tLast = turbines ? turbines.years.length - 2 : -1;
  const large = s?.battery_storage.buckets.large.mw ?? [];
  const topState = s?.states
    .filter((x) => x.area_km2)
    .sort((a, c) => c.operating_mw.solar / (c.area_km2 || 1) - a.operating_mw.solar / (a.area_km2 || 1))[0];

  return (
    <>
      <SectionNav />
      <Section
        id="light-up"
        eyebrow="Build-out since 1990"
        title="Watch Germany light up"
        subtitle="Press play: 37 years of renewable build-out, district by district and plant by plant. Switch technologies to compare the stories."
        asOf={date}
      >
        {data ? <LightUpMap data={data} /> : <Loading height={520} />}
      </Section>

      <Section
        id="targets"
        eyebrow="Targets"
        title={
          s && b
            ? `Solar is at ${Math.round((s.installed_mw.solar / (s.targets_2030_mw.solar ?? 1)) * 100)}% of its 2030 target; onshore wind at ${Math.round((s.installed_mw.wind_onshore / (s.targets_2030_mw.wind_onshore ?? 1)) * 100)}%`
            : "The race to 2030"
        }
        subtitle="Capacity added per year, and the pace needed from now on to reach the legal 2030 targets (EEG 2023, WindSeeG)."
        note={`The ${y} bar is still incomplete.`}
        asOf={date}
      >
        {data ? <TargetRace data={data} asOf={asOf} /> : <Loading />}
      </Section>

      <Section
        id="this-year"
        eyebrow={`${y} so far`}
        title={s ? `${mw(s.ytd_cumulative_mw.solar[String(y)].at(-1) ?? 0)} of solar went online in ${y} so far` : `${y} so far`}
        subtitle="Capacity added since January, month by month, compared with the three years before."
        asOf={date}
      >
        {data ? <YearRace data={data} /> : <Loading />}
      </Section>

      <Section
        id="balcony"
        eyebrow="Solar"
        title={s ? `${balcony.toLocaleString("en-GB")} balcony power plants were registered in ${y - 1}` : "The balcony boom"}
        subtitle={
          solarPeakYear
            ? `Plug-in balcony systems now outnumber every other kind of new solar unit. In capacity, rooftops and solar parks still dominate; the record year was ${solarPeakYear}.`
            : undefined
        }
        asOf={date}
      >
        {data ? <SolarTypes data={data} /> : <Loading />}
      </Section>

      <Section
        id="turbines"
        eyebrow="Onshore wind"
        title={
          turbines && t2000 >= 0
            ? `A new wind turbine is ${(turbines.avg_mw[tLast] / turbines.avg_mw[t2000]).toFixed(1)}× as powerful as in 2000`
            : "Turbines keep growing"
        }
        subtitle="Average capacity, hub height and rotor diameter of the onshore turbines that went online each year. Drawn to scale."
        asOf={date}
      >
        {data ? <TurbineGrowth data={data} /> : <Loading />}
      </Section>

      <Section
        id="where"
        eyebrow="Regions"
        title={topState ? `${topState.name} has the most solar per km² of any state` : "Where it is built"}
        subtitle="Capacity in operation per km² of land, or in total, by state. Offshore wind is not part of any state."
        asOf={date}
      >
        {data ? <StatesRank data={data} /> : <Loading />}
      </Section>

      <Section
        id="storage"
        eyebrow="Batteries"
        title={
          large.length
            ? `Large batteries: ${mw(large.at(-1) ?? 0)} added in ${y} so far, after ${mw(large.at(-2) ?? 0)} in ${y - 1}`
            : "The storage boom"
        }
        subtitle="Battery storage added per year, split into home batteries, commercial systems and large grid batteries."
        note={`The ${y} figures are still incomplete.`}
        asOf={date}
      >
        {data ? <StorageBoom data={data} /> : <Loading />}
      </Section>

      <Section
        id="pipeline"
        eyebrow="Pipeline"
        title={s ? `${mw(s.planned_mw.wind_onshore)} of onshore wind are registered as planned` : "The next wave"}
        subtitle="Planned turbines with a public location, against the turbines already turning. Planned capacity by state."
        asOf={date}
      >
        {data ? <PipelineMap data={data} /> : <Loading height={420} />}
      </Section>

      <Section
        id="repowering"
        eyebrow="Repowering"
        title={
          s ? `${s.repowering.units.toLocaleString("en-GB")} wind turbines are older than ${s.repowering.age_years} years` : "The ageing fleet"
        }
        subtitle="Onshore turbines still in operation that went online at least 20 years ago, when EEG support typically ends. Replacing them with modern turbines multiplies the output on the same sites."
        asOf={date}
      >
        {data ? <Repowering data={data} /> : <Loading />}
      </Section>
    </>
  );
}
