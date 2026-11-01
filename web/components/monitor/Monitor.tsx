"use client";

import { useMonitorData, mw, type AuctionCategory } from "@/lib/monitor";
import { formatDate } from "@/lib/format";

import { Day24 } from "./Day24";
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
import { AuctionCake, AuctionPlayers, AuctionPrices, AuctionRace, AuctionWinners, AuctionYield, roundLabel } from "./Auctions";
import { BrandRace, BrandShares, TurbineModels } from "./WindIndustry";

export const SECTIONS = [
  ["light-up", "Germany lights up"],
  ["day", "24 hours"],
  ["targets", "Race to 2030"],
  ["this-year", "This year"],
  ["balcony", "Balcony boom"],
  ["turbines", "Turbines"],
  ["makers", "Makers"],
  ["models", "Models"],
  ["auctions", "Auctions"],
  ["site-quality", "Site quality"],
  ["winners", "Winners"],
  ["auction-race", "Race"],
  ["players", "Players"],
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
  const wi = s?.wind_industry;
  const wiLast = wi ? wi.years.length - 2 : -1; // last full year
  const fleet = wi ? wi.brands.reduce((t, x) => t + wi.installed_mw[x].at(-1)!, 0) : 0;
  const fleetLeader = wi?.brands.filter((x) => x !== "Other")[0];
  const yearLeader = wi
    ? wi.brands.filter((x) => x !== "Other").sort((a, c) => wi.added_mw[c][wiLast] - wi.added_mw[a][wiLast])[0]
    : undefined;
  const topModel = wi?.recent_models[0];
  const au = data?.auctions;
  const auFirst = au?.rounds[0];
  const auLast = au?.rounds.at(-1);
  const auYears = au ? Object.keys(au.winners_by_year).filter((y) => y !== "all").sort() : [];
  const auYear = auYears.at(-1) ?? "";
  const auYearRounds = au?.rounds.filter((r) => r.bid_date.startsWith(auYear)) ?? [];
  const auShare = (c: AuctionCategory) => {
    const tot = auYearRounds.reduce((t, r) => t + r.list_kw, 0) || 1;
    return Math.round((auYearRounds.reduce((t, r) => t + r.kw_by_category[c], 0) / tot) * 100);
  };
  const auPeak = au ? au.rounds.reduce((m, r) => (r.avg_ct > m.avg_ct ? r : m), au.rounds[0]) : undefined;
  // Developers' share among bidders whose owner is known, first vs last year.
  const knownShare = (i: number) => {
    if (!au) return 0;
    const known = (["developer", "utility", "municipal", "citizen"] as const).reduce((t, c) => t + au.kw_by_category_year[c][i], 0) || 1;
    return Math.round((au.kw_by_category_year.developer[i] / known) * 100);
  };
  const auAll = (c: AuctionCategory) => (au ? Math.round((au.drivers[c].awarded_mw / Object.values(au.drivers).reduce((t, d) => t + d.awarded_mw, 0)) * 100) : 0);
  const auSource = au ? (
    <>
      Source: Bundesnetzagentur, onshore wind auctions (award lists and round results), linked to the
      Marktstammdatenregister as of {date}. Data processed.
    </>
  ) : undefined;
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
        id="makers"
        eyebrow="Turbine makers"
        title={
          wi && fleetLeader && yearLeader
            ? `${fleetLeader} built ${Math.round((wi.installed_mw[fleetLeader].at(-1)! / fleet) * 100)}% of Germany's onshore fleet; in ${wi.years[wiLast]} ${yearLeader} installed the most`
            : "Who builds Germany's wind turbines"
        }
        subtitle="Press play: the race between turbine makers since 1995, by capacity in operation or by capacity added each year."
        note={`The ${y} figures are still incomplete.`}
        asOf={date}
      >
        {data ? (
          <div className="space-y-10">
            <BrandRace data={data} />
            <BrandShares data={data} />
          </div>
        ) : (
          <Loading height={420} />
        )}
      </Section>

      <Section
        id="models"
        eyebrow="Turbine models"
        title={
          topModel && wi
            ? `The ${topModel.brand} ${topModel.model} is the most-built turbine since ${wi.recent_models_since}: ${topModel.units} units, ${topModel.avg_hub_height_m} m hub height`
            : "Which turbines go up"
        }
        subtitle="The models that went online most often in recent years, and how rotors, towers and ratings have grown at each maker."
        asOf={date}
      >
        {data ? <TurbineModels data={data} /> : <Loading />}
      </Section>

      {au && auFirst && auLast && auPeak && (
        <>
          <Section
            id="auctions"
            eyebrow="Onshore wind auctions"
            title={`Award prices peaked at ${auPeak.avg_ct.toFixed(2)} ct/kWh in ${auPeak.bid_date.slice(0, 4)} and fell to ${auLast.avg_ct.toFixed(2)} ct; after the site correction projects receive about ${auLast.received_ct_est?.toFixed(2) ?? "–"} ct`}
            subtitle="Every onshore wind round since May 2019: the award value projects bid, the legal ceiling, and the estimated value they actually receive once the EEG corrects it for the quality of their site."
            asOf={date}
            source={auSource}
          >
            <AuctionPrices a={au} />
          </Section>
          <Section
            id="site-quality"
            eyebrow="Merit order by wind"
            title={`The ${roundLabel(auLast.bid_date)} awards average about ${auLast.full_load_hours_avg?.toLocaleString("en-GB") ?? "–"} full-load hours at ${auLast.quality_pct_avg ?? "–"}% site quality, so their award value is multiplied by ${auLast.correction_factor_avg?.toFixed(2) ?? "–"}`}
            subtitle="Every awarded project, located through the register and rated with DWD wind data: which sites win, how good they are, and the correction factor they earn."
            note="Full-load hours, site quality and correction factors are model estimates."
            asOf={date}
            source={<>Source: Bundesnetzagentur (awards), Marktstammdatenregister as of {date} (turbines), Deutscher Wetterdienst (wind, CC BY 4.0). Data processed.</>}
          >
            <AuctionYield a={au} />
          </Section>
          <Section
            id="winners"
            eyebrow={`Auction winners ${auYear}`}
            title={`Developers and IPPs won at least ${auShare("developer")}% of the ${auYear} capacity; utilities ${auShare("utility")}%, Stadtwerke ${auShare("municipal")}%`}
            subtitle={`Pick a year and bidder types. ${auShare("unattributed")}% of the ${auYear} capacity went to project companies whose owner the list does not name; they get their own bar, as do citizen wind farms.`}
            asOf={date}
            source={auSource}
          >
            <AuctionWinners a={au} brands={s?.wind_industry.brands ?? []} />
          </Section>
          <Section
            id="auction-race"
            eyebrow="Auctions since 2019"
            title={`Among known bidders, developers and IPPs won ${knownShare(au.race.years.length - 1)}% of the capacity in ${auYear}, after ${knownShare(0)}% in ${au.race.years[0]}`}
            subtitle="Press play: who won the most auction capacity, year by year, by company group or by type of bidder, and how the cake is shared."
            note={`The ${auYear} figures cover the rounds awarded so far.`}
            asOf={date}
            source={auSource}
          >
            <div className="space-y-12">
              <AuctionRace a={au} />
              <AuctionCake a={au} />
            </div>
          </Section>
          <Section
            id="players"
            eyebrow="Developers vs utilities"
            title={`Utilities and Stadtwerke won ${auAll("utility") + auAll("municipal")}% of auction capacity since 2019; developers and IPPs at least ${auAll("developer")}%`}
            subtitle="Who owns the turbines that came out of the auctions and the fleet as a whole, what the data shows about each type of bidder, and why lean developers keep winning."
            asOf={date}
            source={auSource}
          >
            <AuctionPlayers a={au} />
          </Section>
        </>
      )}

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
