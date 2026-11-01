"use client";

import { useMonitorData, mw } from "@/lib/monitor";
import { formatDate } from "@/lib/format";

import { Day24 } from "./Day24";
import { LightUpMap } from "./LightUpMap";
import {
  PipelineMap,
  SolarTypes,
  StatesRank,
  StorageBoom,
  TargetRace,
  YearRace,
} from "./Sections";
import { SOLAR_SECTIONS, SolarStory } from "./SolarStory";
import { WIND_SECTIONS, WindStory } from "./WindStory";
import { Loading, Section } from "./ui";

export const ENERGY_SECTIONS = [
  ["light-up", "Germany lights up"],
  ["day", "24 hours"],
  ["targets", "Race to 2030"],
  ["this-year", "This year"],
  ["balcony", "Balcony boom"],
  ["where", "Where"],
  ["storage", "Storage"],
  ["pipeline", "Next wave"],
] as const;


export function SectionNav({ sections }: { sections: readonly (readonly [string, string])[] }) {
  return (
    <nav
      aria-label="Monitor sections"
      className="sticky top-0 z-20 -mx-5 border-b border-rule bg-paper/90 px-5 backdrop-blur"
    >
      <div className="scroll-row flex gap-1 overflow-x-auto py-2">
        {sections.map(([id, label]) => (
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

export function Monitor({ asOf, part = "energy" }: { asOf: string; part?: "energy" | "wind" | "solar" }) {
  const data = useMonitorData(asOf);
  const date = formatDate(asOf);
  const s = data?.stats;
  const b = data?.buildout;
  const y = Number(asOf.slice(0, 4));

  const solarPeakYear =
    b && b.years[b.national.solar.added.slice(0, -1).indexOf(Math.max(...b.national.solar.added.slice(0, -1)))];
  const balcony = s ? s.solar_by_type.units.balcony.at(-2) ?? 0 : 0;
  const large = s?.battery_storage.buckets.large.mw ?? [];
  const topState = s?.states
    .filter((x) => x.area_km2)
    .sort((a, c) => c.operating_mw.solar / (c.area_km2 || 1) - a.operating_mw.solar / (a.area_km2 || 1))[0];

  return (
    <>
      <SectionNav sections={part === "wind" ? WIND_SECTIONS : part === "solar" ? SOLAR_SECTIONS : ENERGY_SECTIONS} />
      {part === "energy" && (
        <>
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
            id="day"
            eyebrow="Any day of the last 12 months"
            title="Germany in 24 hours"
            subtitle="Pick a day and press play: how solar, wind and every other source met demand, quarter hour by quarter hour, and where the sun and wind were working."
            note="Generation and demand: Bundesnetzagentur | SMARD.de. Weather: Deutscher Wetterdienst. District maps are estimates."
            asOf={date}
          >
            {data ? <Day24 data={data} asOf={asOf} /> : <Loading height={520} />}
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
            id="where"
            eyebrow="Regions"
            title={topState ? `${topState.name} has the most solar per km² of any state` : "Where it is built"}
            subtitle="Capacity in operation per km² of land, per resident (watts), or in total, by state. Offshore wind is not part of any state."
            note="Population and areas: © GeoBasis-DE / BKG (2026), Statistische Ämter des Bundes und der Länder."
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
        </>
      )}
      {part === "wind" && <WindStory data={data} asOf={asOf} date={date} />}
      {part === "solar" && <SolarStory data={data} date={date} />}
    </>
  );
}
